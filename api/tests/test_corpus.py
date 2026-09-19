"""Regression tests discovered by the multi-layout replay corpus."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API = Path(__file__).resolve().parent.parent
ROOT = API.parent
CORPUS = ROOT / "corpus"
sys.path.insert(0, str(API))
sys.path.insert(0, str(CORPUS))

from run_corpus import run_letter  # noqa: E402


@pytest.mark.parametrize(
    "name",
    [
        "college_financing_plan",
        "narrative_offer",
        "payment_schedule_offer",
        "per_term_offer",
        "residency_rates_offer",
    ],
)
def test_replay_corpus_passes_without_an_api_key(name):
    report = run_letter(name, live=False)

    assert report.passed, [*report.invariant_violations, *report.expected_diff]


def test_arithmetic_coincidence_does_not_turn_grants_into_rollups():
    """$4,900 and $5,100 each equal other aid combinations in the sheet."""
    report = run_letter("per_term_offer", live=False)

    assert not any("Summit STEM Grant" in diff for diff in report.expected_diff)


def test_after_aid_and_payment_views_are_never_summable_costs():
    report = run_letter("payment_schedule_offer", live=False)

    assert report.passed, [*report.invariant_violations, *report.expected_diff]


def test_residency_rate_options_are_verified_and_block_headline_math():
    report = run_letter("residency_rates_offer", live=False)

    assert report.passed, [*report.invariant_violations, *report.expected_diff]


def test_bad_replay_claims_are_reported_not_admitted():
    report = run_letter("narrative_offer", live=False)

    assert report.extracted_items == 7
    assert report.model_claims == 9
    assert report.unverified_claims == 2
    assert report.evidence_verified_percent == 77.8
