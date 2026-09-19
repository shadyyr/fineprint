"""Contract checks for the generated public demo-sample catalog."""

from __future__ import annotations

import json
import sys
from pathlib import Path

API = Path(__file__).resolve().parent.parent
ROOT = API.parent
sys.path.insert(0, str(API))

from models import CanonicalDocument  # noqa: E402

SLUG = "summit-per-term"
FIXTURES = ROOT / "fixtures" / "samples"
PUBLIC = ROOT / "web" / "public" / "samples"


def test_cached_demo_sample_is_valid_and_byte_identical_to_public_copy():
    fixture_pdf = FIXTURES / f"{SLUG}.pdf"
    fixture_json = FIXTURES / f"{SLUG}.json"

    assert fixture_pdf.read_bytes() == (PUBLIC / fixture_pdf.name).read_bytes()
    assert fixture_json.read_bytes() == (PUBLIC / fixture_json.name).read_bytes()

    document = CanonicalDocument.model_validate_json(fixture_json.read_text())
    assert document.document.institution_name == "Summit Technical College"
    assert document.document.synthetic is True
    assert document.extraction_meta.source == "cached"
    assert document.extraction_meta.model == "gpt-5.6-sol"
    assert len(document.costs) == 10
    assert len(document.aid) == 13
    assert len(document.ambiguities) == 1
    assert document.ambiguities[0].kind == "period_unknown"
    assert document.ambiguities[0].blocks_headline is True
    assert document.unverified_claims == []


def test_demo_manifest_lists_meridian_first_and_uses_exact_contract():
    manifest = json.loads((PUBLIC / "index.json").read_text())

    assert len(manifest) == 2
    assert manifest[0]["slug"] == "meridian"
    assert manifest[0]["pdf"] == "/sample_offer.pdf"
    assert manifest[0]["json"] == "/sample_offer.json"
    assert manifest[1]["slug"] == SLUG
    assert manifest[1]["pdf"] == f"/samples/{SLUG}.pdf"
    assert manifest[1]["json"] == f"/samples/{SLUG}.json"
    assert all(
        set(entry) == {"slug", "title", "layout", "note", "pdf", "json"}
        for entry in manifest
    )


def test_demo_json_omits_python_none_fields_for_typescript_optionals():
    payload = json.loads((FIXTURES / f"{SLUG}.json").read_text())

    assert "components" not in payload["costs"][0]
    assert "renewable" not in payload["aid"][0]
    assert "amount_bbox" not in next(
        evidence for evidence in payload["evidence"] if not evidence["verification"]["amount_matched"]
    )
