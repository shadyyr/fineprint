"""Persistent public-service quota tests with no network calls."""

from __future__ import annotations

import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))

from guardrails import (  # noqa: E402
    GuardrailConfigurationError,
    QuotaExceeded,
    QuotaSettings,
    QuotaStore,
    proxy_secret,
    quota_configured,
)


class Clock:
    def __init__(self, timestamp: float):
        self.timestamp = timestamp

    def __call__(self) -> float:
        return self.timestamp


class FakeRedis:
    """Small locked model of the one Lua operation QuotaStore uses."""

    def __init__(self, clock: Clock):
        self.clock = clock
        self.values: dict[str, tuple[int, int]] = {}
        self.keys_seen: list[str] = []
        self._lock = threading.Lock()

    def eval(self, _script, *, keys, args):
        key = keys[0]
        limit, ttl = (int(value) for value in args)
        now = int(self.clock())
        with self._lock:
            self.keys_seen.append(key)
            count, expires = self.values.get(key, (0, now + ttl))
            if expires <= now:
                count, expires = 0, now + ttl
            remaining = max(1, expires - now)
            if count >= limit:
                return [0, remaining]
            self.values[key] = (count + 1, expires)
            return [1, remaining]


def settings(**overrides) -> QuotaSettings:
    values = {
        "redis_url": "https://example.upstash.io",
        "redis_token": "test-token",
        "ip_hash_secret": "test-only-secret",
        "requests_per_window": 3,
        "window_seconds": 60,
        "daily_analysis_cap": 2,
    }
    values.update(overrides)
    return QuotaSettings(**values)


def test_per_ip_limit_is_atomic_and_does_not_store_raw_address():
    clock = Clock(1_700_000_010)
    redis = FakeRedis(clock)
    store = QuotaStore(settings(), redis=redis, clock=clock)

    def attempt() -> bool:
        try:
            store.check_ip("203.0.113.7")
        except QuotaExceeded:
            return False
        return True

    with ThreadPoolExecutor(max_workers=12) as pool:
        allowed = list(pool.map(lambda _index: attempt(), range(12)))

    assert sum(allowed) == 3
    assert all("203.0.113.7" not in key for key in redis.keys_seen)
    assert all(key.startswith("fineprint:v1:ip:") for key in redis.keys_seen)


def test_per_ip_limit_resets_at_next_fixed_window():
    clock = Clock(1_700_000_010)
    redis = FakeRedis(clock)
    store = QuotaStore(
        settings(requests_per_window=1, window_seconds=60),
        redis=redis,
        clock=clock,
    )

    store.check_ip("203.0.113.7")
    with pytest.raises(QuotaExceeded):
        store.check_ip("203.0.113.7")

    clock.timestamp += 60
    store.check_ip("203.0.113.7")


def test_daily_cap_persists_across_store_instances_and_resets_in_utc():
    clock = Clock(1_700_000_000)
    redis = FakeRedis(clock)
    quota_settings = settings(daily_analysis_cap=2)
    QuotaStore(quota_settings, redis=redis, clock=clock).reserve_analysis()
    second_store = QuotaStore(quota_settings, redis=redis, clock=clock)
    second_store.reserve_analysis()

    with pytest.raises(QuotaExceeded) as caught:
        second_store.reserve_analysis()
    assert caught.value.scope == "daily"
    assert caught.value.retry_after_seconds > 0

    clock.timestamp += 86_400
    second_store.reserve_analysis()


def test_failed_quota_checks_do_not_increment_past_the_cap():
    clock = Clock(1_700_000_000)
    redis = FakeRedis(clock)
    store = QuotaStore(
        settings(daily_analysis_cap=1), redis=redis, clock=clock
    )
    store.reserve_analysis()
    for _ in range(2):
        with pytest.raises(QuotaExceeded):
            store.reserve_analysis()

    assert next(iter(redis.values.values()))[0] == 1


def test_public_settings_use_vercel_marketplace_credentials(monkeypatch):
    monkeypatch.setenv("KV_REST_API_URL", "https://marketplace.upstash.io")
    monkeypatch.setenv("KV_REST_API_TOKEN", "marketplace-token")
    monkeypatch.setenv("FINEPRINT_IP_HASH_SECRET", "hash-secret")

    result = QuotaSettings.from_env()

    assert result.redis_url == "https://marketplace.upstash.io"
    assert result.redis_token == "marketplace-token"
    assert quota_configured() is True


def test_public_settings_require_redis_and_hash_secret(monkeypatch):
    for name in (
        "KV_REST_API_URL",
        "KV_REST_API_TOKEN",
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
        "FINEPRINT_IP_HASH_SECRET",
    ):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(GuardrailConfigurationError, match="Upstash Redis"):
        QuotaSettings.from_env()

    monkeypatch.setenv("KV_REST_API_URL", "https://marketplace.upstash.io")
    monkeypatch.setenv("KV_REST_API_TOKEN", "marketplace-token")
    with pytest.raises(GuardrailConfigurationError, match="IP_HASH_SECRET"):
        QuotaSettings.from_env()


def test_proxy_secret_is_optional_and_trimmed(monkeypatch):
    monkeypatch.delenv("FINEPRINT_PROXY_SECRET", raising=False)
    assert proxy_secret() == ""
    monkeypatch.setenv("FINEPRINT_PROXY_SECRET", "  shared-value  ")
    assert proxy_secret() == "shared-value"
