/**
 * Arithmetic that carries uncertainty.
 *
 * Every figure FinePrint shows is a `Money`: a number plus the list of
 * amounts that could not be included in it. Exclusions propagate through
 * addition and subtraction, so a total is marked incomplete if anything
 * feeding it was incomplete. This is what stops an unresolved $20,000
 * scholarship from quietly disappearing into a confident-looking total.
 */

import type { Exclusion, Money } from "./types";

export { money } from "./types";

/** Dedupe exclusions by id, preserving first-seen order. */
function mergeExclusions(lists: Exclusion[][]): Exclusion[] {
  const seen = new Set<string>();
  const out: Exclusion[] = [];
  for (const list of lists) {
    for (const ex of list) {
      if (seen.has(ex.id)) continue;
      seen.add(ex.id);
      out.push(ex);
    }
  }
  return out;
}

export function sumMoney(parts: Money[]): Money {
  const excluded = mergeExclusions(parts.map((p) => p.excluded));
  return {
    value: parts.reduce((acc, p) => acc + p.value, 0),
    complete: excluded.length === 0,
    excluded,
  };
}

/**
 * a - b, carrying both sides' exclusions.
 *
 * Note the asymmetry this creates and why it is correct: if gift aid excludes
 * an unresolved award, the resulting "amount to cover" is an over-estimate,
 * and the carried exclusion is what lets the UI say so rather than presenting
 * the figure as settled.
 */
export function subtractMoney(a: Money, b: Money): Money {
  const excluded = mergeExclusions([a.excluded, b.excluded]);
  return {
    value: a.value - b.value,
    complete: excluded.length === 0,
    excluded,
  };
}

export function scaleMoney(m: Money, factor: number): Money {
  return {
    value: m.value * factor,
    complete: m.complete,
    excluded: m.excluded,
  };
}

/** Round to whole currency units for display without losing the exclusions. */
export function roundMoney(m: Money): Money {
  return { ...m, value: Math.round(m.value) };
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
