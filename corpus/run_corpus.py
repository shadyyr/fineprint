#!/usr/bin/env python3
"""Validate FinePrint against substantially different aid-letter layouts.

Default mode is deterministic and needs no API key: committed model-shaped
responses are loaded into ``ReplayExtractor`` and then passed through the real
evidence admission gate and normalizer.  ``--live`` swaps in OpenAIExtractor
without changing the comparison or invariants.

The pass bar is intentionally asymmetric. Missing a fact appears in the
ground-truth diff; admitting a claim whose evidence does not verify is an
invariant violation. An unresolved source ambiguity is expected when the
answer key contains it, while silently choosing a period fails the diff.

Usage:
    .venv/bin/python corpus/run_corpus.py
    .venv/bin/python corpus/run_corpus.py narrative_offer
    .venv/bin/python corpus/run_corpus.py --live
    .venv/bin/python corpus/run_corpus.py --json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"
CORPUS = ROOT / "corpus"
LETTERS = CORPUS / "letters"
RESPONSES = CORPUS / "responses"
EXPECTED = CORPUS / "expected"
sys.path.insert(0, str(API))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(API / ".env")

from evidence import all_amounts, parse_amount  # noqa: E402
from extract import (  # noqa: E402
    ReplayExtractor,
    available,
)
from ingest import ingest  # noqa: E402
from models import CanonicalDocument, ExtractionResult  # noqa: E402
from normalize import normalize  # noqa: E402
from pipeline import analyze_document  # noqa: E402


@dataclass
class LetterReport:
    name: str
    mode: str
    model: str | None
    passed: bool
    extracted_items: int
    model_claims: int
    evidence_verified_percent: float
    unresolved_ambiguities: int
    unverified_claims: int
    invariant_violations: list[str]
    expected_diff: list[str]


def _fact_record(kind: str, item: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "kind": kind,
        "label": item.label,
        "amount": item.amount,
        "period": item.period,
        "category": item.category,
        "role": item.role,
        "provenance": item.provenance,
    }
    if kind == "cost":
        record["direct_cost"] = item.direct_cost
    else:
        record["aid_type"] = item.aid_type
        if item.renewable is not None:
            record["renewable"] = item.renewable
    return record


def _actual_facts(doc: CanonicalDocument) -> list[dict[str, Any]]:
    return [
        *(_fact_record("cost", item) for item in doc.costs),
        *(_fact_record("aid", item) for item in doc.aid),
    ]


def _target_label(doc: CanonicalDocument, target: str) -> str:
    item_id = target.removesuffix(".period").removesuffix(".amount")
    for item in (*doc.costs, *doc.aid):
        if item.id == item_id:
            return item.label
    return target


def _actual_ambiguities(doc: CanonicalDocument) -> list[dict[str, Any]]:
    return [
        {
            "kind": ambiguity.kind,
            "target_label": _target_label(doc, ambiguity.target),
            "blocks_headline": ambiguity.blocks_headline,
            "severity": ambiguity.severity,
            "options": [
                {"value": option.value, "label": option.label}
                for option in ambiguity.options
            ],
        }
        for ambiguity in doc.ambiguities
    ]


def _compare_records(
    *,
    section: str,
    expected: list[dict[str, Any]],
    actual: list[dict[str, Any]],
    key_fields: tuple[str, ...],
) -> list[str]:
    """Compare one-to-one records, treating expected fields as assertions."""
    diffs: list[str] = []
    expected_map = {tuple(row.get(k) for k in key_fields): row for row in expected}
    actual_map = {tuple(row.get(k) for k in key_fields): row for row in actual}

    for key in sorted(expected_map.keys() - actual_map.keys(), key=str):
        diffs.append(f"{section}: missing {dict(zip(key_fields, key, strict=True))}")
    for key in sorted(actual_map.keys() - expected_map.keys(), key=str):
        diffs.append(f"{section}: unexpected {dict(zip(key_fields, key, strict=True))}")

    for key in sorted(expected_map.keys() & actual_map.keys(), key=str):
        wanted = expected_map[key]
        got = actual_map[key]
        for field, expected_value in wanted.items():
            actual_value = got.get(field)
            if actual_value != expected_value:
                label = ", ".join(f"{k}={v!r}" for k, v in zip(key_fields, key, strict=True))
                diffs.append(
                    f"{section}: {label}: {field} expected {expected_value!r}, "
                    f"got {actual_value!r}"
                )
    return diffs


def diff_expected(doc: CanonicalDocument, expected: dict[str, Any]) -> list[str]:
    diffs: list[str] = []
    if doc.document.institution_name != expected.get("institution_name"):
        diffs.append(
            "document: institution_name expected "
            f"{expected.get('institution_name')!r}, got {doc.document.institution_name!r}"
        )
    if doc.document.academic_year != expected.get("academic_year"):
        diffs.append(
            "document: academic_year expected "
            f"{expected.get('academic_year')!r}, got {doc.document.academic_year!r}"
        )

    diffs.extend(
        _compare_records(
            section="facts",
            expected=expected.get("facts", []),
            actual=_actual_facts(doc),
            key_fields=("kind", "label"),
        )
    )
    diffs.extend(
        _compare_records(
            section="ambiguities",
            expected=expected.get("ambiguities", []),
            actual=_actual_ambiguities(doc),
            key_fields=("kind", "target_label"),
        )
    )
    diffs.extend(
        _compare_records(
            section="missing_costs",
            expected=expected.get("missing_costs", []),
            actual=[{"category": row.category, "label": row.label} for row in doc.missing_costs],
            key_fields=("category", "label"),
        )
    )
    diffs.extend(
        _compare_records(
            section="unverified_claims",
            expected=expected.get("unverified_claims", []),
            actual=[
                {
                    "claimed_label": row.claimed_label,
                    "claimed_amount": row.claimed_amount,
                    "reason": row.reason,
                }
                for row in doc.unverified_claims
            ],
            key_fields=("claimed_label", "claimed_amount"),
        )
    )
    return diffs


def invariant_violations(
    doc: CanonicalDocument,
    extraction: ExtractionResult,
) -> list[str]:
    """Check properties that must hold independently of extraction quality."""
    problems: list[str] = []
    facts = [*doc.costs, *doc.aid]
    evidence_by_id = {row.id: row for row in doc.evidence}

    all_ids = [
        *(row.id for row in facts),
        *(row.id for row in doc.evidence),
        *(row.id for row in doc.ambiguities),
        *(row.id for row in doc.missing_costs),
        *(row.id for row in doc.unverified_claims),
    ]
    duplicates = sorted({ident for ident in all_ids if all_ids.count(ident) > 1})
    if duplicates:
        problems.append(f"duplicate canonical ids: {', '.join(duplicates)}")

    referenced_evidence = {
        evidence_id
        for item in facts
        for evidence_id in item.evidence_ids
    }
    verified_claim_keys = {
        (row.line_id, amount)
        for row in doc.evidence
        if row.id in referenced_evidence
        and row.verification.amount_matched
        and row.amount_text is not None
        and (amount := parse_amount(row.amount_text)) is not None
    }
    rejected_claims = {
        (row.claimed_label, row.claimed_amount)
        for row in doc.unverified_claims
    }
    unaccounted = [
        item.label
        for item in extraction.items
        if (item.label, item.amount) not in rejected_claims
        and not any(
            (citation.line_id, item.amount) in verified_claim_keys
            for citation in item.citations
        )
    ]
    if unaccounted:
        problems.append(
            "model item accounting mismatch; neither admitted nor rejected: "
            + ", ".join(unaccounted)
        )

    for item in facts:
        missing_evidence = [ev_id for ev_id in item.evidence_ids if ev_id not in evidence_by_id]
        if missing_evidence:
            problems.append(f"{item.label}: missing evidence ids {missing_evidence}")
            continue

        records = [evidence_by_id[ev_id] for ev_id in item.evidence_ids]
        if not records:
            problems.append(f"{item.label}: admitted without evidence")
            continue
        if any(row.status != "verified" or not row.verification.quote_found for row in records):
            problems.append(f"{item.label}: has evidence not marked verified")

        amount_records = [row for row in records if row.verification.amount_matched]
        if not amount_records:
            problems.append(f"{item.label}: no cited evidence verifies its amount")
        elif item.provenance == "derived":
            source_amounts = [
                amount
                for row in amount_records
                if row.amount_text is not None
                and (amount := parse_amount(row.amount_text)) is not None
            ]
            if not math.isclose(sum(source_amounts), item.amount, abs_tol=0.005):
                problems.append(
                    f"{item.label}: derived amount {item.amount:g} does not equal "
                    f"verified source sum {sum(source_amounts):g}"
                )
        elif not any(
            any(math.isclose(value, item.amount, abs_tol=0.005) for value in all_amounts(row.quote))
            for row in amount_records
        ):
            problems.append(f"{item.label}: verified evidence does not contain {item.amount:g}")

    admitted = {(item.label, item.amount) for item in facts}
    for claim in doc.unverified_claims:
        if (claim.claimed_label, claim.claimed_amount) in admitted:
            problems.append(
                f"{claim.claimed_label}: same claim appears as both fact and unverified"
            )

    ambiguity_targets = {
        ambiguity.target
        for ambiguity in doc.ambiguities
        if ambiguity.kind == "period_unknown" and ambiguity.blocks_headline
    }
    for item in facts:
        target = f"{item.id}.period"
        if item.period == "unknown" and target not in ambiguity_targets:
            problems.append(f"{item.label}: unknown period lacks a blocking ambiguity")

    fact_by_id = {item.id: item for item in facts}
    for ambiguity in doc.ambiguities:
        if ambiguity.kind != "amount_unclear":
            continue
        if not ambiguity.target.endswith(".amount"):
            problems.append(f"{ambiguity.id}: amount choice does not target .amount")
            continue
        target_id = ambiguity.target.removesuffix(".amount")
        target_item = fact_by_id.get(target_id)
        if target_item is None:
            problems.append(f"{ambiguity.id}: amount choice target does not exist")
            continue
        if ambiguity.severity != "material" or not ambiguity.blocks_headline:
            problems.append(f"{ambiguity.id}: amount choice is not material and blocking")
        if not ambiguity.options or any(
            not re.fullmatch(r"-?\d+(?:\.\d+)?", option.value)
            for option in ambiguity.options
        ):
            problems.append(f"{ambiguity.id}: amount options are not plain decimals")
            continue
        option_amounts = [float(option.value) for option in ambiguity.options]
        if not math.isclose(target_item.amount, option_amounts[0], abs_tol=0.005):
            problems.append(
                f"{ambiguity.id}: item amount is not the first displayed option"
            )
        ambiguity_records = [
            evidence_by_id[evidence_id]
            for evidence_id in ambiguity.evidence_ids
            if evidence_id in evidence_by_id
        ]
        verified_option_amounts = {
            amount
            for row in ambiguity_records
            if row.verification.amount_matched
            and row.amount_text is not None
            and (amount := parse_amount(row.amount_text)) is not None
        }
        missing_options = [
            amount
            for amount in option_amounts
            if not any(
                math.isclose(amount, verified, abs_tol=0.005)
                for verified in verified_option_amounts
            )
        ]
        if missing_options:
            problems.append(
                f"{ambiguity.id}: unverified amount options {missing_options}"
            )

    loan_categories = {
        "subsidized_loan",
        "unsubsidized_loan",
        "parent_plus_loan",
        "private_loan",
    }
    for item in doc.aid:
        if item.category in {"grant", "scholarship"} and item.aid_type != "gift":
            problems.append(f"{item.label}: gift-aid category classified as {item.aid_type}")
        if item.category in loan_categories and item.aid_type != "loan":
            problems.append(f"{item.label}: loan category classified as {item.aid_type}")
        if item.category == "work_study" and item.aid_type != "work_study":
            problems.append(f"{item.label}: work-study category classified as {item.aid_type}")

    for item in facts:
        if not item.components:
            continue
        missing = [component for component in item.components if component not in fact_by_id]
        if missing:
            problems.append(f"{item.label}: rollup names missing components {missing}")
            continue
        component_sum = sum(fact_by_id[component].amount for component in item.components)
        if not math.isclose(component_sum, item.amount, abs_tol=0.005):
            problems.append(
                f"{item.label}: rollup amount {item.amount:g} does not equal "
                f"component sum {component_sum:g}"
            )

    return problems


def _load_replay(name: str) -> ExtractionResult:
    response_path = RESPONSES / f"{name}.json"
    if not response_path.exists():
        raise FileNotFoundError(f"missing replay response: {response_path}")
    return ExtractionResult.model_validate_json(response_path.read_text())


def run_letter(name: str, *, live: bool) -> LetterReport:
    pdf_path = LETTERS / f"{name}.pdf"
    expected_path = EXPECTED / f"{name}.json"
    if not pdf_path.exists():
        raise FileNotFoundError(f"missing corpus letter: {pdf_path}")
    if not expected_path.exists():
        raise FileNotFoundError(f"missing expected answer: {expected_path}")

    ingested = ingest(pdf_path.read_bytes(), render_images=live)
    if not ingested.text_layer_sufficient:
        return LetterReport(
            name=name,
            mode="live" if live else "replay",
            model=None,
            passed=False,
            extracted_items=0,
            model_claims=0,
            evidence_verified_percent=0.0,
            unresolved_ambiguities=0,
            unverified_claims=0,
            invariant_violations=["document does not have a sufficient text layer"],
            expected_diff=[],
        )

    if live:
        routed = analyze_document(ingested, source_file_name=pdf_path.name)
        extraction = routed.extraction
        doc = routed.document
        model = routed.model
    else:
        replay = _load_replay(name)
        extractor = ReplayExtractor(replay)
        extraction = extractor.extract(ingested)
        doc = normalize(
            extraction,
            ingested,
            source_file_name=pdf_path.name,
            source="cached",
            model=f"replay:{name}",
        )
        model = f"replay:{name}"
    expected = json.loads(expected_path.read_text())
    violations = invariant_violations(doc, extraction)
    differences = diff_expected(doc, expected)

    extracted_items = len(doc.costs) + len(doc.aid)
    model_claims = len(extraction.items)
    referenced_evidence = {
        evidence_id
        for item in (*doc.costs, *doc.aid)
        for evidence_id in item.evidence_ids
    }
    verified_keys = {
        (row.line_id, amount)
        for row in doc.evidence
        if row.id in referenced_evidence
        and row.verification.amount_matched
        and row.amount_text is not None
        and (amount := parse_amount(row.amount_text)) is not None
    }
    verified_claims = sum(
        any((citation.line_id, item.amount) in verified_keys for citation in item.citations)
        for item in extraction.items
    )
    verified_percent = 100.0 if model_claims == 0 else verified_claims / model_claims * 100
    return LetterReport(
        name=name,
        mode="live" if live else "replay",
        model=model,
        passed=not violations and not differences,
        extracted_items=extracted_items,
        model_claims=model_claims,
        evidence_verified_percent=round(verified_percent, 1),
        unresolved_ambiguities=len(doc.ambiguities),
        unverified_claims=len(doc.unverified_claims),
        invariant_violations=violations,
        expected_diff=differences,
    )


def corpus_names() -> list[str]:
    return sorted(path.stem for path in EXPECTED.glob("*.json"))


def _print_report(report: LetterReport) -> None:
    status = "PASS" if report.passed else "FAIL"
    print(f"{report.name} [{status}] ({report.mode})")
    print(f"  model: {report.model or 'not reached'}")
    print(f"  items extracted: {report.extracted_items}/{report.model_claims} model claims")
    print(f"  evidence verified: {report.evidence_verified_percent:.1f}%")
    print(f"  unresolved ambiguities: {report.unresolved_ambiguities}")
    print(f"  unverified claims: {report.unverified_claims}")
    if report.invariant_violations:
        print(f"  invariant violations: {len(report.invariant_violations)}")
        for violation in report.invariant_violations:
            print(f"    - {violation}")
    else:
        print("  invariant violations: none")
    if report.expected_diff:
        print(f"  diff against expected: {len(report.expected_diff)} difference(s)")
        for difference in report.expected_diff:
            print(f"    - {difference}")
    else:
        print("  diff against expected: none")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "letters",
        nargs="*",
        metavar="LETTER",
        help="corpus stem(s) to run; defaults to every expected answer",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="use the live model instead of committed ReplayExtractor responses",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="print a machine-readable JSON report",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.live and not available():
        print(
            "error: --live requires OPENAI_API_KEY in the environment or api/.env",
            file=sys.stderr,
        )
        return 2

    names = args.letters or corpus_names()
    unknown = [name for name in names if name not in corpus_names()]
    if unknown:
        print(f"error: unknown corpus letter(s): {', '.join(unknown)}", file=sys.stderr)
        return 2

    reports: list[LetterReport] = []
    for name in names:
        try:
            reports.append(run_letter(name, live=args.live))
        except Exception as exc:  # noqa: BLE001 - one bad document must not hide the rest
            reports.append(
                LetterReport(
                    name=name,
                    mode="live" if args.live else "replay",
                    model=None,
                    passed=False,
                    extracted_items=0,
                    model_claims=0,
                    evidence_verified_percent=0.0,
                    unresolved_ambiguities=0,
                    unverified_claims=0,
                    invariant_violations=[f"harness error: {type(exc).__name__}: {exc}"],
                    expected_diff=[],
                )
            )

    if args.json_output:
        print(json.dumps([asdict(report) for report in reports], indent=2))
    else:
        for index, report in enumerate(reports):
            if index:
                print()
            _print_report(report)
        passed = sum(report.passed for report in reports)
        print(f"\nCorpus result: {passed}/{len(reports)} passed")

    return 0 if all(report.passed for report in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())
