"""Terra-first, Sol-on-validation-failure routing tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API))

from extract import ExtractionRefused, ExtractionValidationFailed  # noqa: E402
from ingest import IngestResult, LayoutLine, PageRender  # noqa: E402
from models import (  # noqa: E402
    ExtractionAmbiguity,
    ExtractionCitation,
    ExtractionItem,
    ExtractionResult,
)
from pipeline import (  # noqa: E402
    STRUCTURED_VALIDATION_FAILURE,
    UNVERIFIED_CLAIMS,
    analyze_document,
)


class StubExtractor:
    def __init__(self, result: ExtractionResult | Exception):
        self.result = result
        self.calls = 0

    def extract(self, ingested: IngestResult) -> ExtractionResult:  # noqa: ARG002
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture
def ingested() -> IngestResult:
    text = "Tuition $100"
    boxes = [(0.1, 0.1, 0.2, 0.2) for _ in text]
    return IngestResult(
        lines=[
            LayoutLine(
                line_id="p1_l1",
                page=1,
                text=text,
                bbox=(0.1, 0.1, 0.2, 0.2),
                char_boxes=boxes,
            )
        ],
        pages=[PageRender(page=1, width_pt=612, height_pt=792, rotation=0)],
        char_count=len(text),
    )


def claims(*, amount: float = 100, period: str = "annual") -> ExtractionResult:
    return ExtractionResult(
        institution_name="Test University",
        items=[
            ExtractionItem(
                kind="cost",
                label="Tuition",
                amount=amount,
                period=period,
                citations=[
                    ExtractionCitation(line_id="p1_l1", quote="Tuition $100")
                ],
                confidence=0.9,
                cost_category="tuition",
                direct_cost=True,
            )
        ],
    )


def route(primary: StubExtractor, fallback: StubExtractor, ingested: IngestResult):
    return analyze_document(
        ingested,
        source_file_name="offer.pdf",
        primary_extractor=primary,
        fallback_extractor=fallback,
        primary_model="gpt-5.6-terra",
        fallback_model="gpt-5.6-sol",
    )


def test_valid_terra_result_does_not_call_sol(ingested):
    primary = StubExtractor(claims())
    fallback = StubExtractor(claims())

    result = route(primary, fallback, ingested)

    assert result.model == "gpt-5.6-terra"
    assert result.used_fallback is False
    assert primary.calls == 1
    assert fallback.calls == 0


def test_evidence_gate_rejection_calls_sol(ingested):
    primary = StubExtractor(claims(amount=999))
    fallback = StubExtractor(claims())

    result = route(primary, fallback, ingested)

    assert result.model == "gpt-5.6-sol"
    assert result.fallback_reasons == ("no_verified_financial_facts", UNVERIFIED_CLAIMS)
    assert len(result.document.costs) == 1
    assert fallback.calls == 1


def test_material_blocking_ambiguity_is_kept_without_calling_sol(ingested):
    primary = StubExtractor(claims(period="unknown"))
    fallback = StubExtractor(claims(period="unknown"))

    result = route(primary, fallback, ingested)

    assert result.model == "gpt-5.6-terra"
    assert result.fallback_reasons == ()
    assert len(result.document.ambiguities) == 1
    assert result.document.ambiguities[0].blocks_headline is True
    assert fallback.calls == 0


def test_minor_ambiguity_does_not_call_sol(ingested):
    primary_claims = claims()
    primary_claims.ambiguities.append(
        ExtractionAmbiguity(
            kind="conditional",
            target_label="Tuition",
            question="Which condition applies?",
            why="The wording is conditional.",
            options=[
                {"value": "yes", "label": "Condition applies"},
                {"value": "no", "label": "Condition does not apply"},
            ],
        )
    )
    primary = StubExtractor(primary_claims)
    fallback = StubExtractor(claims())

    result = route(primary, fallback, ingested)

    assert result.model == "gpt-5.6-terra"
    assert fallback.calls == 0


def test_typed_validation_failure_calls_sol(ingested):
    primary = StubExtractor(ExtractionValidationFailed("bad schema"))
    fallback = StubExtractor(claims())

    result = route(primary, fallback, ingested)

    assert result.model == "gpt-5.6-sol"
    assert result.fallback_reasons == (STRUCTURED_VALIDATION_FAILURE,)
    assert fallback.calls == 1


def test_refusal_does_not_call_sol(ingested):
    primary = StubExtractor(ExtractionRefused("refused"))
    fallback = StubExtractor(claims())

    with pytest.raises(ExtractionRefused):
        route(primary, fallback, ingested)

    assert fallback.calls == 0
