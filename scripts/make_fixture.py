"""Generate fixtures/sample_offer.json from the generated sample PDF.

The emitted fixture is the integration contract: the UI and the TypeScript
financial engine are built against it before the extraction pipeline exists,
and it doubles as the offline fallback and as M5 ground truth for the
synthetic letter.

Geometry comes from running the real ingest pipeline over the real generated
PDF, not from estimated font metrics, so the fixture's boxes are exactly what
extraction produces at runtime -- to the character. letter_content supplies
only the semantics (which line means what).

Nothing here is model output. This is the hand-authored answer key.

Usage:  .venv/bin/python scripts/make_fixture.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from ingest import ingest  # noqa: E402
from letter_content import PAGE_HEIGHT, PAGE_WIDTH, ROTATION, line_ids  # noqa: E402
from make_sample_pdf import OUT as PDF_OUT, draw  # noqa: E402

OUT = ROOT / "fixtures" / "sample_offer.json"

IDS = line_ids()

# Regenerate the PDF first so the fixture can never describe a stale document.
draw(PDF_OUT)
IR = ingest(PDF_OUT.read_bytes(), render_images=False)
LINES = IR.line_map()

# The authored line numbering must survive extraction, or every evidence
# pointer in the fixture is aimed at the wrong row.
_missing = [k for k, lid in IDS.items() if lid not in LINES]
if _missing:
    raise SystemExit(f"ingest did not produce expected line ids for: {_missing}")


def _round(bbox) -> list[float]:
    return [round(v, 5) for v in bbox]


def evidence_for(key: str, amount: str | None = None, ev_id: str | None = None) -> dict:
    """Build a verified evidence record from the extracted line.

    Mirrors exactly what api/evidence.py produces at runtime: the full line is
    the quote, and when the line carries an amount the box is also narrowed to
    just that amount so the UI can highlight the number itself.
    """
    line = LINES[IDS[key]]
    rec = {
        "id": ev_id or f"ev_{key}",
        "line_id": line.line_id,
        "page": line.page,
        "quote": line.text,
        "bbox": _round(line.bbox),
        "status": "verified",
        "verification": {"quote_found": True, "amount_matched": amount is not None},
    }
    if amount:
        start = line.text.find(amount)
        if start < 0:
            raise SystemExit(f"{key}: {amount!r} not found in extracted line")
        sub = line.substring_bbox(start, start + len(amount))
        rec["amount_bbox"] = _round(sub)
        rec["amount_text"] = amount
    return rec


def cost(id_, label, category, amount, key, *, direct, role="item",
         period="annual", components=None, confidence=0.98) -> dict:
    item = {
        "id": id_,
        "label": label,
        "category": category,
        "amount": amount,
        "period": period,
        "direct_cost": direct,
        "role": role,
        "provenance": "source",
        "confidence": confidence,
        "evidence_ids": [f"ev_{key}"],
    }
    if components:
        item["components"] = components
    return item


def aid(id_, label, category, aid_type, amount, key, *, period="annual",
        role="item", renewable=None, conditions=None, components=None,
        ambiguity_ids=None, extra_evidence=None, confidence=0.97) -> dict:
    item = {
        "id": id_,
        "label": label,
        "category": category,
        "aid_type": aid_type,
        "amount": amount,
        "period": period,
        "role": role,
        "provenance": "source",
        "confidence": confidence,
        "evidence_ids": [f"ev_{key}"] + list(extra_evidence or []),
    }
    if renewable is not None:
        item["renewable"] = renewable
    if conditions:
        item["conditions"] = conditions
    if components:
        item["components"] = components
    if ambiguity_ids:
        item["ambiguity_ids"] = ambiguity_ids
    return item


def build() -> dict:
    costs = [
        cost("cost_tuition", "Tuition and Fees", "tuition", 34800,
             "cost_tuition", direct=True),
        cost("cost_housing", "Housing (Standard Double Room)", "housing", 9200,
             "cost_housing", direct=True),
        cost("cost_meals", "Meal Plan (Silver, 14 meals per week)", "meals", 6100,
             "cost_meals", direct=True),
        # Rollup: equals tuition + housing + meals. Excluded from sums so the
        # engine cannot double count (master context section 15).
        cost("cost_direct_subtotal", "Direct Billed Costs", "subtotal", 50100,
             "cost_direct_subtotal", direct=True, role="rollup",
             components=["cost_tuition", "cost_housing", "cost_meals"]),
        cost("cost_books", "Books and Supplies (estimated)", "books", 1200,
             "cost_books", direct=False),
        # Rollup: direct subtotal + books.
        cost("cost_coa_total", "Total Cost of Attendance", "subtotal", 51300,
             "cost_coa_total", direct=False, role="rollup",
             components=["cost_direct_subtotal", "cost_books"]),
    ]

    merit_conditions = [
        "Renewable for up to four years of undergraduate study",
        "Maintain a cumulative grade point average of 3.25 or higher",
        "Enroll in at least 12 credit hours per semester",
    ]

    aids = [
        aid("aid_meridian_grant", "Meridian Opportunity Grant", "grant", "gift",
            12400, "aid_meridian_grant"),
        aid("aid_pell", "Federal Pell Grant", "grant", "gift", 4500, "aid_pell"),
        # The centerpiece ambiguity. The table states no period and the page 2
        # prose ("renewable for up to four years") does not settle whether the
        # figure is annual or the four-year total. period stays "unknown" and
        # the engine must refuse to guess.
        aid("aid_merit", "Presidential Merit Scholarship", "scholarship", "gift",
            20000, "aid_merit", period="unknown", renewable=True,
            conditions=merit_conditions,
            ambiguity_ids=["amb_merit_period"],
            extra_evidence=["ev_cond_merit_1", "ev_cond_merit_2", "ev_cond_merit_3"],
            confidence=0.88),
        aid("aid_sub_loan", "Federal Direct Subsidized Loan", "subsidized_loan",
            "loan", 3500, "aid_sub_loan",
            extra_evidence=["ev_cond_loans_1"]),
        aid("aid_unsub_loan", "Federal Direct Unsubsidized Loan",
            "unsubsidized_loan", "loan", 2000, "aid_unsub_loan",
            extra_evidence=["ev_cond_loans_1"]),
        aid("aid_work_study", "Federal Work-Study", "work_study", "work_study",
            3000, "aid_work_study",
            conditions=["Earned as wages for hours actually worked",
                        "Not credited directly to the student account"],
            extra_evidence=["ev_cond_ws_1", "ev_cond_ws_2", "ev_cond_ws_3"]),
        # Rollup: the headline number. Equals the sum of the six items above,
        # which is exactly why quoting it as "aid" is misleading.
        aid("aid_package_total", "Total Financial Aid Package", "subtotal",
            "unknown", 45400, "aid_package_total", role="rollup",
            components=["aid_meridian_grant", "aid_pell", "aid_merit",
                        "aid_sub_loan", "aid_unsub_loan", "aid_work_study"],
            extra_evidence=["ev_headline_total"]),
    ]

    evidence = [
        evidence_for("cost_tuition", "$34,800"),
        evidence_for("cost_housing", "$9,200"),
        evidence_for("cost_meals", "$6,100"),
        evidence_for("cost_direct_subtotal", "$50,100"),
        evidence_for("cost_books", "$1,200"),
        evidence_for("cost_coa_total", "$51,300"),
        evidence_for("aid_meridian_grant", "$12,400"),
        evidence_for("aid_pell", "$4,500"),
        evidence_for("aid_merit", "$20,000"),
        evidence_for("aid_sub_loan", "$3,500"),
        evidence_for("aid_unsub_loan", "$2,000"),
        evidence_for("aid_work_study", "$3,000"),
        evidence_for("aid_package_total", "$45,400"),
        evidence_for("headline_total", "$45,400"),
        evidence_for("cond_merit_1"),
        evidence_for("cond_merit_2"),
        evidence_for("cond_merit_3"),
        evidence_for("cond_loans_1"),
        evidence_for("cond_ws_1"),
        evidence_for("cond_ws_2"),
        evidence_for("cond_ws_3"),
        evidence_for("cond_missing_1"),
        evidence_for("cond_missing_2"),
    ]

    ambiguities = [
        {
            "id": "amb_merit_period",
            "kind": "period_unknown",
            "target": "aid_merit.period",
            "severity": "material",
            "question": (
                "Is the $20,000 Presidential Merit Scholarship awarded each year, "
                "or is it the total across four years?"
            ),
            "why": (
                "The award table gives no period, and the renewal language on page 2 "
                "says the scholarship is renewable for up to four years without "
                "stating whether $20,000 is the annual or the total amount."
            ),
            "options": [
                {
                    "value": "annual",
                    "label": "$20,000 per year",
                    "detail": "Up to $80,000 across four years if renewed each year.",
                },
                {
                    "value": "four_year_total",
                    "label": "$20,000 total over four years",
                    "detail": "About $5,000 per year.",
                },
            ],
            "blocks_headline": True,
            "evidence_ids": ["ev_aid_merit", "ev_cond_merit_1", "ev_cond_merit_2",
                             "ev_cond_merit_3"],
        }
    ]

    # Named on page 2 as excluded, with no amount given. Represented as
    # missing rather than zero (master context section 15).
    missing_costs = [
        {
            "id": "missing_transportation",
            "category": "transportation",
            "label": "Transportation",
            "reason": "Named on page 2 as not included in this offer. No amount provided.",
            "evidence_ids": ["ev_cond_missing_2"],
        },
        {
            "id": "missing_personal",
            "category": "personal",
            "label": "Personal expenses",
            "reason": "Named on page 2 as not included in this offer. No amount provided.",
            "evidence_ids": ["ev_cond_missing_2"],
        },
        {
            "id": "missing_health_insurance",
            "category": "health_insurance",
            "label": "Health insurance",
            "reason": "Named on page 2 as not included in this offer. No amount provided.",
            "evidence_ids": ["ev_cond_missing_2"],
        },
    ]

    return {
        "schema_version": "1.0",
        "document": {
            "institution_name": "Meridian State University",
            "academic_year": "2026-2027",
            "currency": "USD",
            "source_file_name": "sample_offer.pdf",
            "synthetic": True,
            "pages": [
                {
                    "page": p.page,
                    "width_pt": p.width_pt,
                    "height_pt": p.height_pt,
                    "rotation": p.rotation,
                }
                for p in IR.pages
            ],
        },
        "extraction_meta": {
            "source": "fixture",
            "model": None,
            "extracted_at": None,
            "text_layer": {
                "sufficient": IR.text_layer_sufficient,
                "char_count": IR.char_count,
            },
            "counts": {
                "verified": len(evidence),
                "unverified": 0,
                "costs": len(costs),
                "aid": len(aids),
            },
        },
        "costs": costs,
        "aid": aids,
        "evidence": evidence,
        "ambiguities": ambiguities,
        "missing_costs": missing_costs,
        "unverified_claims": [],
    }


def check(doc: dict) -> None:
    """Fail loudly if the answer key contradicts itself.

    These are the same invariants api/normalize.py enforces at runtime; running
    them here keeps a hand-edited fixture from drifting into an invalid state.
    """
    items = doc["costs"] + doc["aid"]
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids)), "duplicate item id"

    ev_ids = {e["id"] for e in doc["evidence"]}
    assert len(ev_ids) == len(doc["evidence"]), "duplicate evidence id"
    for item in items:
        assert item["evidence_ids"], f"{item['id']} has no evidence"
        for ref in item["evidence_ids"]:
            assert ref in ev_ids, f"{item['id']} cites missing evidence {ref}"

    # Every quote must really be the text of the line it cites, and every
    # stated amount must really appear in that quote. This is the fixture-time
    # mirror of the runtime admission gate, checked against the actual PDF.
    for ev in doc["evidence"]:
        line = LINES[ev["line_id"]]
        assert ev["quote"] == line.text, f"{ev['id']} quote does not match line"
        assert ev["page"] == line.page, f"{ev['id']} cites the wrong page"
        if "amount_text" in ev:
            assert ev["amount_text"] in ev["quote"], f"{ev['id']} amount not in quote"

    # Rollups must equal the sum of their components, and must be the only
    # items excluded from totals.
    by_id = {i["id"]: i for i in items}
    for item in items:
        if item["role"] == "rollup":
            total = sum(by_id[c]["amount"] for c in item["components"])
            assert total == item["amount"], (
                f"{item['id']} claims {item['amount']} but components sum to {total}"
            )

    # Amounts in item records must match the amount actually printed on the page.
    ev_by_id = {e["id"]: e for e in doc["evidence"]}
    for item in items:
        primary = ev_by_id[item["evidence_ids"][0]]
        if "amount_text" in primary:
            printed = int(primary["amount_text"].replace("$", "").replace(",", ""))
            assert printed == item["amount"], (
                f"{item['id']} amount {item['amount']} != printed {printed}"
            )

    # An unknown period must never carry a concrete period elsewhere.
    for item in items:
        if item["period"] == "unknown":
            assert item.get("ambiguity_ids"), (
                f"{item['id']} has unknown period but raises no ambiguity"
            )

    gift = sum(a["amount"] for a in doc["aid"]
               if a["aid_type"] == "gift" and a["role"] == "item")
    loans = sum(a["amount"] for a in doc["aid"]
                if a["aid_type"] == "loan" and a["role"] == "item")
    ws = sum(a["amount"] for a in doc["aid"]
             if a["aid_type"] == "work_study" and a["role"] == "item")
    headline = next(a for a in doc["aid"] if a["id"] == "aid_package_total")["amount"]
    assert gift + loans + ws == headline, "categories do not reconcile to headline"
    print(f"  gift {gift:,} + loans {loans:,} + work-study {ws:,} = {headline:,}")


def sync_to_public() -> None:
    """Mirror the sample artifacts into web/public.

    The browser needs both to run the sample path and the offline fallback
    with the API stopped, which is the demo-resilience requirement.
    """
    public = ROOT / "web" / "public"
    public.mkdir(parents=True, exist_ok=True)
    (public / "sample_offer.pdf").write_bytes(PDF_OUT.read_bytes())
    (public / "sample_offer.json").write_bytes(OUT.read_bytes())
    print(f"synced sample_offer.pdf and sample_offer.json -> {public.relative_to(ROOT)}")


if __name__ == "__main__":
    doc = build()
    check(doc)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}  "
          f"({len(doc['costs'])} costs, {len(doc['aid'])} aid, "
          f"{len(doc['evidence'])} evidence, {len(doc['ambiguities'])} ambiguities, "
          f"{len(doc['missing_costs'])} missing costs)")
    sync_to_public()
