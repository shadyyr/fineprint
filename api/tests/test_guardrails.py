"""Persistent public-service quota tests with no network calls."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))

from guardrails import (  # noqa: E402
    GuardrailConfigurationError,
    QuotaExceeded,
    QuotaSettings,
    QuotaStore,
)


class Clock:
    def __init__(self, timestamp: float):
        self.timestamp = timestamp

    def __call__(self) -> float:
        return self.timestamp


def settings(tmp_path: Path, **overrides) -> QuotaSettings:
    values = {
        "database_path": tmp_path / "quota.sqlite3",
        "ip_hash_secret": "test-only-secret",
        "requests_per_window": 3,
        "window_seconds": 60,
        "daily_analysis_cap": 2,
    }
    values.update(overrides)
    return QuotaSettings(**values)


def test_per_ip_limit_is_atomic_and_does_not_store_raw_address(tmp_path):
    clock = Clock(1_700_000_010)
    store = QuotaStore(settings(tmp_path), clock=clock)

    for _ in range(3):
        store.check_ip("203.0.113.7")
    with pytest.raises(QuotaExceeded) as caught:
        store.check_ip("203.0.113.7")

    assert caught.value.scope == "per_ip"
    assert 1 <= caught.value.retry_after_seconds <= 60
    store.check_ip("203.0.113.8")
    assert b"203.0.113.7" not in store.settings.database_path.read_bytes()


def test_per_ip_limit_resets_at_next_fixed_window(tmp_path):
    clock = Clock(1_700_000_010)
    store = QuotaStore(
        settings(tmp_path, requests_per_window=1, window_seconds=60),
        clock=clock,
    )

    store.check_ip("203.0.113.7")
    with pytest.raises(QuotaExceeded):
        store.check_ip("203.0.113.7")

    clock.timestamp += 60
    store.check_ip("203.0.113.7")


def test_daily_cap_persists_across_store_instances_and_resets_in_utc(tmp_path):
    # 2023-11-14 22:13:20 UTC
    clock = Clock(1_700_000_000)
    quota_settings = settings(tmp_path, daily_analysis_cap=2)
    QuotaStore(quota_settings, clock=clock).reserve_analysis()
    second_store = QuotaStore(quota_settings, clock=clock)
    second_store.reserve_analysis()

    with pytest.raises(QuotaExceeded) as caught:
        second_store.reserve_analysis()
    assert caught.value.scope == "daily"
    assert caught.value.retry_after_seconds > 0

    clock.timestamp += 86_400
    second_store.reserve_analysis()


def test_failed_quota_checks_do_not_increment_past_the_cap(tmp_path):
    store = QuotaStore(settings(tmp_path, daily_analysis_cap=1))
    store.reserve_analysis()
    for _ in range(2):
        with pytest.raises(QuotaExceeded):
            store.reserve_analysis()

    with sqlite3.connect(store.settings.database_path) as connection:
        count = connection.execute(
            "SELECT analysis_count FROM daily_usage"
        ).fetchone()[0]
    assert count == 1


def test_public_settings_require_a_hash_secret(monkeypatch):
    monkeypatch.delenv("FINEPRINT_IP_HASH_SECRET", raising=False)
    with pytest.raises(GuardrailConfigurationError, match="IP_HASH_SECRET"):
        QuotaSettings.from_env()
