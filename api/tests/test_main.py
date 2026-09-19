"""Public endpoint behavior without starting a server or calling a model."""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
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


def test_vercel_bundle_contains_the_canonical_sample_fixture():
    repository_fixture = API.parent / "fixtures" / "sample_offer.json"

    assert main.FIXTURE.parent == API
    assert main.FIXTURE.read_bytes() == repository_fixture.read_bytes()


def request(
    *,
    forwarded_for: str | None = None,
    client_ip: str | None = None,
    proxy_secret: str | None = None,
):
    headers = {}
    if forwarded_for:
        headers["x-forwarded-for"] = forwarded_for
    if client_ip:
        headers["x-fineprint-client-ip"] = client_ip
    if proxy_secret:
        headers["x-fineprint-proxy-secret"] = proxy_secret
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


def test_matching_proxy_secret_uses_validated_client_ip(monkeypatch):
    monkeypatch.setattr(main, "proxy_secret", lambda: "shared-test-secret")
    actual = main._client_address(
        request(
            forwarded_for="198.51.100.4",
            client_ip="203.0.113.7",
            proxy_secret="shared-test-secret",
        )
    )
    assert actual == "203.0.113.7"


@pytest.mark.parametrize(
    ("client_ip", "supplied_secret"),
    [
        ("203.0.113.7", "wrong-secret"),
        ("not-an-ip", "shared-test-secret"),
    ],
)
def test_untrusted_or_invalid_client_ip_falls_back_to_socket(
    monkeypatch, client_ip, supplied_secret
):
    monkeypatch.setattr(main, "proxy_secret", lambda: "shared-test-secret")
    actual = main._client_address(
        request(
            forwarded_for="192.0.2.10",
            client_ip=client_ip,
            proxy_secret=supplied_secret,
        )
    )
    assert actual == "127.0.0.1"


def test_bare_x_forwarded_for_is_never_trusted(monkeypatch):
    monkeypatch.setattr(main, "proxy_secret", lambda: "shared-test-secret")
    assert main._client_address(request(forwarded_for="203.0.113.7")) == "127.0.0.1"


@pytest.mark.parametrize("supplied_secret", [None, "wrong-secret"])
def test_public_analyze_requires_the_authenticated_web_proxy(
    monkeypatch, supplied_secret
):
    monkeypatch.setattr(main, "public_mode", lambda: True)
    monkeypatch.setattr(main, "public_api_enabled", lambda: True)
    monkeypatch.setattr(main, "proxy_secret", lambda: "shared-test-secret")

    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            main.analyze(
                request(
                    client_ip="203.0.113.7",
                    proxy_secret=supplied_secret,
                ),
                upload(),
            )
        )

    assert caught.value.status_code == 403
    assert caught.value.detail == "Please start live reading from the FinePrint website."


def test_public_analyze_fails_closed_when_proxy_secret_is_unconfigured(monkeypatch):
    monkeypatch.setattr(main, "public_mode", lambda: True)
    monkeypatch.setattr(main, "public_api_enabled", lambda: True)
    monkeypatch.setattr(main, "proxy_secret", lambda: "")

    with pytest.raises(HTTPException) as caught:
        asyncio.run(main.analyze(request(), upload()))

    assert caught.value.status_code == 503


def test_framework_errors_use_one_actionable_detail_string():
    client = TestClient(main.app, raise_server_exceptions=False)

    missing_file = client.post("/analyze")
    missing_route = client.get("/does-not-exist")

    assert missing_file.status_code == 422
    assert missing_file.json() == {
        "detail": "Please attach one PDF using the file field."
    }
    assert missing_route.status_code == 404
    assert isinstance(missing_route.json().get("detail"), str)


def test_public_per_ip_limit_returns_retry_after_before_reading(monkeypatch):
    class RefusingLimiter:
        def check_ip(self, _address):
            raise main.QuotaExceeded(scope="per_ip", retry_after_seconds=47)

    monkeypatch.setattr(main, "public_mode", lambda: True)
    monkeypatch.setattr(main, "public_api_enabled", lambda: True)
    monkeypatch.setattr(main, "proxy_secret", lambda: "shared-test-secret")
    monkeypatch.setattr(main, "quota_store", lambda: RefusingLimiter())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            main.analyze(
                request(
                    client_ip="203.0.113.7",
                    proxy_secret="shared-test-secret",
                ),
                upload(),
            )
        )

    assert caught.value.status_code == 429
    assert caught.value.headers == {"Retry-After": "47"}
