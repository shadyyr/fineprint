"""Pipeline tests: model claims -> admission gate -> canonical model.

Exercises the full extraction path with a synthetic model response, so the
behaviour that matters is covered without an API key: hallucinated items are
excluded, stated totals are not double counted, and an unstated period always
becomes a blocking question rather than a guess.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API = Path(__file__).resolve().parent.parent
ROOT = API.parent
sys.path.insert(0, str(API))

from ingest import ingest  # noqa: E402
from models import (  # noqa: E402
    ExtractionCitation,
    ExtractionItem,
    ExtractionMissingCost,
    ExtractionResult,
)
from normalize import normalize  # noqa: E402

SAMPLE = ROOT / "fixtures" / "sample_offer.pdf"


@pytest.fixture(scope="module")
def ingested():
    return ingest(SAMPLE.read_bytes(), render_images=False)


def line_with(ingested, needle: str):
    for line in ingested.lines:
        if needle in line.text:
            return line
    raise AssertionError(f"no line containing {needle!r}")


def item(ingested, needle: str, **kwargs) -> ExtractionItem:
    """Build a well-formed claim quoting a real line verbatim."""
    line = line_with(ingested, needle)
    kwargs.setdefault("confidence", 0.95)
    return ExtractionItem(
        citations=[ExtractionCitation(line_id=line.line_id, quote=line.text)],
        **kwargs,
    )


def realistic_extraction(ingested) -> ExtractionResult:
    """What a well-behaved model should return for the sample letter."""
    return ExtractionResult(
        institution_name="Meridian State University",
        academic_year="2026-2027",
        items=[
            item(ingested, "Tuition and Fees", kind="cost", label="Tuition and Fees",
                 amount=34800, period="annual", cost_category="tuition", direct_cost=True),
            item(ingested, "Housing (Standard", kind="cost", label="Housing",
                 amount=9200, period="annual", cost_category="housing", direct_cost=True),
            item(ingested, "Meal Plan", kind="cost", label="Meal Plan",
                 amount=6100, period="annual", cost_category="meals", direct_cost=True),
            item(ingested, "Books and Supplies", kind="cost", label="Books and Supplies",
                 amount=1200, period="annual", cost_category="books", direct_cost=False),
            item(ingested, "Total Cost of Attendance", kind="cost",
                 label="Total Cost of Attendance", amount=51300, period="annual",
                 cost_category="subtotal", direct_cost=False, is_stated_total=True),
            item(ingested, "Meridian Opportunity Grant", kind="aid",
                 label="Meridian Opportunity Grant", amount=12400, period="annual",
                 aid_category="grant", aid_type="gift"),
            item(ingested, "Federal Pell Grant", kind="aid", label="Federal Pell Grant",
                 amount=4500, period="annual", aid_category="grant", aid_type="gift"),
            # The centrepiece: no period stated anywhere on the row.
            item(ingested, "Presidential Merit Scholarship .", kind="aid",
                 label="Presidential Merit Scholarship", amount=20000, period="unknown",
                 aid_category="scholarship", aid_type="gift", renewable=True,
                 conditions=["Maintain a 3.25 cumulative GPA"]),
            item(ingested, "Federal Direct Subsidized Loan", kind="aid",
                 label="Federal Direct Subsidized Loan", amount=3500, period="annual",
                 aid_category="subsidized_loan", aid_type="loan"),
            item(ingested, "Federal Direct Unsubsidized Loan", kind="aid",
                 label="Federal Direct Unsubsidized Loan", amount=2000, period="annual",
                 aid_category="unsubsidized_loan", aid_type="loan"),
            item(ingested, "Federal Work-Study .", kind="aid", label="Federal Work-Study",
                 amount=3000, period="annual", aid_category="work_study",
                 aid_type="work_study"),
            item(ingested, "Total Financial Aid Package", kind="aid",
                 label="Total Financial Aid Package", amount=45400, period="annual",
                 aid_category="subtotal", aid_type="unknown", is_stated_total=True),
        ],
        missing_costs=[
            ExtractionMissingCost(
                category="transportation",
                label="Transportation",
                reason="Named on page 2 as not included. No amount given.",
                citations=[
                    ExtractionCitation(
                        line_id=line_with(ingested, "include transportation").line_id,
                        quote=line_with(ingested, "include transportation").text,
                    )
                ],
            )
        ],
    )


def test_realistic_extraction_produces_a_clean_model(ingested):
    doc = normalize(
        realistic_extraction(ingested), ingested,
        source_file_name="sample_offer.pdf", model="test",
    )

    assert doc.document.institution_name == "Meridian State University"
    assert doc.unverified_claims == []
    assert len(doc.costs) == 5
    assert len(doc.aid) == 7

    # Every item carries verified evidence.
    ev_ids = {e.id for e in doc.evidence}
    for entry in (*doc.costs, *doc.aid):
        assert entry.evidence_ids
        assert all(ref in ev_ids for ref in entry.evidence_ids)


def test_stated_totals_are_marked_as_rollups(ingested):
    doc = normalize(
        realistic_extraction(ingested), ingested, source_file_name="s.pdf"
    )

    coa = next(c for c in doc.costs if c.amount == 51300)
    package = next(a for a in doc.aid if a.amount == 45400)
    assert coa.role == "rollup"
    assert package.role == "rollup"

    # Summing only the items reproduces the stated totals exactly.
    assert sum(c.amount for c in doc.costs if c.role == "item") == 51300
    assert sum(a.amount for a in doc.aid if a.role == "item") == 45400


def test_a_total_the_model_forgot_to_flag_is_still_caught(ingested):
    """The deterministic guard, not the model, is what prevents double counting."""
    extraction = realistic_extraction(ingested)
    for entry in extraction.items:
        entry.is_stated_total = False  # model misses every total

    doc = normalize(extraction, ingested, source_file_name="s.pdf")

    package = next(a for a in doc.aid if a.amount == 45400)
    assert package.role == "rollup", "arithmetic guard should have caught the total"
    assert package.components is not None and len(package.components) >= 2
    assert sum(a.amount for a in doc.aid if a.role == "item") == 45400


def test_unknown_period_always_raises_a_blocking_question(ingested):
    """Even when the model reports no ambiguity of its own."""
    extraction = realistic_extraction(ingested)
    assert extraction.ambiguities == []

    doc = normalize(extraction, ingested, source_file_name="s.pdf")

    merit = next(a for a in doc.aid if a.amount == 20000)
    assert merit.period == "unknown"
    assert merit.ambiguity_ids

    amb = next(a for a in doc.ambiguities if a.id in merit.ambiguity_ids)
    assert amb.kind == "period_unknown"
    assert amb.blocks_headline is True
    assert amb.severity == "material"
    assert {o.value for o in amb.options} == {"annual", "four_year_total"}


def test_hallucinated_item_is_excluded_and_recorded(ingested):
    extraction = realistic_extraction(ingested)
    real = line_with(ingested, "Federal Pell Grant")
    extraction.items.append(
        ExtractionItem(
            kind="aid",
            label="Dean's Excellence Award",
            amount=7500,
            period="annual",
            aid_category="scholarship",
            aid_type="gift",
            confidence=0.91,
            citations=[
                ExtractionCitation(
                    line_id=real.line_id, quote="Dean's Excellence Award ... $7,500"
                )
            ],
        )
    )

    doc = normalize(extraction, ingested, source_file_name="s.pdf")

    assert all(a.label != "Dean's Excellence Award" for a in doc.aid)
    assert len(doc.unverified_claims) == 1
    claim = doc.unverified_claims[0]
    assert claim.claimed_label == "Dean's Excellence Award"
    assert claim.reason == "quote_not_found"

    # And it moves no totals.
    assert sum(a.amount for a in doc.aid if a.role == "item") == 45400


def test_inflated_amount_on_a_real_row_is_excluded(ingested):
    extraction = realistic_extraction(ingested)
    for entry in extraction.items:
        if entry.label == "Federal Pell Grant":
            entry.amount = 45000  # real row, wrong number

    doc = normalize(extraction, ingested, source_file_name="s.pdf")

    assert all(a.label != "Federal Pell Grant" for a in doc.aid)
    assert doc.unverified_claims[0].reason == "amount_mismatch"
    assert doc.unverified_claims[0].claimed_amount == 45000


def test_gift_loan_and_work_study_stay_distinct(ingested):
    doc = normalize(realistic_extraction(ingested), ingested, source_file_name="s.pdf")

    items = [a for a in doc.aid if a.role == "item"]
    assert sum(a.amount for a in items if a.aid_type == "gift") == 36900
    assert sum(a.amount for a in items if a.aid_type == "loan") == 5500
    assert sum(a.amount for a in items if a.aid_type == "work_study") == 3000


def test_missing_costs_are_carried_without_amounts(ingested):
    doc = normalize(realistic_extraction(ingested), ingested, source_file_name="s.pdf")

    assert len(doc.missing_costs) == 1
    mc = doc.missing_costs[0]
    assert mc.category == "transportation"
    assert mc.evidence_ids
    assert not hasattr(mc, "amount")


def test_output_validates_and_round_trips(ingested):
    from models import CanonicalDocument

    doc = normalize(realistic_extraction(ingested), ingested, source_file_name="s.pdf")
    again = CanonicalDocument.model_validate_json(doc.model_dump_json())
    assert again == doc
