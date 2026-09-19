"""Academic-term rows become one annual fact only when the partition is clear."""

from __future__ import annotations

import sys
from pathlib import Path

API = Path(__file__).resolve().parent.parent
ROOT = API.parent
sys.path.insert(0, str(API))

from ingest import ingest  # noqa: E402
from models import ExtractionResult  # noqa: E402
from normalize import normalize  # noqa: E402

PDF = ROOT / "corpus" / "letters" / "per_term_offer.pdf"
RESPONSE = ROOT / "corpus" / "responses" / "per_term_offer.json"


def summit_extraction() -> ExtractionResult:
    return ExtractionResult.model_validate_json(RESPONSE.read_text())


def normalize_summit(extraction: ExtractionResult):
    return normalize(
        extraction,
        ingest(PDF.read_bytes(), render_images=False),
        source_file_name=PDF.name,
        source="cached",
        model="test",
    )


def test_complete_fall_spring_rows_become_one_derived_annual_item():
    document = normalize_summit(summit_extraction())

    assert len(document.costs) == 5
    assert len(document.aid) == 7

    tuition = next(item for item in document.costs if item.label == "Tuition")
    assert tuition.amount == 28_400
    assert tuition.period == "annual"
    assert tuition.provenance == "derived"
    assert len(tuition.evidence_ids) == 2

    pell = next(item for item in document.aid if item.label == "Federal Pell Grant")
    assert pell.amount == 6_500
    assert pell.period == "annual"
    assert pell.provenance == "derived"

    gift_aid = sum(
        item.amount
        for item in document.aid
        if item.role == "item" and item.aid_type == "gift" and item.period == "annual"
    )
    assert gift_aid == 16_500

    for label in ("Term Charges", "Term Aid Package"):
        rollup = next(
            item for item in (*document.costs, *document.aid) if item.label == label
        )
        assert rollup.role == "rollup"
        assert rollup.provenance == "derived"
        assert rollup.period == "annual"


def test_missing_term_is_unknown_and_blocking_instead_of_doubled():
    extraction = summit_extraction()
    extraction.items = [
        item
        for item in extraction.items
        if item.label != "Federal Pell Grant — Spring 2027"
    ]

    document = normalize_summit(extraction)

    pell = next(item for item in document.aid if "Federal Pell Grant" in item.label)
    assert pell.label == "Federal Pell Grant — Fall 2026"
    assert pell.amount == 3_200
    assert pell.period == "unknown"
    ambiguity = next(row for row in document.ambiguities if row.target == f"{pell.id}.period")
    assert ambiguity.kind == "period_unknown"
    assert ambiguity.blocks_headline is True


def test_conflicting_term_years_are_not_merged():
    extraction = summit_extraction()
    spring = next(
        item for item in extraction.items
        if item.label == "Federal Pell Grant — Spring 2027"
    )
    spring.label = "Federal Pell Grant — Spring 2028"

    document = normalize_summit(extraction)

    pell_rows = [item for item in document.aid if "Federal Pell Grant" in item.label]
    assert len(pell_rows) == 2
    assert {item.period for item in pell_rows} == {"unknown"}
    assert all(item.ambiguity_ids for item in pell_rows)
