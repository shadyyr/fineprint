"""Turn verified claims into the canonical model.

Runs after the admission gate. Responsibilities, all deterministic:

  - Split items into costs and aid.
  - Detect stated totals and exclude them from sums, so a "Total Financial Aid
    Package" row never gets added on top of the rows it totals.
  - Raise an ambiguity for every amount whose period the document did not
    establish, and mark it as blocking headline figures.
  - Collect everything that failed verification into unverified_claims.

No arithmetic on the student's behalf happens here. This produces the facts;
the TypeScript engine computes from them.
"""

from __future__ import annotations

import itertools
from datetime import datetime, timezone

from evidence import EvidenceResolver
from ingest import IngestResult
from models import (
    AidItem,
    Ambiguity,
    AmbiguityOption,
    CanonicalDocument,
    CostItem,
    DocumentInfo,
    Evidence,
    ExtractionMeta,
    ExtractionResult,
    MissingCost,
    PageInfo,
    TextLayer,
    UnverifiedClaim,
)

# Largest subset searched when trying to explain a stated total.
_MAX_COMPONENTS = 6
_CENTS = 0.005

# Arithmetic equality alone cannot prove that a row is a rollup. In real aid
# tables, a $6,000 Pell Grant can coincidentally equal a $2,500 state grant plus
# a $3,500 loan. Only use the deterministic fallback when the row's own label
# signals aggregation. Explicit model-flagged totals still get component
# analysis even if their wording is unusual.
_ROLLUP_LABEL_MARKERS = (
    "total",
    "subtotal",
    "cost of attendance",
    "direct billed costs",
    "aid package",
    "term charges",
)


def _slug(text: str, fallback: str) -> str:
    cleaned = "".join(c.lower() if c.isalnum() else "_" for c in text).strip("_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned[:48] or fallback


def _find_components(
    total: float, candidates: list[tuple[str, float]]
) -> list[str]:
    """Which items add up to `total`. Best effort, for display only.

    Tries the whole set first (the common case for a grand total), then small
    combinations. Returns [] when nothing explains it, which is itself worth
    surfacing: a total that matches no subset usually means a row was missed.
    """
    if not candidates:
        return []

    everything = sum(amount for _, amount in candidates)
    if abs(everything - total) < _CENTS:
        return [ident for ident, _ in candidates]

    limit = min(len(candidates), _MAX_COMPONENTS)
    for size in range(2, limit + 1):
        for combo in itertools.combinations(candidates, size):
            if abs(sum(a for _, a in combo) - total) < _CENTS:
                return [ident for ident, _ in combo]
    return []


def _looks_like_rollup(label: str) -> bool:
    normalized = " ".join(label.lower().replace("—", " ").split())
    return any(marker in normalized for marker in _ROLLUP_LABEL_MARKERS)


def normalize(
    extraction: ExtractionResult,
    ingested: IngestResult,
    *,
    source_file_name: str,
    source: str = "live",
    model: str | None = None,
) -> CanonicalDocument:
    """Build a CanonicalDocument from model claims plus document geometry."""
    resolver = EvidenceResolver(ingested.line_map())

    evidence: list[Evidence] = []
    unverified: list[UnverifiedClaim] = []
    costs: list[CostItem] = []
    aid: list[AidItem] = []
    ambiguities: list[Ambiguity] = []
    missing: list[MissingCost] = []

    seen_ids: set[str] = set()

    def unique(base: str) -> str:
        ident, n = base, 1
        while ident in seen_ids:
            n += 1
            ident = f"{base}_{n}"
        seen_ids.add(ident)
        return ident

    # --- items: verify, then split ------------------------------------------

    for index, item in enumerate(extraction.items):
        prefix = "cost" if item.kind == "cost" else "aid"
        resolution = resolver.resolve(
            label=item.label,
            amount=item.amount,
            citations=item.citations,
            prefix=prefix,
        )

        if not resolution.ok:
            # Failed the admission gate. It is an observation, not a fact.
            assert resolution.failure is not None
            unverified.append(resolution.failure)
            continue

        evidence.extend(resolution.evidence)
        evidence_ids = [e.id for e in resolution.evidence]
        ident = unique(f"{prefix}_{_slug(item.label, str(index))}")

        if item.kind == "cost":
            costs.append(
                CostItem(
                    id=ident,
                    label=item.label,
                    category=item.cost_category or "other",
                    amount=item.amount,
                    period=item.period,
                    direct_cost=bool(item.direct_cost),
                    role="rollup" if item.is_stated_total else "item",
                    provenance="source",
                    confidence=item.confidence,
                    evidence_ids=evidence_ids,
                )
            )
        else:
            aid.append(
                AidItem(
                    id=ident,
                    label=item.label,
                    category=item.aid_category or "other_aid",
                    aid_type=item.aid_type or "unknown",
                    amount=item.amount,
                    period=item.period,
                    role="rollup" if item.is_stated_total else "item",
                    provenance="source",
                    confidence=item.confidence,
                    evidence_ids=evidence_ids,
                    renewable=item.renewable,
                    conditions=item.conditions or None,
                )
            )

    # --- deterministic double-count guard -----------------------------------
    # The model flags stated totals, but missing one would silently inflate
    # every figure downstream. So check arithmetically as well: an item equal
    # to the sum of a subset of its siblings is treated as a rollup regardless
    # of what the model said. Conservative in the right direction -- excluding
    # a real item understates aid, which the incompleteness flags surface,
    # whereas double counting it overstates aid silently.

    for group in (costs, aid):
        for candidate in group:
            siblings = [
                (other.id, other.amount)
                for other in group
                if other.id != candidate.id and other.role == "item"
            ]
            components = _find_components(candidate.amount, siblings)
            if candidate.role == "rollup":
                candidate.components = components or None
            elif (
                components
                and len(components) >= 2
                and _looks_like_rollup(candidate.label)
            ):
                candidate.role = "rollup"
                candidate.components = components

    # --- ambiguities ---------------------------------------------------------

    # Model-reported ambiguities, attached to the item they concern.
    by_label = {i.label: i for i in (*costs, *aid)}
    for n, raw in enumerate(extraction.ambiguities):
        target_item = by_label.get(raw.target_label)
        options = [
            AmbiguityOption(
                value=o.value or f"option_{k}",
                label=o.label or o.value,
                detail=o.detail,
            )
            for k, o in enumerate(raw.options)
        ]
        if len(options) < 2:
            continue

        amb_evidence: list[str] = []
        if raw.citations:
            resolution = resolver.resolve(
                label=raw.target_label, amount=None, citations=raw.citations, prefix="amb"
            )
            if resolution.ok:
                evidence.extend(resolution.evidence)
                amb_evidence = [e.id for e in resolution.evidence]

        ambiguities.append(
            Ambiguity(
                id=unique(f"amb_{_slug(raw.target_label, str(n))}"),
                kind=raw.kind,
                target=f"{target_item.id}.period" if target_item and raw.kind == "period_unknown"
                else (target_item.id if target_item else raw.target_label),
                severity="material" if raw.kind == "period_unknown" else "minor",
                question=raw.question,
                why=raw.why,
                options=options,
                blocks_headline=raw.kind == "period_unknown",
                evidence_ids=amb_evidence or (target_item.evidence_ids if target_item else []),
            )
        )

    # Safety net: every unknown period must raise a blocking ambiguity, even if
    # the model did not think to. Without this an unknown amount would simply
    # vanish from the totals with no way for the user to resolve it.
    targeted = {a.target for a in ambiguities}
    for item in (*costs, *aid):
        target = f"{item.id}.period"
        if item.period != "unknown" or target in targeted:
            continue
        ambiguities.append(
            Ambiguity(
                id=unique(f"amb_{_slug(item.label, item.id)}_period"),
                kind="period_unknown",
                target=target,
                severity="material",
                question=(
                    f"Is the ${item.amount:,.0f} {item.label} an annual amount, or a "
                    "total spread across the whole program?"
                ),
                why=(
                    "The offer states this amount without saying whether it applies "
                    "each year or in total, and FinePrint will not guess."
                ),
                options=[
                    AmbiguityOption(
                        value="annual",
                        label=f"${item.amount:,.0f} per year",
                    ),
                    AmbiguityOption(
                        value="four_year_total",
                        label=f"${item.amount:,.0f} in total",
                        detail=f"About ${item.amount / 4:,.0f} per year over four years.",
                    ),
                ],
                blocks_headline=True,
                evidence_ids=item.evidence_ids,
            )
        )

    for item in (*costs, *aid):
        linked = [a.id for a in ambiguities if a.target.startswith(f"{item.id}.")]
        if linked:
            item.ambiguity_ids = linked

    # --- missing costs -------------------------------------------------------

    for n, raw_missing in enumerate(extraction.missing_costs):
        ev_ids: list[str] = []
        if raw_missing.citations:
            resolution = resolver.resolve(
                label=raw_missing.label,
                amount=None,
                citations=raw_missing.citations,
                prefix="missing",
            )
            if resolution.ok:
                evidence.extend(resolution.evidence)
                ev_ids = [e.id for e in resolution.evidence]

        missing.append(
            MissingCost(
                id=unique(f"missing_{_slug(raw_missing.label, str(n))}"),
                category=raw_missing.category,
                label=raw_missing.label,
                reason=raw_missing.reason,
                evidence_ids=ev_ids,
            )
        )

    return CanonicalDocument(
        document=DocumentInfo(
            institution_name=extraction.institution_name,
            academic_year=extraction.academic_year,
            source_file_name=source_file_name,
            pages=[
                PageInfo(
                    page=p.page,
                    width_pt=p.width_pt,
                    height_pt=p.height_pt,
                    rotation=p.rotation,
                )
                for p in ingested.pages
            ],
        ),
        extraction_meta=ExtractionMeta(
            source=source,
            model=model,
            extracted_at=datetime.now(timezone.utc).isoformat(),
            text_layer=TextLayer(
                sufficient=ingested.text_layer_sufficient,
                char_count=ingested.char_count,
            ),
            counts={
                "verified": len(evidence),
                "unverified": len(unverified),
                "costs": len(costs),
                "aid": len(aid),
            },
        ),
        costs=costs,
        aid=aid,
        evidence=evidence,
        ambiguities=ambiguities,
        missing_costs=missing,
        unverified_claims=unverified,
    )
