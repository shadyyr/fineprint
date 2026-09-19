/**
 * Four-year projection.
 *
 * Every figure here is a scenario estimate built from explicit assumptions,
 * never a prediction. FinePrint does not claim to know future tuition, future
 * eligibility, or whether a GPA condition will be met (master context
 * sections 7.5 and 24) -- it shows what follows from the assumptions the user
 * can see and change.
 *
 * Two defaults worth stating plainly, both surfaced in the UI:
 *   - Gift aid is held flat in nominal dollars while costs grow. Award letters
 *     state fixed dollar amounts and rarely index them to tuition.
 *   - Accepted loan amounts are held flat. Federal annual limits do change by
 *     year, but this offer does not state future-year amounts and inventing
 *     them would fabricate precision.
 */

import type { AidItem, CanonicalDocument } from "../schema";
import { subtractMoney, sumMoney } from "./money";
import { resolveItem, summableAid } from "./yearOne";
import type {
  Assumptions,
  Exclusion,
  FourYear,
  Money,
  Overrides,
  ProjectedYear,
  YearOne,
} from "./types";

/** Gift aid continues past year 1 unless the user turns renewal off. */
function isRenewed(item: AidItem, assumptions: Assumptions): boolean {
  return assumptions.renewals[item.id] !== false;
}

function emptyMoney(): Money {
  return { value: 0, complete: true, excluded: [] };
}

function moneyFrom(
  entries: { annual: number | null; exclusion?: Exclusion }[],
): Money {
  const excluded = entries
    .map((e) => e.exclusion)
    .filter((e): e is Exclusion => Boolean(e));
  return {
    value: entries.reduce((acc, e) => acc + (e.annual ?? 0), 0),
    complete: excluded.length === 0,
    excluded,
  };
}

export function computeProjection(
  doc: CanonicalDocument,
  overrides: Overrides,
  assumptions: Assumptions,
  yearOne: YearOne,
): FourYear {
  const aid = summableAid(doc).map((item) => ({
    item,
    resolved: resolveItem(item, doc, overrides, assumptions),
    type: overrides.itemOverrides[item.id]?.aidType ?? item.aid_type,
  }));

  const years: ProjectedYear[] = [];

  for (let year = 1; year <= assumptions.programYears; year++) {
    const growth = Math.pow(1 + assumptions.costGrowthRate, year - 1);

    // Costs grow; the exclusions attached to year 1 costs still apply.
    const grossCost: Money = {
      value: yearOne.costOfAttendance.value * growth,
      complete: yearOne.costOfAttendance.complete,
      excluded: yearOne.costOfAttendance.excluded,
    };

    const giftEntries = aid
      .filter((a) => a.type === "gift")
      .map((a) => {
        const active = year === 1 || isRenewed(a.item, assumptions);
        return {
          annual: active ? a.resolved.annual : 0,
          // An unresolved period still blocks the amount in later years.
          exclusion: active ? a.resolved.exclusion : undefined,
        };
      });
    const giftAid = moneyFrom(giftEntries);

    const lapsedAid = aid
      .filter(
        (a) =>
          a.type === "gift" &&
          year > 1 &&
          !isRenewed(a.item, assumptions) &&
          a.resolved.annual !== null,
      )
      .map((a) => ({
        id: a.item.id,
        label: a.item.label,
        amount: a.resolved.annual as number,
      }));

    const loansAccepted = moneyFrom(
      aid
        .filter((a) => a.type === "loan" && assumptions.loansAccepted[a.item.id] === true)
        .map((a) => ({ annual: a.resolved.annual, exclusion: a.resolved.exclusion })),
    );

    const workStudy = assumptions.countWorkStudyTowardCosts
      ? moneyFrom(
          aid
            .filter((a) => a.type === "work_study")
            .map((a) => ({ annual: a.resolved.annual, exclusion: a.resolved.exclusion })),
        )
      : emptyMoney();

    const amountToCover = subtractMoney(grossCost, giftAid);
    const outOfPocket = subtractMoney(
      amountToCover,
      sumMoney([loansAccepted, workStudy]),
    );

    years.push({
      year,
      grossCost,
      giftAid,
      amountToCover,
      loansAccepted,
      outOfPocket,
      lapsedAid,
    });
  }

  return {
    years,
    grossCost: sumMoney(years.map((y) => y.grossCost)),
    giftAid: sumMoney(years.map((y) => y.giftAid)),
    amountToCover: sumMoney(years.map((y) => y.amountToCover)),
    principalBorrowed: sumMoney(years.map((y) => y.loansAccepted)),
    outOfPocket: sumMoney(years.map((y) => y.outOfPocket)),
  };
}
