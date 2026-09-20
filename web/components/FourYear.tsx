"use client";

/**
 * Four years, and what if.
 *
 * Every figure here is a scenario built from the letter plus assumptions the
 * student can see and change -- never a prediction. FinePrint does not know
 * next year's tuition or whether a GPA condition will be met; it shows what
 * follows if those things happen.
 *
 * The chart is one horizontal bar per year on a common scale, so cost growth
 * shows as bars lengthening and a lost scholarship shows as green giving way to
 * the dark "you cover" segment. Mark specs follow the dataviz method used for
 * the Overview bar. The "you cover" segment is deliberately a neutral: it is not
 * a kind of aid, it is what is left. The validator flags its low chroma for
 * exactly that reason and passes it on everything that matters -- colorblind
 * separation from every hue (worst dE 10.6, target 8) and contrast.
 */

import { useId, useState } from "react";

import { Icon } from "@/components/Icon";
import { WhatIf } from "@/components/WhatIf";
import { formatUSD, type Assumptions, type DerivedModel, type Money } from "@/lib/engine";
import { CATEGORY, isLetterAsWritten, type LoanLever, type RenewalLever } from "@/lib/view";

const YOU_COVER = "#4a5163";

interface YearSegments {
  year: number;
  gross: number;
  gift: number;
  loans: number;
  work: number;
  you: number;
  lapsed: { label: string; amount: number }[];
}

function segmentsFor(model: DerivedModel): YearSegments[] {
  return model.fourYear.years.map((y) => {
    const gross = y.grossCost.value;
    // Counted work-study is whatever the engine's out-of-pocket subtraction
    // took away beyond accepted loans: outOfPocket = toCover - loans - work.
    const workCounted = y.amountToCover.value - y.loansAccepted.value - y.outOfPocket.value;
    // Fill the year's cost in order -- gift aid, loans, work-study, then the
    // family -- and stop at the cost. Aid beyond the cost is not "paying" for
    // anything, so it is reported as a surplus rather than drawn.
    let left = Math.max(0, gross);
    const take = (amount: number) => {
      const used = Math.min(Math.max(0, amount), left);
      left -= used;
      return used;
    };
    const gift = take(y.giftAid.value);
    const loans = take(y.loansAccepted.value);
    const work = take(workCounted);
    const you = left;
    return {
      year: y.year,
      gross,
      gift,
      loans,
      work,
      you,
      lapsed: y.lapsedAid.map((l) => ({ label: l.label, amount: l.amount })),
    };
  });
}

function signed(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return formatUSD(0);
  return `${rounded > 0 ? "+" : "−"}${formatUSD(Math.abs(rounded))}`;
}

export function FourYear({
  model,
  baseline,
  assumptions,
  renewals,
  loans,
  workStudy,
  residential,
  pendingLabel,
  pendingCount,
  onChange,
  onReset,
  onShowQuestion,
  listsCosts,
}: {
  model: DerivedModel;
  /** The same letter and answers, with every scenario lever at its default. */
  baseline: DerivedModel;
  assumptions: Assumptions;
  renewals: RenewalLever[];
  loans: LoanLever[];
  workStudy: number;
  residential: number;
  /** Set while an open question keeps an award out of these totals. */
  pendingLabel: string | null;
  /** How many open questions pendingLabel names. */
  pendingCount: number;
  onChange: (patch: Partial<Assumptions>) => void;
  onReset: () => void;
  onShowQuestion: () => void;
  /** False when the letter prices no costs -- there is nothing to project. */
  listsCosts: boolean;
}) {
  const fy = model.fourYear;
  const years = segmentsFor(model);
  const max = Math.max(...years.map((y) => y.gross), 1);
  const asWritten = isLetterAsWritten(assumptions);

  // Nobody owes a negative amount. When gift aid exceeds the costs -- say,
  // living at home -- the figure is zero and the surplus is reported separately.
  const floor0 = (m: Money): Money => ({ ...m, value: Math.max(0, m.value) });
  const leftToCover = floor0(fy.amountToCover);
  const surplus = Math.max(0, -fy.amountToCover.value);
  const deltas = {
    cover: leftToCover.value - Math.max(0, baseline.fourYear.amountToCover.value),
    borrowed: fy.principalBorrowed.value - baseline.fourYear.principalBorrowed.value,
    you: Math.max(0, fy.outOfPocket.value) - Math.max(0, baseline.fourYear.outOfPocket.value),
  };
  // Costs the letter names but never prices. The asterisk on a figure points here.
  const unpriced = fy.grossCost.excluded
    .filter((e) => e.reason === "cost_missing")
    .map((e) => e.label.toLowerCase());

  return (
    <section aria-labelledby="four-year-heading" id="four-years" className="scroll-mt-6">
      <div className="mb-5 max-w-2xl">
        <h2 id="four-year-heading" className="text-2xl font-semibold tracking-tight text-ink">
          4. Four years, and what if
        </h2>
        <p className="mt-1 text-ink-2">
          What this offer adds up to over a four-year degree. Built from the letter, plus
          assumptions you can see and change &mdash; an estimate, not a prediction.
        </p>
      </div>

      {!listsCosts ? (
        <p className="flex max-w-2xl gap-3 rounded-lg border border-rule bg-card px-4 py-3 text-sm text-ink-2">
          <Icon name="missing" size={20} className="mt-0.5 shrink-0 text-ink-3" />
          <span>
            <span className="font-semibold text-ink">Nothing to project yet.</span> A four-year
            picture starts from what college costs, and this letter doesn&rsquo;t say. FinePrint
            won&rsquo;t guess &mdash; enter your school&rsquo;s yearly cost in{" "}
            <a
              href="#year-one"
              className="rounded font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              2. What you&rsquo;d pay this year
            </a>{" "}
            to see it.
          </span>
        </p>
      ) : (
        <>
          {pendingLabel ? (
            <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-rule bg-card px-4 py-3 shadow-[inset_4px_0_0_var(--color-unclear)]">
              <Icon name="unclear" size={20} className="shrink-0 text-unclear" />
              <p className="min-w-0 flex-1 text-sm text-ink">
                These totals leave out the <strong className="font-semibold">{pendingLabel}</strong>{" "}
                until you answer {pendingCount > 1 ? "the questions" : "the question"} above.
              </p>
              <button
                type="button"
                onClick={onShowQuestion}
                className="rounded text-sm font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                Answer it
              </button>
            </div>
          ) : null}

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
            <WhatIf
              assumptions={assumptions}
              renewals={renewals}
              loans={loans}
              workStudy={workStudy}
              residential={residential}
              asWritten={asWritten}
              onChange={onChange}
              onReset={onReset}
            />

            {/* Phones stack the controls above the results, so a change's effect
                would be a scroll away. Sticky to the bottom of the screen, this
                stays in view while the controls do, then settles in place above
                the results. Wider screens show both side by side and skip it. */}
            <div className="sticky bottom-3 z-20 lg:hidden print:hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-lg border border-ink bg-card px-4 py-2.5 shadow-[0_4px_16px_-4px_rgb(27_31_42/0.35)]">
                <span className="text-sm font-medium text-ink-2">Left to cover, 4 years</span>
                <span className="figures text-right text-ink">
                  <span className="text-lg font-semibold">
                    {formatUSD(leftToCover.value)}
                    {!leftToCover.complete ? <span className="text-sm font-normal text-ink-3">*</span> : null}
                  </span>
                  {asWritten ? null : (
                    <span className="ml-2 text-sm text-ink-2">
                      {Math.round(deltas.cover) === 0
                        ? "no change"
                        : `${signed(deltas.cover)} ${deltas.cover > 0 ? "more" : "less"}`}
                    </span>
                  )}
                </span>
                {pendingLabel ? (
                  <span className="w-full text-xs text-ink-2">
                    Leaves out the {pendingLabel} until you answer
                  </span>
                ) : null}
              </div>
            </div>

            <div className="min-w-0 space-y-6">
              {/* The equation, stated in full. */}
              <dl className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-3">
                <Figure
                  label="Four-year cost"
                  money={fy.grossCost}
                  note={
                    model.yearOne.costBasis === "user_total"
                      ? "From the yearly cost you entered"
                      : model.yearOne.userEstimates.value > 0
                        ? "The letter's costs plus your estimates"
                        : "What the letter's costs add up to"
                  }
                />
                <Figure
                  label="Minus gift aid"
                  money={fy.giftAid}
                  note="Money you don't repay"
                  sign="minus"
                  swatch={CATEGORY.gift.color}
                />
                <Figure
                  label="Left to cover"
                  money={leftToCover}
                  note="From loans, savings, earnings or family"
                  emphasis
                />
              </dl>

              {unpriced.length ? (
                <p className="-mt-3 text-xs text-ink-2">
                  * Leaves out {unpriced.join(", ")} &mdash; the letter names these costs but gives
                  no amount, so the real figures are higher.
                </p>
              ) : null}

              {surplus > 0 ? (
                <p className="flex gap-3 rounded-lg border border-rule bg-card px-4 py-3 text-sm text-ink-2">
                  <Icon name="gift" size={20} className="mt-0.5 shrink-0 text-gift" />
                  <span>
                    <span className="font-semibold text-ink">
                      Gift aid is {formatUSD(surplus)} more than these costs.
                    </span>{" "}
                    Don&rsquo;t count on the difference: schools usually reduce aid when your costs
                    go down. Ask the aid office before planning around it.
                  </span>
                </p>
              ) : null}

              {fy.principalBorrowed.value > 0 ? (
                <p className="flex gap-3 rounded-lg border border-rule bg-card px-4 py-3 text-sm text-ink-2">
                  <Icon name="loan" size={20} className="mt-0.5 shrink-0 text-loan" />
                  <span>
                    <span className="font-semibold text-ink">
                      You&rsquo;d borrow {formatUSD(fy.principalBorrowed.value)}
                    </span>{" "}
                    of that, and repay it with interest after you leave school. Loans don&rsquo;t
                    lower the cost &mdash; they move part of it into your future. Interest
                    isn&rsquo;t included here because the letter doesn&rsquo;t state rates.
                  </span>
                </p>
              ) : null}

              {/* Before and after, announced as it changes. */}
              <div aria-live="polite" aria-atomic="true">
                {asWritten ? (
                  <p className="text-sm text-ink-2">
                    Showing the letter as written. Change an assumption to see what moves.
                  </p>
                ) : (
                  <div className="rounded-lg border border-ink bg-card px-4 py-3">
                    <p className="text-sm font-semibold text-ink">
                      Compared with the letter as written
                    </p>
                    <ul className="mt-1.5 space-y-1 text-sm text-ink">
                      <DeltaLine label="Left to cover over four years" value={deltas.cover} />
                      {Math.round(deltas.borrowed) !== 0 ? (
                        <DeltaLine label="Borrowed" value={deltas.borrowed} />
                      ) : null}
                      {Math.round(deltas.you - deltas.cover) !== 0 ? (
                        <DeltaLine label="From savings, earnings or family" value={deltas.you} />
                      ) : null}
                    </ul>
                  </div>
                )}
              </div>

              <YearChart years={years} max={max} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Figure({
  label,
  money,
  note,
  sign,
  emphasis = false,
  swatch,
}: {
  label: string;
  money: Money;
  note: string;
  sign?: "minus";
  emphasis?: boolean;
  swatch?: string;
}) {
  return (
    <div className={`px-4 py-3 ${emphasis ? "bg-well" : "bg-card"}`}>
      <dt className="flex items-center gap-2 text-sm font-medium text-ink-2">
        {swatch ? (
          <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: swatch }} />
        ) : null}
        {label}
      </dt>
      <dd className={`mt-1 font-semibold tracking-tight text-ink ${emphasis ? "text-3xl" : "text-2xl"}`}>
        {sign === "minus" && money.value > 0 ? "−" : ""}
        {formatUSD(money.value)}
        {!money.complete ? (
          <span className="ml-1 align-top text-sm font-normal text-ink-3" title="Leaves something out — see the missing-cost note">
            *
          </span>
        ) : null}
      </dd>
      <dd className="mt-0.5 text-xs text-ink-2">{note}</dd>
    </div>
  );
}

function DeltaLine({ label, value }: { label: string; value: number }) {
  const direction = value > 0 ? "more" : value < 0 ? "less" : "no change";
  return (
    <li className="flex flex-wrap justify-between gap-x-4">
      <span className="text-ink-2">{label}</span>
      {Math.round(value) === 0 ? (
        <span className="font-semibold">No change</span>
      ) : (
        <span className="figures font-semibold">
          {signed(value)} <span className="font-normal text-ink-2">{direction}</span>
        </span>
      )}
    </li>
  );
}

const SEGMENTS = [
  { key: "gift", label: CATEGORY.gift.label, color: CATEGORY.gift.color, icon: CATEGORY.gift.icon },
  { key: "loans", label: "Loans", color: CATEGORY.loan.color, icon: CATEGORY.loan.icon },
  { key: "work", label: "Work-study", color: CATEGORY.work.color, icon: CATEGORY.work.icon },
  { key: "you", label: "You cover", color: YOU_COVER, icon: "cost" },
] as const;

function YearChart({ years, max }: { years: YearSegments[]; max: number }) {
  const captionId = useId();
  const [hover, setHover] = useState<{ year: number; key: string } | null>(null);
  const present = SEGMENTS.filter((s) => years.some((y) => y[s.key] > 0));

  return (
    <figure className="m-0" aria-labelledby={captionId}>
      <figcaption id={captionId} className="mb-3 text-sm font-semibold text-ink">
        How each year gets paid
      </figcaption>

      <div className="space-y-3" role="img" aria-label={years
        .map((y) => `Year ${y.year}: cost ${formatUSD(y.gross)}; ${present
          .map((s) => `${s.label} ${formatUSD(y[s.key])}`)
          .join(", ")}.`)
        .join(" ")}>
        {years.map((y) => {
          const parts = present.filter((s) => y[s.key] > 0);
          return (
            <div key={y.year}>
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-sm font-medium text-ink-2">Year {y.year}</span>
                <div className="relative h-6 min-w-0 flex-1">
                  <div
                    className="flex h-full gap-[2px] bg-card"
                    style={{ width: `${(100 * y.gross) / max}%` }}
                  >
                    {parts.map((s, i) => {
                      const active = hover?.year === y.year && hover.key === s.key;
                      const dimmed = hover !== null && !active;
                      return (
                        <div
                          key={s.key}
                          className={`relative h-full transition-opacity duration-150 ${
                            i === parts.length - 1 ? "rounded-r-[4px]" : ""
                          }`}
                          style={{
                            flexGrow: y[s.key],
                            flexBasis: 0,
                            background: s.color,
                            opacity: dimmed ? 0.3 : 1,
                          }}
                          onMouseEnter={() => setHover({ year: y.year, key: s.key })}
                          onMouseLeave={() => setHover(null)}
                        >
                          {active ? (
                            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-card shadow">
                              {s.label}: {formatUSD(y[s.key])}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <span className="figures w-20 shrink-0 text-right text-sm font-medium text-ink">
                  {formatUSD(y.gross)}
                </span>
              </div>
              {y.lapsed.length ? (
                <p className="ml-[4.25rem] mt-1 text-xs text-ink-2">
                  {y.lapsed.map((l) => `${l.label} not renewed: −${formatUSD(l.amount)}`).join(" · ")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Legend and table view in one: every value, readable without color. */}
      <table className="mt-5 w-full border-collapse text-sm">
        <caption className="sr-only">How each year gets paid, in dollars</caption>
        <thead>
          <tr className="border-b border-rule text-left text-ink-2">
            <th scope="col" className="py-2 pr-3 font-medium">
              <span className="sr-only">Kind of money</span>
            </th>
            {years.map((y) => (
              <th key={y.year} scope="col" className="py-2 pl-2 text-right font-medium">
                Year {y.year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {present.map((s) => (
            <tr key={s.key} className="border-b border-rule">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                  <Icon name={s.icon} size={16} className="shrink-0 text-ink-2" />
                  {s.label}
                </span>
              </th>
              {years.map((y) => (
                <td key={y.year} className="figures py-2 pl-2 text-right text-ink">
                  {formatUSD(y[s.key])}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">
              Cost that year
            </th>
            {years.map((y) => (
              <td key={y.year} className="figures py-2 pl-2 text-right font-semibold text-ink">
                {formatUSD(y.gross)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </figure>
  );
}
