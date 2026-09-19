"""Public-service safety controls for the extraction endpoint.

The development server stays unchanged unless ``FINEPRINT_PUBLIC_MODE`` is
enabled. In public mode, one small SQLite database provides a process-safe,
persistent per-IP fixed-window limit and a UTC daily analysis cap.

Only an HMAC digest of the client address is stored. The address itself, PDF
bytes, extracted text, filename, and model output never enter this database.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path


TRUE_VALUES = {"1", "true", "yes", "on"}


def env_flag(name: str, *, default: bool = False) -> bool:
    """Read a deliberately strict boolean environment variable."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in TRUE_VALUES


def public_mode() -> bool:
    return env_flag("FINEPRINT_PUBLIC_MODE")


def public_api_enabled() -> bool:
    return env_flag("FINEPRINT_PUBLIC_API_ENABLED")


def trust_proxy_headers() -> bool:
    return env_flag("FINEPRINT_TRUST_PROXY_HEADERS")


class GuardrailConfigurationError(RuntimeError):
    """Public mode is missing a required safe setting."""


class QuotaExceeded(RuntimeError):
    """A request would exceed an application quota."""

    def __init__(self, *, scope: str, retry_after_seconds: int):
        self.scope = scope
        self.retry_after_seconds = max(1, retry_after_seconds)
        super().__init__(f"{scope} quota exceeded")


@dataclass(frozen=True)
class QuotaSettings:
    database_path: Path
    ip_hash_secret: str
    requests_per_window: int
    window_seconds: int
    daily_analysis_cap: int

    @classmethod
    def from_env(cls) -> QuotaSettings:
        secret = os.environ.get("FINEPRINT_IP_HASH_SECRET", "").strip()
        if not secret:
            raise GuardrailConfigurationError(
                "FINEPRINT_IP_HASH_SECRET is required in public mode"
            )

        return cls(
            database_path=Path(
                os.environ.get(
                    "FINEPRINT_QUOTA_DB", "/var/data/fineprint-quota.sqlite3"
                )
            ),
            ip_hash_secret=secret,
            requests_per_window=_positive_int("FINEPRINT_RATE_LIMIT_REQUESTS", 3),
            window_seconds=_positive_int(
                "FINEPRINT_RATE_LIMIT_WINDOW_SECONDS", 3600
            ),
            daily_analysis_cap=_positive_int("FINEPRINT_DAILY_ANALYSIS_CAP", 25),
        )


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise GuardrailConfigurationError(f"{name} must be an integer") from exc
    if value < 1:
        raise GuardrailConfigurationError(f"{name} must be positive")
    return value


class QuotaStore:
    """Atomic quota counters backed by SQLite.

    A persistent disk plus one service instance makes the daily ceiling survive
    restarts without adding a remotely reachable datastore. ``BEGIN IMMEDIATE``
    serializes counter updates across concurrent request threads.
    """

    def __init__(
        self,
        settings: QuotaSettings,
        *,
        clock: Callable[[], float] = time.time,
    ):
        self.settings = settings
        self._clock = clock
        settings.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.settings.database_path, timeout=10)
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS ip_windows (
                    ip_hash TEXT NOT NULL,
                    window_start INTEGER NOT NULL,
                    request_count INTEGER NOT NULL,
                    PRIMARY KEY (ip_hash, window_start)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_usage (
                    utc_day TEXT PRIMARY KEY,
                    analysis_count INTEGER NOT NULL
                )
                """
            )

    def check_ip(self, client_address: str) -> None:
        """Reserve one request in the client's fixed window or refuse it."""
        now = int(self._clock())
        window = self.settings.window_seconds
        window_start = now - (now % window)
        retry_after = window_start + window - now
        digest = hmac.new(
            self.settings.ip_hash_secret.encode(),
            client_address.encode(),
            hashlib.sha256,
        ).hexdigest()

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT request_count FROM ip_windows
                WHERE ip_hash = ? AND window_start = ?
                """,
                (digest, window_start),
            ).fetchone()
            count = row[0] if row else 0
            if count >= self.settings.requests_per_window:
                raise QuotaExceeded(
                    scope="per_ip", retry_after_seconds=retry_after
                )

            connection.execute(
                """
                INSERT INTO ip_windows (ip_hash, window_start, request_count)
                VALUES (?, ?, 1)
                ON CONFLICT(ip_hash, window_start)
                DO UPDATE SET request_count = request_count + 1
                """,
                (digest, window_start),
            )
            # Retain only the current and immediately previous fixed windows.
            connection.execute(
                "DELETE FROM ip_windows WHERE window_start < ?",
                (window_start - window,),
            )

    def reserve_analysis(self) -> None:
        """Reserve one provider-backed analysis in the current UTC day."""
        now = self._clock()
        current = datetime.fromtimestamp(now, tz=timezone.utc)
        utc_day = current.date().isoformat()
        tomorrow = datetime.combine(
            current.date() + timedelta(days=1),
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        retry_after = int(tomorrow.timestamp() - now)

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT analysis_count FROM daily_usage WHERE utc_day = ?",
                (utc_day,),
            ).fetchone()
            count = row[0] if row else 0
            if count >= self.settings.daily_analysis_cap:
                raise QuotaExceeded(
                    scope="daily", retry_after_seconds=retry_after
                )

            connection.execute(
                """
                INSERT INTO daily_usage (utc_day, analysis_count)
                VALUES (?, 1)
                ON CONFLICT(utc_day)
                DO UPDATE SET analysis_count = analysis_count + 1
                """,
                (utc_day,),
            )
            connection.execute(
                "DELETE FROM daily_usage WHERE utc_day < ?",
                ((current.date() - timedelta(days=7)).isoformat(),),
            )


@lru_cache(maxsize=8)
def _cached_store(settings: QuotaSettings) -> QuotaStore:
    return QuotaStore(settings)


def quota_store() -> QuotaStore:
    """Return the store for the current environment-derived settings."""
    return _cached_store(QuotaSettings.from_env())
