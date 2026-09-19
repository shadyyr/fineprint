"""Admission-gate tests.

These are the tests that back the project's central claim: a number the model
invents cannot reach the financial model. Each doctored payload below must end
up in `unverified_claims`, never in `costs` or `aid`.

Run:  .venv/bin/pytest api/tests -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API = Path(__file__).resolve().parent.parent
ROOT = API.parent
sys.path.insert(0, str(API))
sys.path.insert(0, str(ROOT / "scripts"))

from evidence import EvidenceResolver, locate, parse_amount  # noqa: E402
from ingest import ingest  # noqa: E402
from models import ExtractionCitation  # noqa: E402

SAMPLE = ROOT / "fixtures" / "sample_offer.pdf"


@pytest.fixture(scope="module")
def lines():
    return ingest(SAMPLE.read_bytes(), render_images=False).line_map()


@pytest.fixture
def resolver(lines):
    return EvidenceResolver(lines)


def cite(line_id: str, quote: str) -> list[ExtractionCitation]:
    return [ExtractionCitation(line_id=line_id, quote=quote)]


def find_line(lines, needle: str):
    for line in lines.values():
        if needle in line.text:
            return line
    raise AssertionError(f"no line containing {needle!r}")


# --- the happy path ---------------------------------------------------------


def test_verbatim_citation_is_admitted(resolver, lines):
    line = find_line(lines, "Federal Direct Subsidized Loan")

    result = resolver.resolve(label="Subsidized Loan", amount=3500, citations=cite(line.line_id, line.text))

    assert result.ok
    assert len(result.evidence) == 1
    ev = result.evidence[0]
    assert ev.line_id == line.line_id
    assert ev.verification.quote_found
    assert ev.verification.amount_matched
    assert ev.amount_text == "$3,500"


def test_amount_box_is_narrowed_to_the_number(resolver, lines):
    """The highlight should land on $3,500, not the whole row."""
    line = find_line(lines, "Federal Direct Subsidized Loan")
    ev = resolver.resolve(
        label="Subsidized Loan", amount=3500, citations=cite(line.line_id, line.text)
    ).evidence[0]

    assert ev.amount_bbox is not None
    row_width = ev.bbox[2] - ev.bbox[0]
    amount_width = ev.amount_bbox[2] - ev.amount_bbox[0]
    assert amount_width < row_width / 4
    # ...and sits at the right-hand end of the row, where the amount is.
    assert ev.amount_bbox[0] > ev.bbox[0] + row_width / 2


def test_partial_quote_of_a_real_line_is_admitted(resolver, lines):
    line = find_line(lines, "Federal Pell Grant")
    result = resolver.resolve(
        label="Pell Grant", amount=4500, citations=cite(line.line_id, "Federal Pell Grant")
    )
    # The label alone carries no amount, so the claim fails the amount check
    # even though the quote itself is genuine.
    assert not result.ok
    assert result.failure.reason == "amount_mismatch"


# --- the four doctored payloads ---------------------------------------------


def test_quote_absent_from_cited_line_is_rejected(resolver, lines):
    line = find_line(lines, "Federal Pell Grant")

    result = resolver.resolve(
        label="Presidential Fellowship",
        amount=9000,
        citations=cite(line.line_id, "Presidential Fellowship .... $9,000"),
    )

    assert not result.ok
    assert result.failure.reason == "quote_not_found"
    assert result.evidence == []


def test_amount_disagreeing_with_quoted_text_is_rejected(resolver, lines):
    line = find_line(lines, "Federal Direct Subsidized Loan")

    # Real line, real quote, wrong number. The most dangerous failure mode:
    # everything looks citable except the figure itself.
    result = resolver.resolve(
        label="Subsidized Loan", amount=35000, citations=cite(line.line_id, line.text)
    )

    assert not result.ok
    assert result.failure.reason == "amount_mismatch"
    assert result.failure.claimed_amount == 35000


def test_claim_without_any_citation_is_rejected(resolver):
    result = resolver.resolve(label="Mystery Grant", amount=5000, citations=[])

    assert not result.ok
    assert result.failure.reason == "no_citation"
    assert result.failure.cited_line_id is None


def test_citation_to_a_nonexistent_line_is_rejected(resolver):
    result = resolver.resolve(
        label="Ghost Scholarship",
        amount=1000,
        citations=cite("p9_l99", "Ghost Scholarship $1,000"),
    )

    assert not result.ok
    assert result.failure.reason == "line_not_found"


def test_multiple_rejected_claims_receive_unique_ids(resolver):
    first = resolver.resolve(
        label="Ghost Grant",
        amount=1000,
        citations=cite("p9_l98", "Ghost Grant $1,000"),
    )
    second = resolver.resolve(
        label="Ghost Loan",
        amount=2000,
        citations=cite("p9_l99", "Ghost Loan $2,000"),
    )

    assert first.failure is not None
    assert second.failure is not None
    assert first.failure.id != second.failure.id


def test_amount_borrowed_from_a_different_line_is_rejected(resolver, lines):
    """Cross-column theft: cite one row, report another row's number."""
    pell = find_line(lines, "Federal Pell Grant")          # $4,500
    merit = find_line(lines, "Presidential Merit Scholarship")  # $20,000

    result = resolver.resolve(
        label="Federal Pell Grant",
        amount=20000,
        citations=cite(pell.line_id, pell.text),
    )

    assert not result.ok
    assert result.failure.reason == "amount_mismatch"
    assert merit.line_id != pell.line_id


# --- tolerance: typographic noise, not semantic drift -----------------------


def test_dot_leader_and_whitespace_variance_is_tolerated(resolver, lines):
    line = find_line(lines, "Meridian Opportunity Grant")

    # The model collapses the dot leader, as models routinely do.
    result = resolver.resolve(
        label="Meridian Opportunity Grant",
        amount=12400,
        citations=cite(line.line_id, "Meridian Opportunity Grant ... $12,400"),
    )

    assert result.ok
    assert result.evidence[0].verification.amount_matched


def test_case_variance_is_tolerated(resolver, lines):
    line = find_line(lines, "Tuition and Fees")
    result = resolver.resolve(
        label="Tuition",
        amount=34800,
        citations=cite(line.line_id, "TUITION AND FEES ... $34,800"),
    )
    assert result.ok


def test_unpriced_claim_needs_only_a_real_quote(resolver, lines):
    """Conditions carry no amount, so only the quote must verify."""
    line = find_line(lines, "cumulative grade point average")
    result = resolver.resolve(label="GPA condition", amount=None, citations=cite(line.line_id, line.text))
    assert result.ok
    assert result.evidence[0].verification.amount_matched is False


# --- helpers ----------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("$34,800", 34800.0),
        ("34,800", 34800.0),
        ("$1,200.50", 1200.50),
        ("no digits here", None),
    ],
)
def test_parse_amount(text, expected):
    assert parse_amount(text) == expected


def test_locate_returns_offsets_into_the_original_string():
    line = "Federal  Pell   Grant ....... $4,500"
    span = locate("Federal Pell Grant", line)
    assert span is not None
    start, end = span
    assert line[start:end].startswith("Federal")
    assert line[start:end].endswith("Grant")
