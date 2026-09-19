/**
 * The FinePrint financial engine.
 *
 * Pure functions over (source facts, user overrides, scenario assumptions).
 * No I/O, no React, no network. That is what makes the what-if simulator
 * instant, the results unit-testable, and the product usable when the
 * extraction service is unavailable.
 *
 * AI interprets the document. This file does the arithmetic.
 */

import type { CanonicalDocument } from "../schema";
import { computeProjection } from "./projection";
import { computeYearOne } from "./yearOne";
import type { Assumptions, DerivedModel, Overrides } from "./types";

export * from "./types";
export * from "./money";
export * from "./periods";
export {
  computeYearOne,
  headlineRollup,
  resolveItem,
  rollupAid,
  summableAid,
  summableCosts,
} from "./yearOne";
export { computeProjection } from "./projection";

/**
 * Derive every figure the UI shows from the three state layers.
 *
 * Deterministic: identical inputs always produce identical output, which is
 * what lets the UI recompute on every slider tick without a round trip.
 */
export function derive(
  doc: CanonicalDocument,
  overrides: Overrides,
  assumptions: Assumptions,
): DerivedModel {
  const yearOne = computeYearOne(doc, overrides, assumptions);
  const fourYear = computeProjection(doc, overrides, assumptions, yearOne);

  const openAmbiguities = doc.ambiguities
    .filter((a) => !overrides.ambiguityAnswers[a.id])
    .map((a) => a.id);

  return {
    yearOne,
    fourYear,
    openAmbiguities,
    missingCosts: doc.missing_costs.filter(
      (mc) => typeof overrides.missingCostEstimates[mc.id] !== "number",
    ),
    yearOneComplete:
      yearOne.costOfAttendance.complete && yearOne.giftAid.complete,
  };
}

/**
 * Difference between two derived models, for before/after what-if readouts.
 *
 * Returns raw deltas; the UI decides which ones to surface and how to phrase
 * the direction of change.
 */
export interface ScenarioDelta {
  yearOneAmountToCover: number;
  yearOneOutOfPocket: number;
  fourYearAmountToCover: number;
  fourYearOutOfPocket: number;
  principalBorrowed: number;
}

export function diff(before: DerivedModel, after: DerivedModel): ScenarioDelta {
  return {
    yearOneAmountToCover:
      after.yearOne.amountToCover.value - before.yearOne.amountToCover.value,
    yearOneOutOfPocket:
      after.yearOne.outOfPocket.value - before.yearOne.outOfPocket.value,
    fourYearAmountToCover:
      after.fourYear.amountToCover.value - before.fourYear.amountToCover.value,
    fourYearOutOfPocket:
      after.fourYear.outOfPocket.value - before.fourYear.outOfPocket.value,
    principalBorrowed:
      after.fourYear.principalBorrowed.value -
      before.fourYear.principalBorrowed.value,
  };
}
