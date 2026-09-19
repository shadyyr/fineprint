#!/usr/bin/env python3
"""Build and publish the cached demo-sample catalog.

The default mode is deterministic: it validates the committed sample fixture,
mirrors it into ``web/public/samples/``, and writes the UI manifest. Passing
``--refresh-live`` first runs the synthetic per-term letter through the real
OpenAI extraction pipeline and evidence gate, then stores that result as a
cached (not live) sample.

Usage:
    .venv/bin/python scripts/make_demo_samples.py --refresh-live
    .venv/bin/python scripts/make_demo_samples.py
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"
CORPUS = ROOT / "corpus"
FIXTURES = ROOT / "fixtures" / "samples"
PUBLIC = ROOT / "web" / "public" / "samples"

sys.path.insert(0, str(API))
sys.path.insert(0, str(CORPUS))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(API / ".env")

from extract import available  # noqa: E402
from ingest import ingest  # noqa: E402
from models import CanonicalDocument  # noqa: E402
from pipeline import analyze_document  # noqa: E402
from run_corpus import diff_expected, invariant_violations  # noqa: E402

SLUG = "summit-per-term"
SOURCE_PDF = CORPUS / "letters" / "per_term_offer.pdf"
EXPECTED = CORPUS / "expected" / "per_term_offer.json"
FIXTURE_PDF = FIXTURES / f"{SLUG}.pdf"
FIXTURE_JSON = FIXTURES / f"{SLUG}.json"

MANIFEST = [
    {
        "slug": "meridian",
        "title": "Meridian State University",
        "layout": "Two-page award letter",
        "note": "A conventional offer whose merit scholarship has an unresolved period.",
        "pdf": "/sample_offer.pdf",
        "json": "/sample_offer.json",
    },
    {
        "slug": SLUG,
        "title": "Summit Technical College",
        "layout": "Fall/Spring term worksheet",
        "note": "Tests two-column period normalization and a separate scholarship with no stated period.",
        "pdf": f"/samples/{SLUG}.pdf",
        "json": f"/samples/{SLUG}.json",
    },
]


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def _validate_cached_sample(document: CanonicalDocument) -> None:
    if document.extraction_meta.source != "cached":
        raise ValueError("demo analysis must be labelled as cached")
    if not document.document.synthetic:
        raise ValueError("demo document must be labelled as synthetic")
    if document.document.source_file_name != FIXTURE_PDF.name:
        raise ValueError("canonical source filename must match the published PDF")


def _comparison_copy(
    document: CanonicalDocument, expected: dict[str, object]
) -> CanonicalDocument:
    """Align typographic label variants before the strict answer-key diff.

    Model wording remains untouched in the published artifact. This copy only
    makes the validator treat title casing and Unicode/ASCII dash choices as
    cosmetic; every financial and ambiguity field is still compared exactly.
    """

    def key(value: str) -> str:
        return re.sub(r"\s*[\-\u2010-\u2015]\s*", " - ", value).casefold().strip()

    comparable = document.model_copy(deep=True)
    expected_institution = expected.get("institution_name")
    if (
        isinstance(expected_institution, str)
        and comparable.document.institution_name
        and key(comparable.document.institution_name) == key(expected_institution)
    ):
        comparable.document.institution_name = expected_institution

    expected_labels = {
        key(row["label"]): row["label"]
        for row in expected.get("facts", [])
        if isinstance(row, dict) and isinstance(row.get("label"), str)
    }
    for item in (*comparable.costs, *comparable.aid):
        item.label = expected_labels.get(key(item.label), item.label)

    return comparable


def refresh_live() -> CanonicalDocument:
    """Run the live extractor and persist only a fully validated result."""
    if not available():
        raise RuntimeError("OPENAI_API_KEY is required in the environment or api/.env")

    ingested = ingest(SOURCE_PDF.read_bytes())
    if not ingested.text_layer_sufficient:
        raise RuntimeError("source PDF does not have a sufficient text layer")

    routed = analyze_document(ingested, source_file_name=FIXTURE_PDF.name)
    violations = invariant_violations(routed.document, routed.extraction)
    if violations:
        formatted = "\n  - ".join(violations)
        raise RuntimeError(f"evidence/invariant validation failed:\n  - {formatted}")

    expected = json.loads(EXPECTED.read_text())
    differences = diff_expected(_comparison_copy(routed.document, expected), expected)
    if differences:
        formatted = "\n  - ".join(differences)
        raise RuntimeError(f"live result differs from the hand-checked answer:\n  - {formatted}")

    # This JSON is a stored result of a live run. Keep the model name and
    # extraction timestamp, but make the provenance shown by the UI honest.
    routed.document.extraction_meta.source = "cached"
    routed.document.document.synthetic = True
    routed.document.document.source_file_name = FIXTURE_PDF.name

    document = CanonicalDocument.model_validate(routed.document.model_dump(mode="json"))
    _validate_cached_sample(document)

    FIXTURES.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE_PDF, FIXTURE_PDF)
    # The TypeScript contract represents nullable Python optionals as absent
    # object fields, matching the original committed Meridian fixture.
    _write_json(FIXTURE_JSON, document.model_dump(mode="json", exclude_none=True))

    reasons = ", ".join(routed.fallback_reasons) or "none"
    print(f"live extraction model: {routed.model}")
    print(f"fallback reasons: {reasons}")
    print(f"verified facts: {len(document.costs) + len(document.aid)}")
    print(f"unresolved ambiguities: {len(document.ambiguities)}")
    return document


def sync_public() -> CanonicalDocument:
    """Validate the fixture and deterministically mirror public artifacts."""
    if not FIXTURE_PDF.exists() or not FIXTURE_JSON.exists():
        raise FileNotFoundError(
            "cached sample is missing; run with --refresh-live to create it"
        )

    document = CanonicalDocument.model_validate_json(FIXTURE_JSON.read_text())
    _validate_cached_sample(document)

    # Canonicalize old/generated fixtures too, so the deterministic sync mode
    # always produces the same cross-language representation.
    _write_json(FIXTURE_JSON, document.model_dump(mode="json", exclude_none=True))
    PUBLIC.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(FIXTURE_PDF, PUBLIC / FIXTURE_PDF.name)
    shutil.copyfile(FIXTURE_JSON, PUBLIC / FIXTURE_JSON.name)
    _write_json(PUBLIC / "index.json", MANIFEST)
    return document


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--refresh-live",
        action="store_true",
        help="replace the cached fixture using the live extraction pipeline",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.refresh_live:
        refresh_live()
    document = sync_public()
    print(f"published {len(MANIFEST)} demo samples to {PUBLIC.relative_to(ROOT)}")
    print(
        "cached sample: "
        f"{document.document.institution_name}, source={document.extraction_meta.source}, "
        f"synthetic={str(document.document.synthetic).lower()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
