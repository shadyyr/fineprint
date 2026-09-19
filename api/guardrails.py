"""Public-service safety controls for the extraction endpoint.

The development server stays unchanged unless ``FINEPRINT_PUBLIC_MODE`` is
enabled. In public mode, Upstash Redis provides atomic fixed-window counters
that survive Vercel function restarts and work across concurrent instances.

Only an HMAC digest of the client address is used in a Redis key. The address
itself, PDF bytes, extracted text, filename, and model output are never stored.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Protocol


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


def proxy_secret() -> str:
    """Shared web-to-API secret used to authenticate the client address."""
    return os.environ.get("FINEPRINT_PROXY_SECRET", "").strip()


def _redis_credentials() -> tuple[str, str]:
    """Read Vercel Marketplace names, with direct-Upstash names as fallback."""
    url = (
        os.environ.get("KV_REST_API_URL", "").strip()
        or os.environ.get("UPSTASH_REDIS_REST_URL", "").strip()
    )
    token = (
        os.environ.get("KV_REST_API_TOKEN", "").strip()
        or os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
    )
    return url, token


def quota_configured() -> bool:
    """Report configuration presence without connecting or exposing values."""
    url, token = _redis_credentials()
    return bool(url and token and os.environ.get("FINEPRINT_IP_HASH_SECRET", "").strip())


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
    redis_url: str
    redis_token: str
    ip_hash_secret: str
    requests_per_window: int
    window_seconds: int
    daily_analysis_cap: int

    @classmethod
    def from_env(cls) -> QuotaSettings:
        url, token = _redis_credentials()
        if not url or not token:
            raise GuardrailConfigurationError(
                "Upstash Redis REST credentials are required in public mode"
            )

        secret = os.environ.get("FINEPRINT_IP_HASH_SECRET", "").strip()
        if not secret:
            raise GuardrailConfigurationError(
                "FINEPRINT_IP_HASH_SECRET is required in public mode"
            )

        return cls(
            redis_url=url,
            redis_token=token,
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


class RedisClient(Protocol):
    def eval(
        self, script: str, *, keys: list[str], args: list[str]
    ) -> Any: ...


# One server-side operation performs check + increment + expiry. The Upstash
# key-locking flag keeps unrelated client windows concurrent while each key is
# still updated atomically.
_RESERVE_SCRIPT = """#!lua flags=allow-key-locking
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if current >= limit then
  local remaining = redis.call("TTL", KEYS[1])
  if remaining < 1 then remaining = ttl end
  return {0, remaining}
end
local updated = redis.call("INCR", KEYS[1])
local remaining = redis.call("TTL", KEYS[1])
if updated == 1 or remaining < 0 then
  redis.call("EXPIRE", KEYS[1], ttl)
  remaining = ttl
end
return {1, remaining}
"""


def _new_redis_client(settings: QuotaSettings) -> RedisClient:
    try:
        from upstash_redis import Redis
    except ImportError as exc:  # pragma: no cover - deployment dependency check
        raise GuardrailConfigurationError(
            "The Upstash Redis client is not installed"
        ) from exc

    return Redis(
        url=settings.redis_url,
        token=settings.redis_token,
        allow_telemetry=False,
        rest_retries=0,
    )


class QuotaStore:
    """Atomic Redis-backed quotas safe across serverless instances."""

    def __init__(
        self,
        settings: QuotaSettings,
        *,
        redis: RedisClient | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.settings = settings
        self._redis = redis or _new_redis_client(settings)
        self._clock = clock

    def _reserve(self, *, key: str, limit: int, ttl: int, scope: str) -> None:
        response = self._redis.eval(
            _RESERVE_SCRIPT,
            keys=[key],
            args=[str(limit), str(max(1, ttl))],
        )
        if not isinstance(response, (list, tuple)) or len(response) != 2:
            raise RuntimeError("Redis returned an invalid quota response")
        allowed, retry_after = int(response[0]), int(response[1])
        if allowed != 1:
            raise QuotaExceeded(
                scope=scope,
                retry_after_seconds=max(1, retry_after),
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
        self._reserve(
            key=f"fineprint:v1:ip:{window_start}:{digest}",
            limit=self.settings.requests_per_window,
            ttl=retry_after,
            scope="per_ip",
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
        self._reserve(
            key=f"fineprint:v1:daily:{utc_day}",
            limit=self.settings.daily_analysis_cap,
            ttl=retry_after,
            scope="daily",
        )


@lru_cache(maxsize=8)
def _cached_store(settings: QuotaSettings) -> QuotaStore:
    return QuotaStore(settings)


def quota_store() -> QuotaStore:
    """Return the Redis store for the current environment-derived settings."""
    return _cached_store(QuotaSettings.from_env())
