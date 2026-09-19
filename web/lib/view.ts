/**
 * View model: turns the canonical document and the engine's derived figures
 * into the shapes the UI draws.
 *
 * No arithmetic about the student's money happens here beyond grouping and
 * summing what the engine and the document already establish. The engine owns
 * the financial model; this file owns presentation categories.
 */

import type { IconName } from "@/components/Icon";
import {
  blockingAmbiguity,
  effectiveAmount,
  effectivePeriod,
  headlineRollup,
  resolveItem,
  summableAid,
  type Assumptions,
  type Overrides,
} from "@/lib/engine";
import type {
  AidItem,
  AnyItem,
  CanonicalDocument,
  CostItem,
  Period,
} from "@/lib/schema";
import { isAid } from "@/lib/schema";

export type CategoryKey = "gift" | "later" | "unclear" | "loan" | "work" | "cost";

export interface CategoryMeta {
  label: string;
  /** Plain-language meaning, shown next to the label. */
  meaning: string;
  icon: IconName;
  /** CSS color for marks. Never used for text. */
  color: string;
  wash: string;
}

export const CATEGORY: Record<CategoryKey, CategoryMeta> = {
  gift: {
    label: "Gift aid",
    meaning: "You don't repay it",
    icon: "gift",
    color: "var(--color-gift)",
    wash: "var(--color-gift-wash)",
  },
  later: {
    label: "Later years",
    meaning: "Counted now, paid out in future years",
    icon: "later",
    color: "var(--color-later)",
    wash: "rgb(138 142 152 / 0.12)",
  },
  unclear: {
    label: "Needs your answer",
    meaning: "The letter doesn't say enough",
    icon: "unclear",
    color: "var(--color-unclear)",
    wash: "var(--color-unclear-wash)",
  },
  loan: {
    label: "Loans",
    meaning: "You repay it, with interest",
    icon: "loan",
    color: "var(--color-loan)",
    wash: "var(--color-loan-wash)",
  },
  work: {
    label: "Work-study",
    meaning: "You earn it by working",
    icon: "work",
    color: "var(--color-work)",
    wash: "var(--color-work-wash)",
  },
  cost: {
    label: "Costs",
    meaning: "What the school charges or estimates",
    icon: "cost",
    color: "var(--color-cost)",
    wash: "var(--color-cost-wash)",
  },
};

export const PERIOD_TEXT: Record<Period, string> = {
  annual: "per year",
  semester: "per semester",
  term: "per term",
  total: "in total",
  unknown: "period not stated",
};

function effectiveType(item: AidItem, overrides: Overrides) {
  return overrides.itemOverrides[item.id]?.aidType ?? item.aid_type;
}

/** Display category for an item under the current answers. */
export function categoryOf(
  item: AnyItem,
  doc: CanonicalDocument,
  overrides: Overrides,
): CategoryKey {
  if (!isAid(item)) return "cost";
  if (blockingAmbiguity(item.id, overrides, doc.ambiguities)) return "unclear";
  switch (effectiveType(item, overrides)) {
    case "gift":
      return "gift";
    case "loan":
      return "loan";
    case "work_study":
      return "work";
    default:
      return "unclear";
  }
}

export interface Segment {
  key: CategoryKey;
  amount: number;
  itemIds: string[];
}

export interface Breakdown {
  /** The letter's own stated aid total, if it printed one. */
  headline: number | null;
  segments: Segment[];
  /** Sum of the segments; equals the headline when the letter's total is consistent. */
  total: number;
}

/**
 * What the letter's aid figure is actually made of.
 *
 * Segments use the amounts the letter prints, so they add back up to its own
 * total -- that is what makes the decomposition a fair X-ray of the headline
 * rather than a different number. The one adjustment: a gift the user has
 * confirmed is a multi-year total is split into this year's share and the
 * part the headline counted early.
 */
export function aidBreakdown(
  doc: CanonicalDocument,
  overrides: Overrides,
  assumptions: Assumptions,
): Breakdown {
  const sums: Record<CategoryKey, Segment> = {
    gift: { key: "gift", amount: 0, itemIds: [] },
    later: { key: "later", amount: 0, itemIds: [] },
    unclear: { key: "unclear", amount: 0, itemIds: [] },
    loan: { key: "loan", amount: 0, itemIds: [] },
    work: { key: "work", amount: 0, itemIds: [] },
    cost: { key: "cost", amount: 0, itemIds: [] },
  };

  for (const item of summableAid(doc)) {
    const faceOrNull = effectiveAmount(item.id, item.amount, overrides, doc.ambiguities).amount;
    // An amount the letter leaves open is not part of any segment yet.
    if (faceOrNull === null) continue;
    const face = faceOrNull;
    const category = categoryOf(item, doc, overrides);

    if (category === "gift") {
      const { period } = effectivePeriod(item.id, item.period, overrides, doc.ambiguities);
      const resolved = resolveItem(item, doc, overrides, assumptions);
      if (period === "total" && resolved.annual !== null) {
        sums.gift.amount += resolved.annual;
        sums.gift.itemIds.push(item.id);
        const deferred = face - resolved.annual;
        if (deferred > 0) {
          sums.later.amount += deferred;
          sums.later.itemIds.push(item.id);
        }
        continue;
      }
    }

    sums[category].amount += face;
    sums[category].itemIds.push(item.id);
  }

  // Validated adjacency order for the stacked bar.
  const order: CategoryKey[] = ["gift", "later", "unclear", "loan", "work"];
  const segments = order.map((k) => sums[k]).filter((s) => s.amount > 0);
  const headline = headlineRollup(doc)?.amount ?? null;

  return {
    headline,
    segments,
    total: segments.reduce((acc, s) => acc + s.amount, 0),
  };
}

export interface XRayRow {
  id: string;
  label: string;
  /** Null while the letter leaves the amount open (e.g. in-state or out-of-state). */
  amount: number | null;
  category: CategoryKey;
  isTotal: boolean;
  /** FinePrint added this up from several of the letter's lines (e.g. Fall + Spring). */
  derived: boolean;
  periodText: string;
  conditions: string[];
  evidenceIds: string[];
  ambiguityId?: string;
}

export interface XRayGroup {
  key: string;
  title: string;
  meaning: string;
  icon: IconName;
  color: string;
  rows: XRayRow[];
  /** Totals are listed for reference only and never re-added. */
  note?: string;
}

function toRow(item: AnyItem, doc: CanonicalDocument, overrides: Overrides): XRayRow {
  const { period } = effectivePeriod(item.id, item.period, overrides, doc.ambiguities);
  const amb = blockingAmbiguity(item.id, overrides, doc.ambiguities);
  const { amount } = effectiveAmount(item.id, item.amount, overrides, doc.ambiguities);
  return {
    id: item.id,
    label: item.label,
    amount,
    category: categoryOf(item, doc, overrides),
    isTotal: item.role === "rollup",
    derived: item.provenance === "derived",
    periodText: amount === null ? "amount depends on your answer" : PERIOD_TEXT[period],
    conditions: isAid(item) ? item.conditions ?? [] : [],
    evidenceIds: item.evidence_ids,
    ambiguityId: amb?.id,
  };
}

export function xrayGroups(doc: CanonicalDocument, overrides: Overrides): XRayGroup[] {
  const aidRows = doc.aid.filter((a) => a.role === "item").map((a) => toRow(a, doc, overrides));
  const costRows = doc.costs
    .filter((c) => c.role === "item")
    .map((c: CostItem) => toRow(c, doc, overrides));
  const totals = [...doc.aid, ...doc.costs]
    .filter((i) => i.role === "rollup")
    .map((i) => toRow(i, doc, overrides));

  const by = (key: CategoryKey) => aidRows.filter((r) => r.category === key);
  const group = (key: CategoryKey, rows: XRayRow[]): XRayGroup => ({
    key,
    title: CATEGORY[key].label,
    meaning: CATEGORY[key].meaning,
    icon: CATEGORY[key].icon,
    color: CATEGORY[key].color,
    rows,
  });

  const groups: XRayGroup[] = [
    group("unclear", by("unclear")),
    group("gift", by("gift")),
    group("loan", by("loan")),
    group("work", by("work")),
    group("cost", costRows),
  ].filter((g) => g.rows.length > 0);

  if (totals.length) {
    groups.push({
      key: "totals",
      title: "The letter's own totals",
      meaning: "Shown for reference, never added again",
      icon: "total",
      color: "var(--color-ink-3)",
      rows: totals,
      note: "Each of these equals the sum of rows above, so counting it would double the money.",
    });
  }
  return groups;
}

/** Which category colors each piece of evidence, for document highlights. */
export function evidenceCategories(
  doc: CanonicalDocument,
  overrides: Overrides,
): Map<string, { category: CategoryKey; itemId: string; isTotal: boolean }> {
  const out = new Map<string, { category: CategoryKey; itemId: string; isTotal: boolean }>();
  for (const item of [...doc.aid, ...doc.costs]) {
    const category = categoryOf(item, doc, overrides);
    for (const ev of item.evidence_ids) {
      // Specific items win over totals when both cite the same line.
      const existing = out.get(ev);
      if (!existing || (existing.isTotal && item.role !== "rollup")) {
        out.set(ev, { category, itemId: item.id, isTotal: item.role === "rollup" });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Four years and what-if
// ---------------------------------------------------------------------------

export interface RenewalLever {
  id: string;
  label: string;
  conditions: string[];
  /** False while the letter's period for this award is still an open question. */
  available: boolean;
}

export interface LoanLever {
  id: string;
  label: string;
  amount: number;
  subsidized: boolean;
}

/**
 * The scenario controls this particular letter supports.
 *
 * Derived from the document, so a letter with no loans shows no loan toggles
 * and a letter with no renewable award shows no renewal switch. Only awards the
 * letter marks renewable or conditional get a renewal switch: those are the
 * ones whose continuation is actually in question.
 */
export function scenarioLevers(
  doc: CanonicalDocument,
  overrides: Overrides,
  assumptions: Assumptions,
) {
  const aid = summableAid(doc);
  const type = (a: AidItem) => overrides.itemOverrides[a.id]?.aidType ?? a.aid_type;
  // Controls say "a year", so they show the engine's yearly figure -- and an
  // item whose period the letter leaves open gets no control at all rather
  // than a raw amount the engine itself refuses to count (Codex, log 065).
  const annual = (item: AnyItem) => resolveItem(item, doc, overrides, assumptions).annual;

  const renewals: RenewalLever[] = aid
    .filter((a) => type(a) === "gift" && (a.renewable || (a.conditions?.length ?? 0) > 0))
    .map((a) => ({
      id: a.id,
      label: a.label,
      conditions: a.conditions ?? [],
      available: !blockingAmbiguity(a.id, overrides, doc.ambiguities),
    }));

  const loans: LoanLever[] = aid
    .filter((a) => type(a) === "loan")
    .flatMap((a) => {
      const amount = annual(a);
      return amount === null
        ? []
        : [{ id: a.id, label: a.label, amount, subsidized: a.category === "subsidized_loan" }];
    });

  const workStudy = aid
    .filter((a) => type(a) === "work_study")
    .reduce((acc, a) => acc + (annual(a) ?? 0), 0);

  const residential = doc.costs
    .filter((c) => c.role === "item" && (c.category === "housing" || c.category === "meals"))
    .reduce((acc, c) => acc + (annual(c) ?? 0), 0);

  return { renewals, loans, workStudy, residential };
}

/**
 * True when a scenario changes nothing the letter says.
 *
 * Renewal and loan maps are compared by meaning, not shape: an award absent from
 * `renewals` and one explicitly set to true are both "renewed".
 */
export function isLetterAsWritten(a: Assumptions): boolean {
  return (
    a.costGrowthRate === 0 &&
    a.housing === "as_offered" &&
    !a.countWorkStudyTowardCosts &&
    !Object.values(a.renewals).some((v) => v === false) &&
    !Object.values(a.loansAccepted).some((v) => v === true)
  );
}
