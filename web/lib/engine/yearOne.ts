/**
 * Year 1 financial picture.
 *
 * Deterministic. Reads source facts, applies user resolutions, applies
 * scenario assumptions, and returns figures that each carry an account of
 * what they had to leave out.
 */

import type { AidItem, CanonicalDocument, CostItem } from "../schema";
import { money, subtractMoney, sumMoney } from "./money";
import { annualize, blockingAmbiguity, effectiveAmount, effectivePeriod } from "./periods";
import type {
  Assumptions,
  Exclusion,
  Money,
  Overrides,
  YearOne,
} from "./types";

/** An item resolved to an annual figure, or the reason it could not be. */
export interface ResolvedItem {
  id: string;
  label: string;
  annual: number | null;
  derived: boolean;
  note?: string;
  exclusion?: Exclusion;
}

/**
 * Only `item` rows participate in arithmetic.
 *
 * Rollups ("Total Financial Aid Package") are stated totals that duplicate
 * their own components. They are kept for display and comparison but never
 * summed (master context section 15).
 */
export function summableCosts(doc: CanonicalDocument): CostItem[] {
  return doc.costs.filter((c) => c.role === "item");
}

export function summableAid(doc: CanonicalDocument): AidItem[] {
  return doc.aid.filter((a) => a.role === "item");
}

export function rollupAid(doc: CanonicalDocument): AidItem | undefined {
  return doc.aid.find((a) => a.role === "rollup");
}

/**
 * The letter's own "total aid" figure, quoted as the headline -- only when the
 * letter states exactly one, and states it for the year. A per-term letter's
 * "Term Aid Package -- Fall" is one semester, not the letter's total; adding
 * the terms up would be FinePrint's arithmetic presented as the letter's words.
 * No single stated annual total means no headline quote.
 */
export function headlineRollup(doc: CanonicalDocument): AidItem | undefined {
  // Only a figure printed on the letter can be quoted as "the letter says";
  // a total the pipeline derived (say, Fall + Spring) is not the letter's words.
  const rollups = doc.aid.filter((a) => a.role === "rollup" && a.provenance === "source");
  return rollups.length === 1 && rollups[0].period === "annual" ? rollups[0] : undefined;
}

/** Resolve one item to an annual amount under the current overrides. */
export function resolveItem(
  item: CostItem | AidItem,
  doc: CanonicalDocument,
  overrides: Overrides,
  assumptions: Assumptions,
): ResolvedItem {
  const settled = effectiveAmount(item.id, item.amount, overrides, doc.ambiguities);
  if (settled.amount === null) {
    return {
      id: item.id,
      label: item.label,
      annual: null,
      derived: false,
      exclusion: {
        id: `excl_${item.id}`,
        label: item.label,
        amount: null,
        reason: "ambiguity_unresolved",
        detail: "The letter lists more than one amount and doesn't say which applies.",
        ambiguityId: settled.blocking?.id,
      },
    };
  }
  const amount = settled.amount;
  const { period } = effectivePeriod(
    item.id,
    item.period,
    overrides,
    doc.ambiguities,
  );

  const result = annualize(amount, period, assumptions.programYears);

  if (!result.ok) {
    const amb = blockingAmbiguity(item.id, overrides, doc.ambiguities);
    return {
      id: item.id,
      label: item.label,
      annual: null,
      derived: false,
      exclusion: {
        id: `excl_${item.id}`,
        label: item.label,
        amount,
        reason: result.reason,
        detail: result.detail,
        ambiguityId: amb?.id,
      },
    };
  }

  return {
    id: item.id,
    label: item.label,
    annual: result.annual,
    derived: result.derived,
    note: result.note,
  };
}

function toMoney(resolved: ResolvedItem[]): Money {
  const included = resolved.filter((r) => r.annual !== null);
  const excluded = resolved
    .map((r) => r.exclusion)
    .filter((e): e is Exclusion => Boolean(e));
  return {
    value: included.reduce((acc, r) => acc + (r.annual ?? 0), 0),
    complete: excluded.length === 0,
    excluded,
  };
}

/**
 * Apply the housing scenario to the cost list.
 *
 * `commute` drops billed housing and meals. It deliberately does not invent a
 * commuting cost: the offer does not state one, so transportation stays a
 * declared missing cost rather than becoming a made-up number.
 */
function applyHousing(
  costs: ResolvedItem[],
  doc: CanonicalDocument,
  assumptions: Assumptions,
): ResolvedItem[] {
  if (assumptions.housing === "as_offered") return costs;

  const byId = new Map(doc.costs.map((c) => [c.id, c]));
  const isResidential = (id: string) => {
    const cat = byId.get(id)?.category;
    return cat === "housing" || cat === "meals";
  };

  const kept = costs.filter((c) => !isResidential(c.id));

  if (assumptions.housing === "commute") return kept;

  const custom = assumptions.customHousingCost ?? 0;
  return [
    ...kept,
    {
      id: "assumed_housing",
      label: "Housing and meals (your figure)",
      annual: custom,
      derived: true,
      note: "Your assumption, replacing the housing and meal costs in the offer.",
    },
  ];
}

/**
 * Missing costs the document named but never priced.
 *
 * Each becomes an exclusion on the cost of attendance unless the user has
 * supplied an estimate, so the headline can never imply the letter's stated
 * total is the whole bill.
 */
function missingCostEntries(
  doc: CanonicalDocument,
  overrides: Overrides,
): { added: ResolvedItem[]; exclusions: Exclusion[] } {
  const added: ResolvedItem[] = [];
  const exclusions: Exclusion[] = [];

  for (const mc of doc.missing_costs) {
    const estimate = overrides.missingCostEstimates[mc.id];
    if (typeof estimate === "number") {
      added.push({
        id: mc.id,
        label: `${mc.label} (your estimate)`,
        annual: estimate,
        derived: true,
        note: "Your figure. The offer does not state this cost.",
      });
    } else {
      exclusions.push({
        id: `excl_${mc.id}`,
        label: mc.label,
        amount: null,
        reason: "cost_missing",
        detail: mc.reason,
      });
    }
  }

  return { added, exclusions };
}

export function computeYearOne(
  doc: CanonicalDocument,
  overrides: Overrides,
  assumptions: Assumptions,
): YearOne {
  const resolvedCosts = summableCosts(doc).map((c) =>
    resolveItem(c, doc, overrides, assumptions),
  );
  const scenarioCosts = applyHousing(resolvedCosts, doc, assumptions);
  const missing = missingCostEntries(doc, overrides);

  const costsMoney = toMoney([...scenarioCosts, ...missing.added]);
  const costOfAttendance: Money = {
    value: costsMoney.value,
    complete: costsMoney.complete && missing.exclusions.length === 0,
    excluded: [...costsMoney.excluded, ...missing.exclusions],
  };

  const directIds = new Set(
    doc.costs.filter((c) => c.direct_cost && c.role === "item").map((c) => c.id),
  );
  const directCosts = toMoney(
    scenarioCosts.filter((c) => directIds.has(c.id) || c.id === "assumed_housing"),
  );

  const resolvedAid = summableAid(doc).map((a) => ({
    item: a,
    resolved: resolveItem(a, doc, overrides, assumptions),
  }));

  const byType = (type: AidItem["aid_type"]) =>
    toMoney(
      resolvedAid
        .filter(({ item }) => (overrides.itemOverrides[item.id]?.aidType ?? item.aid_type) === type)
        .map(({ resolved }) => resolved),
    );

  const giftAid = byType("gift");
  const loansOffered = byType("loan");
  const workStudyOffered = byType("work_study");

  const loansAccepted = toMoney(
    resolvedAid
      .filter(
        ({ item }) =>
          (overrides.itemOverrides[item.id]?.aidType ?? item.aid_type) === "loan" &&
          assumptions.loansAccepted[item.id] === true,
      )
      .map(({ resolved }) => resolved),
  );

  const amountToCover = subtractMoney(costOfAttendance, giftAid);

  // Work-study only offsets the bill when the user explicitly assumes it
  // will be earned in full. Off by default (master context section 13).
  const offsets = assumptions.countWorkStudyTowardCosts
    ? sumMoney([loansAccepted, workStudyOffered])
    : loansAccepted;
  const outOfPocket = subtractMoney(amountToCover, offsets);

  const rollup = headlineRollup(doc);
  const headlineAidTotal = rollup ? money(rollup.amount) : null;

  return {
    headlineAidTotal,
    costOfAttendance,
    directCosts,
    giftAid,
    loansOffered,
    loansAccepted,
    workStudyOffered,
    amountToCover,
    outOfPocket,
  };
}
