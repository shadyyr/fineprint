/**
 * The three state layers and the derived output (master context section 15).
 *
 *   SOURCE FACTS  +  USER OVERRIDES  +  SCENARIO ASSUMPTIONS
 *                        |
 *                     derive()
 *                        |
 *                  DERIVED METRICS
 *
 * These never blur. Source facts are the parsed CanonicalDocument and are
 * treated as immutable; overrides record what the user told us; assumptions
 * record what a scenario supposes. Every derived figure can say which layers
 * produced it.
 */

import type { AidType, MissingCost, Period } from "../schema";

/** Layer 2: what the user confirmed, answered or corrected. */
export interface Overrides {
  /** ambiguity id -> the option value the user chose. */
  ambiguityAnswers: Record<string, string>;
  /** item id -> fields the user corrected on an extracted item. */
  itemOverrides: Record<
    string,
    { amount?: number; period?: Period; aidType?: AidType }
  >;
  /** missing-cost id -> an amount the user supplied for a cost the letter omitted. */
  missingCostEstimates: Record<string, number>;
  /**
   * A total yearly cost of attendance the user supplied because the letter
   * gives no cost figure at all. Used only then (see CostBasis) -- it replaces
   * the cost sum and is never added to anything.
   */
  costOfAttendanceTotal?: number;
}

/**
 * Where the year-one cost of attendance comes from, in precedence order:
 * the letter's cost lines (plus the user's estimates for costs it names but
 * doesn't price); else the letter's one stated total; else a total the user
 * entered; else unknown -- which is never shown as $0.
 */
export type CostBasis = "letter_items" | "letter_total" | "user_total" | "unknown";

export type HousingChoice = "as_offered" | "commute" | "custom";

/** Layer 3: what a scenario supposes. Never confused with what the letter said. */
export interface Assumptions {
  /** Annual cost growth, as a fraction. 0.04 is 4% a year. */
  costGrowthRate: number;
  /** Program length in years used for projections and for spreading totals. */
  programYears: number;
  /** aid id -> is this renewed in years 2..N. Only meaningful for renewable gift aid. */
  renewals: Record<string, boolean>;
  /** aid id -> has the student accepted this loan. Loans default to declined. */
  loansAccepted: Record<string, boolean>;
  housing: HousingChoice;
  /** Replacement annual housing+meals figure when housing is "custom". */
  customHousingCost?: number;
  /**
   * Whether work-study earnings are assumed to offset costs.
   * Defaults to false: work-study is earned through hours worked and is not
   * credited to the bill (master context section 13).
   */
  countWorkStudyTowardCosts: boolean;
}

export function defaultAssumptions(): Assumptions {
  return {
    costGrowthRate: 0,
    programYears: 4,
    renewals: {},
    loansAccepted: {},
    housing: "as_offered",
    countWorkStudyTowardCosts: false,
  };
}

export function emptyOverrides(): Overrides {
  return { ambiguityAnswers: {}, itemOverrides: {}, missingCostEstimates: {} };
}

/** Why an amount could not be included in a figure. */
export interface Exclusion {
  id: string;
  label: string;
  amount: number | null;
  reason:
    | "period_unknown"
    | "ambiguity_unresolved"
    | "cost_missing"
    | "term_count_unknown";
  detail: string;
  /** The ambiguity the user can resolve to clear this exclusion, if any. */
  ambiguityId?: string;
}

/**
 * A figure plus an honest account of what it leaves out.
 *
 * `complete` is false whenever something material was excluded, which is how
 * the UI knows to show the figure as provisional rather than final. A number
 * never silently absorbs an amount the document did not establish.
 */
export interface Money {
  value: number;
  complete: boolean;
  excluded: Exclusion[];
}

export function money(value: number, excluded: Exclusion[] = []): Money {
  return { value, complete: excluded.length === 0, excluded };
}

export interface YearOne {
  /** Which source the cost of attendance came from. */
  costBasis: CostBasis;
  /** The part of the cost of attendance the user estimated (missing costs). */
  userEstimates: Money;
  /** What the school presented as the total aid package, if it stated one. */
  headlineAidTotal: Money | null;
  costOfAttendance: Money;
  directCosts: Money;
  /** Aid that is not repaid. The honest counterpart to the headline. */
  giftAid: Money;
  loansOffered: Money;
  loansAccepted: Money;
  workStudyOffered: Money;
  /** Cost of attendance minus gift aid. What remains to be covered somehow. */
  amountToCover: Money;
  /** Amount to cover, after accepted loans and any assumed work-study. */
  outOfPocket: Money;
}

export interface ProjectedYear {
  year: number;
  grossCost: Money;
  giftAid: Money;
  amountToCover: Money;
  loansAccepted: Money;
  outOfPocket: Money;
  /** Gift aid lost this year because a renewable award was not renewed. */
  lapsedAid: { id: string; label: string; amount: number }[];
}

export interface FourYear {
  years: ProjectedYear[];
  grossCost: Money;
  giftAid: Money;
  amountToCover: Money;
  /**
   * Total loan principal accepted across the projection.
   *
   * Principal only. Interest is not modeled: the offer does not state rates
   * and inventing them would fabricate precision (master context section 13).
   */
  principalBorrowed: Money;
  outOfPocket: Money;
}

export interface DerivedModel {
  yearOne: YearOne;
  fourYear: FourYear;
  /** Ambiguities still blocking amounts from headline figures. */
  openAmbiguities: string[];
  /** Costs the document named but never quantified. */
  missingCosts: MissingCost[];
  /** True when nothing material is excluded from the Year 1 headline figures. */
  yearOneComplete: boolean;
}
