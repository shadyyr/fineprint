/**
 * Financial engine tests, run against the committed sample fixture.
 *
 * The invariants here are the ones the product's credibility rests on:
 * an unknown period is never guessed, a missing cost never becomes zero,
 * stated totals are never double counted, and gift aid, loans and work-study
 * never merge into a single "aid" figure.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCanonicalDocument } from "../schema";
import {
  defaultAssumptions,
  derive,
  diff,
  emptyOverrides,
  summableAid,
  summableCosts,
} from "./index";
import { annualize } from "./periods";
import type { Assumptions, Overrides } from "./types";

const doc = parseCanonicalDocument(
  JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/sample_offer.json"), "utf8"),
  ),
);

/** Assumptions with both loans accepted, so borrowing figures are exercised. */
function withLoans(base: Assumptions = defaultAssumptions()): Assumptions {
  return {
    ...base,
    loansAccepted: { aid_sub_loan: true, aid_unsub_loan: true },
  };
}

function resolveMerit(value: "annual" | "four_year_total"): Overrides {
  return {
    ...emptyOverrides(),
    ambiguityAnswers: { amb_merit_period: value },
  };
}

describe("fixture integrity", () => {
  it("parses against the canonical schema", () => {
    expect(doc.schema_version).toBe("1.0");
    expect(doc.document.institution_name).toBe("Meridian State University");
    expect(doc.document.synthetic).toBe(true);
  });

  it("gives every priced item verified evidence", () => {
    const evidenceIds = new Set(doc.evidence.map((e) => e.id));
    for (const item of [...doc.costs, ...doc.aid]) {
      expect(item.evidence_ids.length).toBeGreaterThan(0);
      for (const ref of item.evidence_ids) {
        expect(evidenceIds.has(ref)).toBe(true);
      }
    }
    expect(doc.evidence.every((e) => e.status === "verified")).toBe(true);
  });
});

describe("period normalization", () => {
  it("passes an annual amount through unchanged", () => {
    expect(annualize(10000, "annual", 4)).toEqual({
      ok: true,
      annual: 10000,
      derived: false,
    });
  });

  it("doubles a per-semester amount", () => {
    const r = annualize(5000, "semester", 4);
    expect(r.ok && r.annual).toBe(10000);
    expect(r.ok && r.derived).toBe(true);
  });

  it("spreads a total across the program length", () => {
    const r = annualize(20000, "total", 4);
    expect(r.ok && r.annual).toBe(5000);
    expect(r.ok && r.derived).toBe(true);
  });

  it("refuses a per-term amount when the term count is unknown", () => {
    const r = annualize(5000, "term", 4);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("term_count_unknown");
  });

  // The rule the whole uncertainty story depends on.
  it("never invents a period for an unknown amount", () => {
    const r = annualize(20000, "unknown", 4);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("period_unknown");
  });
});

describe("double counting", () => {
  it("excludes stated rollup totals from the summable items", () => {
    const costIds = summableCosts(doc).map((c) => c.id);
    expect(costIds).not.toContain("cost_direct_subtotal");
    expect(costIds).not.toContain("cost_coa_total");

    const aidIds = summableAid(doc).map((a) => a.id);
    expect(aidIds).not.toContain("aid_package_total");
  });

  it("sums cost items to the same total the letter states", () => {
    const model = derive(doc, emptyOverrides(), defaultAssumptions());
    // Tuition 34,800 + housing 9,200 + meals 6,100 + books 1,200.
    expect(model.yearOne.costOfAttendance.value).toBe(51300);
    const stated = doc.costs.find((c) => c.id === "cost_coa_total");
    expect(stated?.amount).toBe(51300);
  });
});

describe("year one, before the ambiguity is resolved", () => {
  const model = derive(doc, emptyOverrides(), defaultAssumptions());

  it("reports the school's headline figure separately from gift aid", () => {
    expect(model.yearOne.headlineAidTotal?.value).toBe(45400);
    expect(model.yearOne.giftAid.value).toBe(16900);
  });

  // The product's central claim: the headline is not what you keep.
  it("shows confirmed gift aid far below the advertised package", () => {
    const headline = model.yearOne.headlineAidTotal?.value ?? 0;
    expect(headline - model.yearOne.giftAid.value).toBe(28500);
  });

  it("holds the unresolved scholarship out of gift aid and says why", () => {
    expect(model.yearOne.giftAid.complete).toBe(false);
    const ex = model.yearOne.giftAid.excluded.find((e) => e.id === "excl_aid_merit");
    expect(ex?.reason).toBe("period_unknown");
    expect(ex?.amount).toBe(20000);
    expect(ex?.ambiguityId).toBe("amb_merit_period");
  });

  it("keeps gift aid, loans and work-study separate", () => {
    expect(model.yearOne.loansOffered.value).toBe(5500);
    expect(model.yearOne.workStudyOffered.value).toBe(3000);
    expect(model.yearOne.giftAid.value).toBe(16900);
  });

  it("treats no loan as accepted until the user accepts it", () => {
    expect(model.yearOne.loansAccepted.value).toBe(0);
  });
});

describe("missing costs", () => {
  const model = derive(doc, emptyOverrides(), defaultAssumptions());

  // A cost the letter declines to quantify must never read as zero.
  it("marks the cost of attendance incomplete rather than assuming zero", () => {
    expect(model.yearOne.costOfAttendance.complete).toBe(false);
    const reasons = model.yearOne.costOfAttendance.excluded.map((e) => e.reason);
    expect(reasons.filter((r) => r === "cost_missing")).toHaveLength(3);
    expect(model.missingCosts).toHaveLength(3);
  });

  it("folds in a user-supplied estimate and clears that exclusion", () => {
    const overrides: Overrides = {
      ...emptyOverrides(),
      missingCostEstimates: { missing_transportation: 1800 },
    };
    const m = derive(doc, overrides, defaultAssumptions());
    expect(m.yearOne.costOfAttendance.value).toBe(53100);
    expect(m.missingCosts).toHaveLength(2);
  });
});

describe("resolving the scholarship period", () => {
  const annual = derive(doc, resolveMerit("annual"), defaultAssumptions());
  const total = derive(doc, resolveMerit("four_year_total"), defaultAssumptions());

  it("treats $20,000 per year as full gift aid", () => {
    expect(annual.yearOne.giftAid.value).toBe(36900);
    expect(annual.yearOne.giftAid.complete).toBe(true);
    expect(annual.yearOne.amountToCover.value).toBe(14400);
  });

  it("spreads a four-year total to $5,000 a year", () => {
    expect(total.yearOne.giftAid.value).toBe(21900);
    expect(total.yearOne.amountToCover.value).toBe(29400);
  });

  // The demo's headline number.
  it("swings year one by $15,000 depending on the answer", () => {
    const d = diff(annual, total);
    expect(d.yearOneAmountToCover).toBe(15000);
  });

  it("closes the ambiguity once answered", () => {
    expect(derive(doc, emptyOverrides(), defaultAssumptions()).openAmbiguities)
      .toEqual(["amb_merit_period"]);
    expect(annual.openAmbiguities).toEqual([]);
  });
});

describe("work-study", () => {
  const assumptions = withLoans();

  it("does not reduce the bill by default", () => {
    const m = derive(doc, resolveMerit("annual"), assumptions);
    // 14,400 to cover, less 5,500 of accepted loans. Work-study untouched.
    expect(m.yearOne.outOfPocket.value).toBe(8900);
  });

  it("reduces it only when the user assumes the hours are worked", () => {
    const m = derive(doc, resolveMerit("annual"), {
      ...assumptions,
      countWorkStudyTowardCosts: true,
    });
    expect(m.yearOne.outOfPocket.value).toBe(5900);
  });
});

describe("four-year projection", () => {
  it("repeats year one when costs are flat and aid renews", () => {
    const m = derive(doc, resolveMerit("annual"), defaultAssumptions());
    expect(m.fourYear.amountToCover.value).toBe(57600);
    expect(m.fourYear.years).toHaveLength(4);
    expect(m.fourYear.years.every((y) => y.lapsedAid.length === 0)).toBe(true);
  });

  it("compounds cost growth without growing gift aid", () => {
    const m = derive(doc, resolveMerit("annual"), {
      ...defaultAssumptions(),
      costGrowthRate: 0.04,
    });
    expect(m.fourYear.grossCost.value).toBeCloseTo(217843.6, 1);
    expect(m.fourYear.giftAid.value).toBe(147600);
    expect(m.fourYear.amountToCover.value).toBeCloseTo(70243.6, 1);
  });

  it("charges three years of lost aid when a scholarship is not renewed", () => {
    const renewed = derive(doc, resolveMerit("annual"), defaultAssumptions());
    const lapsed = derive(doc, resolveMerit("annual"), {
      ...defaultAssumptions(),
      renewals: { aid_merit: false },
    });

    expect(lapsed.fourYear.amountToCover.value).toBe(117600);
    expect(diff(renewed, lapsed).fourYearAmountToCover).toBe(60000);

    expect(lapsed.fourYear.years[0].lapsedAid).toHaveLength(0);
    expect(lapsed.fourYear.years[1].lapsedAid[0]).toMatchObject({
      id: "aid_merit",
      amount: 20000,
    });
  });

  it("reports principal borrowed and models no interest", () => {
    const m = derive(doc, resolveMerit("annual"), withLoans());
    expect(m.fourYear.principalBorrowed.value).toBe(22000);
    expect(m.fourYear).not.toHaveProperty("interest");
    expect(m.fourYear).not.toHaveProperty("debtAtGraduation");
  });

  it("carries the unresolved scholarship through every projected year", () => {
    const m = derive(doc, emptyOverrides(), defaultAssumptions());
    expect(m.fourYear.giftAid.complete).toBe(false);
    for (const year of m.fourYear.years) {
      expect(year.giftAid.excluded.some((e) => e.id === "excl_aid_merit")).toBe(true);
    }
  });
});

describe("housing scenarios", () => {
  it("drops billed housing and meals when commuting", () => {
    const m = derive(doc, resolveMerit("annual"), {
      ...defaultAssumptions(),
      housing: "commute",
    });
    // 51,300 less housing 9,200 and meals 6,100.
    expect(m.yearOne.costOfAttendance.value).toBe(36000);
  });

  it("does not invent a commuting cost to replace them", () => {
    const m = derive(doc, resolveMerit("annual"), {
      ...defaultAssumptions(),
      housing: "commute",
    });
    // Transportation stays an unquantified missing cost, not a guessed number.
    expect(m.missingCosts.some((c) => c.category === "transportation")).toBe(true);
    expect(m.yearOne.costOfAttendance.complete).toBe(false);
  });

  it("substitutes the user's own housing figure", () => {
    const m = derive(doc, resolveMerit("annual"), {
      ...defaultAssumptions(),
      housing: "custom",
      customHousingCost: 7000,
    });
    expect(m.yearOne.costOfAttendance.value).toBe(43000);
  });
});

describe("determinism", () => {
  it("returns identical output for identical input", () => {
    const a = derive(doc, resolveMerit("annual"), withLoans());
    const b = derive(doc, resolveMerit("annual"), withLoans());
    expect(a).toEqual(b);
  });
});

// Codex's second demo sample: a Fall/Spring worksheet with one aid subtotal
// per term. Neither term's subtotal is the letter's total for the year.
describe("per-term letter (Summit sample)", () => {
  const summit = parseCanonicalDocument(
    JSON.parse(
      readFileSync(join(__dirname, "../../../fixtures/samples/summit-per-term.json"), "utf8"),
    ),
  );
  const model = derive(summit, emptyOverrides(), defaultAssumptions());

  it("never quotes a total the pipeline derived as what the letter says", () => {
    // The two per-term subtotals are merged into one yearly rollup marked
    // "derived" -- FinePrint's sum, not words printed on the letter.
    const rollups = summit.aid.filter((a) => a.role === "rollup");
    expect(rollups.length).toBeGreaterThan(0);
    expect(rollups.every((r) => r.provenance === "derived")).toBe(true);
    expect(model.yearOne.headlineAidTotal).toBeNull();
  });

  // Regression for S1-FIX (CHANGES.log 052/055): per-term rows used to be
  // annualized x2 each, reading 33,000.
  it("sums both terms of gift aid into the year exactly once", () => {
    // Pell 3,200 + 3,300 and STEM 4,900 + 5,100; the unanswered scholarship waits.
    expect(model.yearOne.giftAid.value).toBe(16500);
    expect(model.yearOne.giftAid.complete).toBe(false);
  });
});

// Residency (TASKS R1/UI-R1): a letter that lists both an in-state and an
// out-of-state rate without saying which applies. The pipeline emits one item
// plus an amount_unclear ambiguity; the engine must neither count the
// placeholder nor pick a rate.
describe("amount the letter leaves open (in-state or out-of-state)", () => {
  const tuition = doc.costs.find((c) => c.category === "tuition" && c.role === "item")!;
  const residency = {
    ...doc,
    ambiguities: [
      ...doc.ambiguities,
      {
        id: "amb_residency",
        kind: "amount_unclear" as const,
        target: `${tuition.id}.amount`,
        severity: "material" as const,
        question: "Which tuition rate applies to you?",
        why: "The letter lists both rates.",
        options: [
          { value: String(tuition.amount), label: "In-state" },
          { value: "52000", label: "Out-of-state" },
        ],
        blocks_headline: true,
        evidence_ids: tuition.evidence_ids,
      },
    ],
  };
  // Cost of attendance doesn't depend on the scholarship question, so no answers.
  const answered = emptyOverrides();
  const base = derive(doc, answered, defaultAssumptions()).yearOne.costOfAttendance.value;
  const withAnswer = (value?: string) =>
    derive(
      residency,
      {
        ...answered,
        ambiguityAnswers: {
          ...answered.ambiguityAnswers,
          ...(value === undefined ? {} : { amb_residency: value }),
        },
      },
      defaultAssumptions(),
    ).yearOne;

  it("holds the item out of every total until answered, and says why", () => {
    const y = withAnswer();
    expect(y.costOfAttendance.value).toBe(base - tuition.amount);
    expect(y.costOfAttendance.complete).toBe(false);
    const ex = y.costOfAttendance.excluded.find((e) => e.id === `excl_${tuition.id}`);
    expect(ex?.reason).toBe("ambiguity_unresolved");
    expect(ex?.amount).toBeNull();
    expect(ex?.ambiguityId).toBe("amb_residency");
  });

  it("uses the chosen rate once answered", () => {
    expect(withAnswer("52000").costOfAttendance.value).toBe(base - tuition.amount + 52000);
    expect(withAnswer(String(tuition.amount)).costOfAttendance.value).toBe(base);
  });

  it("ignores an answer that isn't an amount rather than guessing", () => {
    expect(withAnswer("out_of_state").costOfAttendance.value).toBe(base - tuition.amount);
  });
});
