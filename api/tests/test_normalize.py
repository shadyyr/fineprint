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

from ingest import IngestResult, LayoutLine, PageRender, ingest  # noqa: E402
from models import (  # noqa: E402
    ExtractionAmbiguity,
    ExtractionAmbiguityOption,
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


def test_repeated_summary_facts_are_coalesced_without_losing_evidence():
    """Detail and summary occurrences are one fact; coincidences are not."""
    texts = [
        "Scholarship Alpha $100",
        "Scholarship Beta $200",
        "Total Scholarships $300",
        "Scholarships (Financial Aid Summary) $300",
        "Direct Subsidized Loan $50",
        "Federal Direct Subsidized Loans (Financial Aid Summary) $50",
        "Scholarship Gamma $100",
        "Total Federal Loans Offered $50",
        "Total Loans Offered $50",
    ]
    lines = [
        LayoutLine(
            line_id=f"p1_l{index}",
            page=1,
            text=text,
            bbox=(0.1, index / 20, 0.8, (index + 1) / 20),
            char_boxes=[(0.1, index / 20, 0.8, (index + 1) / 20)] * len(text),
        )
        for index, text in enumerate(texts, start=1)
    ]
    source = IngestResult(
        lines=lines,
        pages=[PageRender(page=1, width_pt=612, height_pt=792, rotation=0)],
        char_count=sum(map(len, texts)),
    )

    def claim(index, *, label, amount, category, role=False, aid_type=None):
        return ExtractionItem(
            kind="aid",
            label=label,
            amount=amount,
            period="annual",
            citations=[
                ExtractionCitation(line_id=f"p1_l{index}", quote=texts[index - 1])
            ],
            confidence=0.9,
            aid_category=category,
            aid_type=aid_type or (
                "loan" if category == "subsidized_loan" else "gift"
            ),
            is_stated_total=role,
        )

    extraction = ExtractionResult(
        institution_name="Example University",
        items=[
            claim(1, label="Scholarship Alpha", amount=100, category="scholarship"),
            claim(2, label="Scholarship Beta", amount=200, category="scholarship"),
            claim(3, label="Total Scholarships", amount=300, category="scholarship", role=True),
            # Summary tables often classify the same category total generically.
            claim(4, label="Scholarships (Financial Aid Summary)", amount=300, category="subtotal", role=True),
            claim(5, label="Direct Subsidized Loan", amount=50, category="subsidized_loan"),
            claim(6, label="Federal Direct Subsidized Loans (Financial Aid Summary)", amount=50, category="subsidized_loan", role=True),
            # Same amount and category as Alpha, but a different award.
            claim(7, label="Scholarship Gamma", amount=100, category="scholarship"),
            claim(8, label="Total Federal Loans Offered", amount=50, category="subtotal", role=True, aid_type="loan"),
            claim(9, label="Total Loans Offered", amount=50, category="subtotal", role=True, aid_type="loan"),
        ],
    )

    document = normalize(extraction, source, source_file_name="synthetic.pdf")

    scholarship_total = [
        aid for aid in document.aid if aid.role == "rollup" and aid.amount == 300
    ]
    assert len(scholarship_total) == 1
    assert len(scholarship_total[0].evidence_ids) == 2
    assert scholarship_total[0].components is not None

    subsidized = [
        aid for aid in document.aid if aid.category == "subsidized_loan"
    ]
    assert len(subsidized) == 1
    assert subsidized[0].role == "item"
    assert len(subsidized[0].evidence_ids) == 2

    loan_totals = [
        aid
        for aid in document.aid
        if aid.role == "rollup" and aid.category == "subtotal" and aid.amount == 50
    ]
    assert len(loan_totals) == 1
    assert len(loan_totals[0].evidence_ids) == 2

    # Same-dollar awards with different names remain independently summable.
    assert {aid.label for aid in document.aid if aid.amount == 100} == {
        "Scholarship Alpha",
        "Scholarship Gamma",
    }


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


@pytest.mark.parametrize(
    "label",
    [
        "Cost after all awards",
        "Fall 2026 estimate",
        "Fall 2026 amount due after aid",
        "Monthly installment",
        "Family obligation",
    ],
)
def test_payment_and_after_aid_cost_views_are_non_summable(ingested, label):
    extraction = realistic_extraction(ingested)
    source = line_with(ingested, "Total Cost of Attendance")
    extraction.items.append(
        ExtractionItem(
            kind="cost",
            label=label,
            amount=51300,
            period="annual",
            cost_category="other",
            direct_cost=False,
            confidence=0.95,
            citations=[
                ExtractionCitation(line_id=source.line_id, quote=source.text)
            ],
        )
    )

    document = normalize(extraction, ingested, source_file_name="s.pdf")
    view = next(item for item in document.costs if item.label == label)
    assert view.role == "rollup"


def _amount_choice(ingested, *, second_value: str) -> ExtractionAmbiguity:
    tuition = line_with(ingested, "Tuition and Fees")
    total = line_with(ingested, "Total Cost of Attendance")
    return ExtractionAmbiguity(
        kind="amount_unclear",
        target_label="Tuition and Fees",
        question="Which tuition rate applies?",
        why="The letter lists two mutually exclusive rates.",
        options=[
            ExtractionAmbiguityOption(
                value="34800", label="In-state: $34,800 a year"
            ),
            ExtractionAmbiguityOption(
                value=second_value, label="Out-of-state: $51,300 a year"
            ),
        ],
        citations=[
            ExtractionCitation(line_id=tuition.line_id, quote=tuition.text),
            ExtractionCitation(line_id=total.line_id, quote=total.text),
        ],
    )


def test_amount_choice_is_material_blocking_and_evidence_gated(ingested):
    extraction = realistic_extraction(ingested)
    extraction.ambiguities.append(_amount_choice(ingested, second_value="51300"))

    document = normalize(extraction, ingested, source_file_name="s.pdf")
    tuition = next(item for item in document.costs if item.label == "Tuition and Fees")
    ambiguity = next(row for row in document.ambiguities if row.kind == "amount_unclear")

    assert ambiguity.target == f"{tuition.id}.amount"
    assert ambiguity.severity == "material"
    assert ambiguity.blocks_headline is True
    assert tuition.amount == 34800
    assert [option.value for option in ambiguity.options] == ["34800", "51300"]
    matched = {
        evidence.amount_text
        for evidence in document.evidence
        if evidence.id in ambiguity.evidence_ids
        and evidence.verification.amount_matched
    }
    assert matched == {"$34,800", "$51,300"}


def test_amount_choice_fails_closed_when_any_option_is_unverified(ingested):
    extraction = realistic_extraction(ingested)
    extraction.ambiguities.append(_amount_choice(ingested, second_value="99999"))

    document = normalize(extraction, ingested, source_file_name="s.pdf")
    tuition = next(item for item in document.costs if item.label == "Tuition and Fees")

    assert not any(row.kind == "amount_unclear" for row in document.ambiguities)
    assert tuition.role == "rollup"
    assert any(
        claim.claimed_label == "Tuition and Fees"
        and claim.claimed_amount == 99999
        and claim.reason == "amount_mismatch"
        for claim in document.unverified_claims
    )
