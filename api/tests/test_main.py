"""Public endpoint behavior without starting a server or calling a model."""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))

import extract as extraction  # noqa: E402
import main  # noqa: E402
from ingest import IngestResult, PageRender  # noqa: E402


def upload() -> UploadFile:
    return UploadFile(
        filename="letter.pdf",
        file=io.BytesIO(b"%PDF-1.7\nsynthetic test"),
        headers=Headers({"content-type": "application/pdf"}),
    )


def request(*, forwarded_for: str | None = None):
    headers = {}
    if forwarded_for:
        headers["x-forwarded-for"] = forwarded_for
    return SimpleNamespace(
        headers=Headers(headers),
        client=SimpleNamespace(host="127.0.0.1"),
    )


def test_public_analyze_is_inert_until_explicitly_enabled(monkeypatch):
    monkeypatch.setattr(main, "public_mode", lambda: True)
    monkeypatch.setattr(main, "public_api_enabled", lambda: False)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(main.analyze(request(), upload()))

    assert caught.value.status_code == 503
    assert "not available yet" in caught.value.detail


def test_debug_ingest_is_not_part_of_the_public_surface(monkeypatch):
    monkeypatch.setattr(main, "public_mode", lambda: True)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(main.debug_ingest(upload()))

    assert caught.value.status_code == 404


def test_provider_details_are_not_returned_or_logged(monkeypatch, caplog):
    provider_detail = "sensitive provider detail and uploaded-text fragment"
    monkeypatch.setattr(main, "public_mode", lambda: False)
    monkeypatch.setattr(main.extraction, "available", lambda: True)
    monkeypatch.setattr(
        main,
        "ingest",
        lambda _payload: IngestResult(
            lines=[],
            pages=[PageRender(page=1, width_pt=612, height_pt=792, rotation=0)],
            char_count=120,
        ),
    )
    monkeypatch.setattr(
        main,
        "analyze_document",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            extraction.ExtractionFailed(provider_detail)
        ),
    )

    with pytest.raises(HTTPException) as caught:
        asyncio.run(main.analyze(request(), upload()))

    assert caught.value.status_code == 502
    assert provider_detail not in caught.value.detail
    assert provider_detail not in caplog.text


def test_trusted_proxy_uses_renders_first_forwarded_address(monkeypatch):
    monkeypatch.setattr(main, "trust_proxy_headers", lambda: True)
    actual = main._client_address(
        request(forwarded_for="203.0.113.7, 198.51.100.4")
    )
    assert actual == "203.0.113.7"


def test_public_per_ip_limit_returns_retry_after_before_reading(monkeypatch):
    class RefusingLimiter:
        def check_ip(self, _address):
            raise main.QuotaExceeded(scope="per_ip", retry_after_seconds=47)

    monkeypatch.setattr(main, "public_mode", lambda: True)
    monkeypatch.setattr(main, "public_api_enabled", lambda: True)
    monkeypatch.setattr(main, "quota_store", lambda: RefusingLimiter())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(main.analyze(request(), upload()))

    assert caught.value.status_code == 429
    assert caught.value.headers == {"Retry-After": "47"}
