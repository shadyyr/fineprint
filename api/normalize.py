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
import re
from datetime import datetime, timezone
from typing import Callable, TypeVar

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

_TERM_SUFFIX_RE = re.compile(
    r"^(?P<base>.+?)\s*(?:[\u2010-\u2015-]|,|\()\s*"
    r"(?P<term>fall|autumn|spring)"
    r"(?:\s+(?P<year>20\d{2}))?\s*\)?$",
    re.IGNORECASE,
)
_ACADEMIC_YEAR_RE = re.compile(
    r"(?P<start>20\d{2})\s*[-\u2010-\u2015/]\s*(?P<end>(?:20)?\d{2})"
)
_NON_SUMMABLE_COST_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bcost\s+after\s+(?:all\s+)?(?:aid|awards?|grants?|scholarships?)\b",
        r"\bafter[- ](?:aid|award)\s+(?:cost|balance|amount)\b",
        r"\bfamily\s+obligation\b",
        r"\b(?:fall|autumn|spring|winter|summer)(?:\s+20\d{2})?\s+"
        r"(?:estimate|amount\s+due|balance)\b",
        r"\b(?:monthly|per[- ]month)\s+(?:payment|installment)\b",
        r"\b(?:payment|installment)\s+(?:amount|schedule)\b",
        r"\bamount\s+due\s+(?:for|per|this)\b",
    )
)
_PLAIN_DECIMAL_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
_SUMMARY_PAREN_RE = re.compile(r"\([^)]*\bsummary\b[^)]*\)", re.IGNORECASE)
_REPEAT_LABEL_NOISE = {"offered", "subtotal", "summary", "total"}
_SINGULAR_LABEL_TOKEN = {
    "awards": "award",
    "grants": "grant",
    "loans": "loan",
    "scholarships": "scholarship",
    "totals": "total",
}

ItemT = TypeVar("ItemT", CostItem, AidItem)


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
    for size in range(1, limit + 1):
        for combo in itertools.combinations(candidates, size):
            if abs(sum(a for _, a in combo) - total) < _CENTS:
                return [ident for ident, _ in combo]
    return []


def _looks_like_rollup(label: str) -> bool:
    normalized = " ".join(label.lower().replace("—", " ").split())
    return any(marker in normalized for marker in _ROLLUP_LABEL_MARKERS)


def _looks_like_non_summable_cost_view(label: str, quotes: list[str]) -> bool:
    """Whether a verified figure is a balance/payment view, not a new cost.

    Quote verification proves a number exists, but it cannot prove that an
    after-aid balance or payment installment is an additive cost. These narrow
    language patterns keep those real figures visible as rollups while ensuring
    downstream sums never treat them as tuition, housing, or another expense.
    """
    context = " ".join((label, *quotes))
    return any(pattern.search(context) for pattern in _NON_SUMMABLE_COST_PATTERNS)


def _repeat_label_tokens(label: str) -> tuple[str, ...]:
    """Meaningful label tokens used only for exact-repeat coalescing.

    Summary tables commonly repeat a detailed row as ``Total X`` or
    ``X (Financial Aid Summary)``. Strip only those presentation words and
    normalize a few financial plurals; category, amount and period still have
    to agree independently before two facts can be coalesced.
    """
    without_summary = _SUMMARY_PAREN_RE.sub("", label.casefold())
    tokens = re.findall(r"[a-z0-9]+", without_summary)
    normalized = (
        _SINGULAR_LABEL_TOKEN.get(token, token)
        for token in tokens
        if token not in _REPEAT_LABEL_NOISE
    )
    return tuple(token for token in normalized if token not in _REPEAT_LABEL_NOISE)


def _labels_repeat_same_fact(left: str, right: str) -> bool:
    first = _repeat_label_tokens(left)
    second = _repeat_label_tokens(right)
    if not first or not second:
        return False
    if first == second:
        return True

    # Some tables say "Federal Direct Subsidized Loan" while the detailed row
    # says "Direct Subsidized Loan", or one section says "Total Loans" while
    # another says "Total Federal Loans". Permit only that one extra qualifier
    # and only for loan labels.
    shorter, longer = sorted((first, second), key=len)
    return (
        "loan" in shorter
        and len(longer) == len(shorter) + 1
        and tuple(token for token in longer if token != "federal") == shorter
    )


def _same_repeat_semantics(left: ItemT, right: ItemT) -> bool:
    if type(left) is not type(right):
        return False
    period_compatible = left.period == right.period or (
        {left.period, right.period} == {"annual", "total"}
        and (left.role == "rollup" or right.role == "rollup")
    )
    if abs(left.amount - right.amount) >= _CENTS or not period_compatible:
        return False
    if isinstance(left, CostItem) and isinstance(right, CostItem):
        category_compatible = left.category == right.category or (
            (left.role == "rollup" or right.role == "rollup")
            and "subtotal" in {left.category, right.category}
        )
        return (
            category_compatible
            and left.direct_cost == right.direct_cost
        )
    if isinstance(left, AidItem) and isinstance(right, AidItem):
        category_compatible = left.category == right.category or (
            (left.role == "rollup" or right.role == "rollup")
            and "subtotal" in {left.category, right.category}
        )
        renewable_compatible = (
            left.renewable is None
            or right.renewable is None
            or left.renewable == right.renewable
        )
        return (
            category_compatible
            and left.aid_type == right.aid_type
            and renewable_compatible
        )
    return False


def _merge_repeat(survivor: ItemT, repeated: ItemT) -> None:
    """Attach every verified occurrence to one canonical financial fact."""
    survivor.evidence_ids = list(
        dict.fromkeys((*survivor.evidence_ids, *repeated.evidence_ids))
    )
    survivor.confidence = max(survivor.confidence, repeated.confidence)
    # A model can mistake a table's "Total" column for the canonical
    # multi-year period. If an otherwise exact repeated fact is annual in one
    # occurrence and a rollup-shaped repeat says total, retain the explicit
    # annual interpretation. Ordinary item-vs-item period conflicts never
    # reach this merge.
    if {survivor.period, repeated.period} == {"annual", "total"}:
        survivor.period = "annual"
    if survivor.role == "rollup":
        survivor.components = list(
            dict.fromkeys((*(survivor.components or []), *(repeated.components or [])))
        ) or None
    if isinstance(survivor, AidItem) and isinstance(repeated, AidItem):
        if survivor.renewable is None:
            survivor.renewable = repeated.renewable
        survivor.conditions = list(
            dict.fromkeys((*(survivor.conditions or []), *(repeated.conditions or [])))
        ) or None


def _coalesce_repeated_facts(
    items: list[ItemT],
) -> tuple[list[ItemT], dict[str, ItemT]]:
    """Coalesce the same verified fact repeated in a summary table.

    An ordinary item wins over a rollup-shaped repetition so it remains in the
    financial calculation exactly once. The survivor keeps evidence from every
    location, so the X-Ray can still point to both the detail and summary rows.
    Same-dollar coincidences with different labels remain separate.
    """
    coalesced: list[ItemT] = []
    aliases: dict[str, ItemT] = {}

    for candidate in items:
        match_index = next(
            (
                index
                for index, existing in enumerate(coalesced)
                if _same_repeat_semantics(existing, candidate)
                and _labels_repeat_same_fact(existing.label, candidate.label)
            ),
            None,
        )
        if match_index is None:
            coalesced.append(candidate)
            continue

        existing = coalesced[match_index]
        if existing.role == "rollup" and candidate.role == "item":
            _merge_repeat(candidate, existing)
            coalesced[match_index] = candidate
            for label, target in tuple(aliases.items()):
                if target is existing:
                    aliases[label] = candidate
            aliases[existing.label] = candidate
        else:
            _merge_repeat(existing, candidate)
            aliases[candidate.label] = existing

    return coalesced, aliases


def _term_label(label: str) -> tuple[str, str, int | None] | None:
    """Return (base label, term, year) for an explicit term suffix.

    This is deliberately narrower than a general season parser. FinePrint only
    combines rows when the label itself identifies a conventional Fall/Spring
    partition; prose mentioning a term remains untouched.
    """
    match = _TERM_SUFFIX_RE.match(" ".join(label.split()))
    if not match:
        return None
    base = match.group("base").strip(" \t,;:-\u2010-\u2015()")
    if not base:
        return None
    term = match.group("term").casefold()
    if term == "autumn":
        term = "fall"
    year = int(match.group("year")) if match.group("year") else None
    return base, term, year


def _academic_year_bounds(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    match = _ACADEMIC_YEAR_RE.search(value)
    if not match:
        return None
    start = int(match.group("start"))
    raw_end = match.group("end")
    end = int(raw_end)
    if len(raw_end) == 2:
        end = start // 100 * 100 + end
    if end != start + 1:
        return None
    return start, end


def _term_semantics(item: CostItem | AidItem) -> tuple[object, ...]:
    """Fields that must agree before two term rows can represent one item."""
    if isinstance(item, CostItem):
        return (item.category, item.direct_cost, item.role)
    return (
        item.category,
        item.aid_type,
        item.renewable,
        tuple(item.conditions or []),
        item.role,
    )


def _is_complete_fall_spring(
    members: list[tuple[ItemT, str, int | None]],
    academic_year: str | None,
) -> bool:
    if len(members) != 2 or {term for _, term, _ in members} != {"fall", "spring"}:
        return False
    if any(item.period not in {"semester", "term"} for item, _, _ in members):
        return False

    years = {term: year for _, term, year in members}
    bounds = _academic_year_bounds(academic_year)
    if bounds:
        start, end = bounds
        return (
            years["fall"] in {None, start}
            and years["spring"] in {None, end}
        )

    # Without a document-level academic year, both labels must establish the
    # adjacent years themselves. A bare Fall/Spring pair is not enough proof.
    return (
        years["fall"] is not None
        and years["spring"] is not None
        and years["spring"] == years["fall"] + 1
    )


def _merge_term_partitions(
    items: list[ItemT],
    *,
    academic_year: str | None,
    unique: Callable[[str], str],
    prefix: str,
) -> tuple[list[ItemT], dict[str, ItemT]]:
    """Collapse verified Fall/Spring source rows into derived annual facts.

    Any explicitly term-labelled group that is not a complete, semantically
    consistent academic-year partition is changed to ``period=unknown``. That
    prevents downstream annualization from doubling a partial term and lets
    the standard ambiguity safety net ask the reader instead of guessing.
    """
    parsed: dict[str, tuple[str, str, int | None]] = {}
    groups: dict[tuple[object, ...], list[tuple[ItemT, str, int | None]]] = {}
    for item in items:
        term = _term_label(item.label)
        if not term:
            continue
        base, season, year = term
        parsed[item.id] = term
        key = (base.casefold(), *_term_semantics(item))
        groups.setdefault(key, []).append((item, season, year))

    replacements: dict[str, ItemT] = {}
    consumed: set[str] = set()
    aliases: dict[str, ItemT] = {}

    for members in groups.values():
        if not _is_complete_fall_spring(members, academic_year):
            for item, _, _ in members:
                item.period = "unknown"
            continue

        first = min((item for item, _, _ in members), key=items.index)
        base = parsed[first.id][0]
        ordered = sorted((item for item, _, _ in members), key=items.index)
        derived = first.model_copy(deep=True)
        derived.id = unique(f"{prefix}_{_slug(base, first.id)}")
        derived.label = base
        derived.amount = sum(item.amount for item in ordered)
        derived.period = "annual"
        derived.provenance = "derived"
        derived.confidence = min(item.confidence for item in ordered)
        derived.evidence_ids = list(
            dict.fromkeys(ev_id for item in ordered for ev_id in item.evidence_ids)
        )
        derived.components = None
        derived.ambiguity_ids = None

        replacements[first.id] = derived
        consumed.update(item.id for item in ordered)
        for item in ordered:
            aliases[item.label] = derived

    merged: list[ItemT] = []
    for item in items:
        if item.id in replacements:
            merged.append(replacements[item.id])
        elif item.id not in consumed:
            merged.append(item)
    return merged, aliases


def _apply_rollup_guard(costs: list[CostItem], aid: list[AidItem]) -> None:
    """Mark source/derived totals and attach their non-rollup components."""
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
            non_summable = _looks_like_non_summable_cost_view(
                item.label,
                [record.quote for record in resolution.evidence],
            )
            costs.append(
                CostItem(
                    id=ident,
                    label=item.label,
                    category=item.cost_category or "other",
                    amount=item.amount,
                    period=item.period,
                    direct_cost=bool(item.direct_cost),
                    role="rollup" if item.is_stated_total or non_summable else "item",
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

    # --- explicit academic-term partitions ----------------------------------
    # A semester amount normally annualizes x2 downstream. That is correct for
    # a single recurring semester rate, but not for a letter that gives the
    # actual Fall and Spring rows separately. Collapse only a complete,
    # explicitly-labelled pair. Partial/conflicting sets become unknown.

    costs, cost_term_aliases = _merge_term_partitions(
        costs,
        academic_year=extraction.academic_year,
        unique=unique,
        prefix="cost",
    )
    aid, aid_term_aliases = _merge_term_partitions(
        aid,
        academic_year=extraction.academic_year,
        unique=unique,
        prefix="aid",
    )

    # A summary near the end of a letter often repeats rows or subtotals from
    # the detailed tables. Keep one canonical fact, but retain verified
    # evidence from every occurrence. This also prevents an unflagged repeated
    # summary row from entering calculations twice.
    costs, cost_repeat_aliases = _coalesce_repeated_facts(costs)
    aid, aid_repeat_aliases = _coalesce_repeated_facts(aid)

    # --- deterministic double-count guard -----------------------------------
    # The model flags stated totals, but missing one would silently inflate
    # every figure downstream. So check arithmetically as well: an item equal
    # to the sum of a subset of its siblings is treated as a rollup regardless
    # of what the model said. Conservative in the right direction -- excluding
    # a real item understates aid, which the incompleteness flags surface,
    # whereas double counting it overstates aid silently.

    _apply_rollup_guard(costs, aid)

    # --- ambiguities ---------------------------------------------------------

    # Model-reported ambiguities, attached to the item they concern.
    by_label = {i.label: i for i in (*costs, *aid)}
    by_label.update(cost_term_aliases)
    by_label.update(aid_term_aliases)
    by_label.update(cost_repeat_aliases)
    by_label.update(aid_repeat_aliases)
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
        if raw.kind == "amount_unclear":
            # An amount choice can change headline math, so every numeric option
            # independently passes the same quote-and-amount admission gate as a
            # normal fact. Options are plain decimals for the frozen web schema.
            if target_item is None or any(
                not _PLAIN_DECIMAL_RE.fullmatch(option.value)
                for option in options
            ):
                if target_item is not None:
                    target_item.role = "rollup"
                continue

            option_amounts = [float(option.value) for option in options]
            option_resolutions = []
            options_verified = True
            for amount in option_amounts:
                resolution = resolver.resolve(
                    label=raw.target_label,
                    amount=amount,
                    citations=raw.citations,
                    prefix="amb",
                )
                if not resolution.ok:
                    assert resolution.failure is not None
                    unverified.append(resolution.failure)
                    options_verified = False
                    continue
                option_resolutions.append(resolution)

            if not options_verified or len(option_resolutions) != len(options):
                target_item.role = "rollup"
                continue

            option_evidence: list[list[str]] = []
            for resolution in option_resolutions:
                evidence.extend(resolution.evidence)
                ids = [record.id for record in resolution.evidence]
                option_evidence.append(ids)
                amb_evidence.extend(ids)

            # The canonical item carries the first displayed option while the
            # blocking ambiguity keeps it out of math until the reader chooses.
            target_item.amount = option_amounts[0]
            target_item.evidence_ids = list(
                dict.fromkeys((*target_item.evidence_ids, *option_evidence[0]))
            )
        elif raw.citations:
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
                target=(
                    f"{target_item.id}.period"
                    if target_item and raw.kind == "period_unknown"
                    else f"{target_item.id}.amount"
                    if target_item and raw.kind == "amount_unclear"
                    else target_item.id
                    if target_item
                    else raw.target_label
                ),
                severity=(
                    "material"
                    if raw.kind in {"period_unknown", "amount_unclear"}
                    else "minor"
                ),
                question=raw.question,
                why=raw.why,
                options=options,
                blocks_headline=raw.kind in {"period_unknown", "amount_unclear"},
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
        linked = [
            ambiguity.id
            for ambiguity in ambiguities
            if ambiguity.target == item.id
            or ambiguity.target.startswith(f"{item.id}.")
        ]
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
