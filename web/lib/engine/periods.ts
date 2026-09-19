/**
 * Period normalization.
 *
 * The hard rule (master context sections 12 and 24): when the document does
 * not establish a period, the engine does not pick one. Not from the size of
 * the amount, not from what sibling line items do, not from convention. An
 * unresolvable period returns a failure that the caller must surface as an
 * exclusion, which is what keeps unknown amounts out of headline figures.
 */

import type { Ambiguity, Period } from "../schema";
import type { Exclusion, Overrides } from "./types";

export type AnnualResult =
  | { ok: true; annual: number; derived: boolean; note?: string }
  | { ok: false; reason: Exclusion["reason"]; detail: string };

/**
 * Ambiguity option values that imply a period.
 *
 * `four_year_total` resolves to `total`; the span itself comes from
 * `Assumptions.programYears`, so a three-year program spreads it correctly.
 */
const PERIOD_FROM_OPTION: Record<string, Period> = {
  annual: "annual",
  semester: "semester",
  term: "term",
  total: "total",
  four_year_total: "total",
};

/**
 * Convert an amount to an annual figure.
 *
 * `derived: true` marks a value the engine computed rather than read, so the
 * UI can label it as inferred arithmetic rather than a stated number.
 */
export function annualize(
  amount: number,
  period: Period,
  programYears: number,
): AnnualResult {
  switch (period) {
    case "annual":
      return { ok: true, annual: amount, derived: false };

    case "semester":
      // A US academic year is two semesters by definition. Safe to double.
      return {
        ok: true,
        annual: amount * 2,
        derived: true,
        note: "Doubled from a per-semester amount (two semesters per academic year).",
      };

    case "total":
      if (programYears <= 0) {
        return {
          ok: false,
          reason: "period_unknown",
          detail: "Cannot spread a total without a program length.",
        };
      }
      return {
        ok: true,
        annual: amount / programYears,
        derived: true,
        note: `Spread evenly across ${programYears} years.`,
      };

    case "term":
      // "Term" does not fix a count: semesters, trimesters and quarters all
      // use the word. Guessing here would silently change the answer by 50%.
      return {
        ok: false,
        reason: "term_count_unknown",
        detail:
          "The offer states a per-term amount but not how many terms are in an academic year.",
      };

    case "unknown":
      return {
        ok: false,
        reason: "period_unknown",
        detail: "The offer does not state whether this amount is annual, per term, or a total.",
      };
  }
}

/**
 * The period to use for an item, after applying any user resolution.
 *
 * Returns the stated period unchanged unless the user has answered an
 * ambiguity targeting this item's period, or overridden it directly.
 */
export function effectivePeriod(
  itemId: string,
  statedPeriod: Period,
  overrides: Overrides,
  ambiguities: Ambiguity[],
): { period: Period; fromUser: boolean } {
  const direct = overrides.itemOverrides[itemId]?.period;
  if (direct) return { period: direct, fromUser: true };

  const target = `${itemId}.period`;
  for (const amb of ambiguities) {
    if (amb.target !== target) continue;
    const answer = overrides.ambiguityAnswers[amb.id];
    if (!answer) continue;
    const mapped = PERIOD_FROM_OPTION[answer];
    if (mapped) return { period: mapped, fromUser: true };
  }

  return { period: statedPeriod, fromUser: false };
}

/** The ambiguity blocking this item (its period or its amount), if still unanswered. */
export function blockingAmbiguity(
  itemId: string,
  overrides: Overrides,
  ambiguities: Ambiguity[],
): Ambiguity | undefined {
  return ambiguities.find(
    (a) =>
      (a.target === `${itemId}.period` || a.target === `${itemId}.amount`) &&
      a.blocks_headline &&
      !overrides.ambiguityAnswers[a.id],
  );
}

/**
 * The amount to use for an item, or null while the letter leaves it open.
 *
 * An `amount_unclear` ambiguity (say, a letter listing both an in-state and an
 * out-of-state rate without saying which applies) holds the item out until the
 * student picks an option; each option's value is the amount as a decimal
 * string. The stored `amount` is only a placeholder until then -- never
 * counted, never shown as the answer.
 */
export function effectiveAmount(
  itemId: string,
  statedAmount: number,
  overrides: Overrides,
  ambiguities: Ambiguity[],
): { amount: number | null; blocking?: Ambiguity } {
  const direct = overrides.itemOverrides[itemId]?.amount;
  if (typeof direct === "number") return { amount: direct };

  const amb = ambiguities.find(
    (a) => a.kind === "amount_unclear" && a.target === `${itemId}.amount`,
  );
  if (!amb) return { amount: statedAmount };

  const chosen = Number(overrides.ambiguityAnswers[amb.id]);
  if (overrides.ambiguityAnswers[amb.id] !== undefined && Number.isFinite(chosen)) {
    return { amount: chosen };
  }
  return amb.blocks_headline ? { amount: null, blocking: amb } : { amount: statedAmount };
}
