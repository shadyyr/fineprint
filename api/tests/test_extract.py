"""OpenAI provider adapter tests with no network calls."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from openai.lib._pydantic import to_strict_json_schema

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))

from extract import (  # noqa: E402
    DEFAULT_MODEL,
    DEFAULT_REASONING_EFFORT,
    FALLBACK_MODEL,
    ExtractionFailed,
    ExtractionRefused,
    ExtractionValidationFailed,
    OpenAIExtractor,
    available,
    build_user_content,
)
from ingest import IngestResult, PageRender  # noqa: E402
from models import ExtractionResult  # noqa: E402


class FakeResponses:
    def __init__(self, response):
        self.response = response
        self.kwargs = None

    def parse(self, **kwargs):
        self.kwargs = kwargs
        return self.response


class FakeClient:
    def __init__(self, response):
        self.responses = FakeResponses(response)


def ingested(*, image: bool = False) -> IngestResult:
    return IngestResult(
        lines=[],
        pages=[
            PageRender(
                page=1,
                width_pt=612,
                height_pt=792,
                rotation=0,
                png_b64="YWJj" if image else "",
            )
        ],
        char_count=0,
    )


def test_user_content_uses_responses_api_image_shape():
    content = build_user_content(ingested(image=True))

    assert content[0]["type"] == "input_text"
    assert content[1] == {
        "type": "input_image",
        "image_url": "data:image/png;base64,YWJj",
        "detail": "auto",
    }
    assert content[2]["type"] == "input_text"
    assert content[-1]["type"] == "input_text"


def test_openai_extractor_requests_typed_nonstored_output():
    claims = ExtractionResult(institution_name="Test University")
    response = SimpleNamespace(
        output_parsed=claims,
        output=[],
        status="completed",
    )
    client = FakeClient(response)

    actual = OpenAIExtractor(model="test-model", client=client).extract(ingested())

    assert actual is claims
    request = client.responses.kwargs
    assert request["model"] == "test-model"
    assert request["text_format"] is ExtractionResult
    assert request["store"] is False
    assert request["reasoning"] == {"effort": "medium"}
    assert request["input"][0]["role"] == "user"


def test_openai_refusal_is_reported_clearly():
    refusal = SimpleNamespace(type="refusal", refusal="cannot process this file")
    response = SimpleNamespace(
        output_parsed=None,
        output=[SimpleNamespace(content=[refusal])],
        status="completed",
    )

    with pytest.raises(ExtractionRefused, match="cannot process this file"):
        OpenAIExtractor(client=FakeClient(response)).extract(ingested())


def test_incomplete_openai_response_is_not_treated_as_structured_output():
    response = SimpleNamespace(
        output_parsed=None,
        output=[],
        status="incomplete",
        incomplete_details=SimpleNamespace(reason="max_output_tokens"),
    )

    with pytest.raises(ExtractionFailed, match="max_output_tokens"):
        OpenAIExtractor(client=FakeClient(response)).extract(ingested())


def test_missing_structured_output_is_a_validation_failure():
    response = SimpleNamespace(
        output_parsed=None,
        output=[],
        status="completed",
    )

    with pytest.raises(ExtractionValidationFailed, match="structured output"):
        OpenAIExtractor(client=FakeClient(response)).extract(ingested())


def test_default_route_is_terra_medium_with_sol_fallback():
    assert DEFAULT_MODEL == "gpt-5.6-terra"
    assert FALLBACK_MODEL == "gpt-5.6-sol"
    assert DEFAULT_REASONING_EFFORT == "medium"


def test_extraction_schema_is_compatible_with_strict_structured_outputs():
    """Every object must declare all fields and forbid free-form properties."""
    schema = to_strict_json_schema(ExtractionResult)

    def check(node):
        if isinstance(node, list):
            for value in node:
                check(value)
            return
        if not isinstance(node, dict):
            return

        if node.get("type") == "object":
            assert node.get("additionalProperties") is False
            properties = node.get("properties", {})
            assert set(node.get("required", [])) == set(properties)
        for value in node.values():
            check(value)

    check(schema)


def test_available_requires_the_documented_openai_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("UNRELATED_API_KEY", "unused-key")
    assert available() is False

    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    assert available() is True
