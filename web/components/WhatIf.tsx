"use client";

/**
 * Scenario controls.
 *
 * Every control changes an assumption, never a fact from the letter: the two
 * layers stay separate in the store, so "what the letter said" and "what if"
 * can always be told apart. Recalculation is instant because the engine is pure
 * TypeScript running in the browser -- no request leaves the page.
 */

import { useId } from "react";

import { Icon } from "@/components/Icon";
import { formatUSD, type Assumptions } from "@/lib/engine";
import type { LoanLever, RenewalLever } from "@/lib/view";

const focusRing =
  "outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";

export function WhatIf({
  assumptions,
  renewals,
  loans,
  workStudy,
  residential,
  asWritten,
  onChange,
  onReset,
}: {
  assumptions: Assumptions;
  renewals: RenewalLever[];
  loans: LoanLever[];
  workStudy: number;
  residential: number;
  asWritten: boolean;
  onChange: (patch: Partial<Assumptions>) => void;
  onReset: () => void;
}) {
  const growthId = useId();
  const customId = useId();
  const growthPct = Math.round(assumptions.costGrowthRate * 1000) / 10;

  return (
    <form
      className="space-y-6 rounded-lg border border-rule bg-card p-5 lg:sticky lg:top-4"
      onSubmit={(e) => e.preventDefault()}
      aria-label="What-if assumptions"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-ink">What if&hellip;</h3>
        <button
          type="button"
          onClick={onReset}
          disabled={asWritten}
          className={`rounded text-sm font-medium underline decoration-rule-2 underline-offset-4 ${focusRing} enabled:text-ink enabled:hover:decoration-ink disabled:text-ink-3 disabled:no-underline`}
        >
          Back to the letter
        </button>
      </div>

      {/* Costs */}
      <div>
        <label htmlFor={growthId} className="flex items-baseline justify-between gap-3 text-sm font-medium text-ink">
          Costs rise each year by
          <output htmlFor={growthId} className="figures font-semibold">
            {growthPct.toFixed(growthPct % 1 ? 1 : 0)}%
          </output>
        </label>
        <input
          id={growthId}
          type="range"
          min={0}
          max={8}
          step={0.5}
          value={growthPct}
          onChange={(e) => onChange({ costGrowthRate: Number(e.target.value) / 100 })}
          className={`mt-2 w-full accent-ink ${focusRing}`}
          aria-describedby={`${growthId}-hint`}
        />
        <p id={`${growthId}-hint`} className="mt-1 text-xs text-ink-2">
          The letter only lists this year&rsquo;s costs. Schools usually raise them, and
          scholarships usually don&rsquo;t grow to match.
        </p>
      </div>

      {/* Renewal of conditional awards */}
      {renewals.length ? (
        <fieldset>
          <legend className="flex items-center gap-2 text-sm font-medium text-ink">
            <Icon name="gift" size={16} className="text-gift" />
            Scholarships with conditions
          </legend>
          <div className="mt-2 space-y-3">
            {renewals.map((r) => {
              const checked = assumptions.renewals[r.id] !== false;
              return (
                <div key={r.id}>
                  <label
                    className={`flex items-start gap-2.5 rounded text-sm ${focusRing} ${
                      r.available ? "cursor-pointer text-ink" : "cursor-not-allowed text-ink-3"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-ink"
                      checked={checked}
                      disabled={!r.available}
                      onChange={(e) =>
                        onChange({ renewals: { ...assumptions.renewals, [r.id]: e.target.checked } })
                      }
                    />
                    <span>
                      Keep the <span className="font-medium">{r.label}</span> all four years
                    </span>
                  </label>
                  {!r.available ? (
                    <p className="ml-[1.625rem] mt-1 text-xs text-ink-2">
                      Answer the question about this award first &mdash; until then it
                      isn&rsquo;t counted.
                    </p>
                  ) : r.conditions.length ? (
                    // The letter's own words, not a paraphrase: rewording terms
                    // into "you must" sentences can change what they say.
                    <div className="ml-[1.625rem] mt-1 text-xs text-ink-2">
                      <p>What the letter says:</p>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                        {r.conditions.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="ml-[1.625rem] mt-1 text-xs text-ink-2">
                      The letter marks this as renewable.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {/* Housing */}
      {residential > 0 ? (
        <fieldset>
          <legend className="text-sm font-medium text-ink">Where you live</legend>
          <div className="mt-2 space-y-2 text-sm text-ink">
            {(
              [
                ["as_offered", `On campus, as the letter lists (${formatUSD(residential)} a year)`],
                ["commute", "At home — drop housing and meals"],
                ["custom", "My own housing and food cost"],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded ${focusRing}`}>
                <input
                  type="radio"
                  name="housing"
                  className="mt-0.5 size-4 shrink-0 accent-ink"
                  checked={assumptions.housing === value}
                  onChange={() =>
                    onChange(
                      value === "custom"
                        ? { housing: value, customHousingCost: assumptions.customHousingCost ?? residential }
                        : { housing: value },
                    )
                  }
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
          {assumptions.housing === "custom" ? (
            <div className="ml-[1.625rem] mt-2">
              <label htmlFor={customId} className="text-xs font-medium text-ink-2">
                Per year, in dollars
              </label>
              <input
                id={customId}
                type="number"
                inputMode="numeric"
                min={0}
                step={100}
                value={assumptions.customHousingCost ?? residential}
                onChange={(e) => onChange({ customHousingCost: Math.max(0, Number(e.target.value) || 0) })}
                className={`figures mt-1 block w-36 rounded-md border border-rule-2 bg-card px-2.5 py-1.5 text-sm text-ink ${focusRing}`}
              />
            </div>
          ) : null}
          {assumptions.housing === "commute" ? (
            <p className="ml-[1.625rem] mt-1 text-xs text-ink-2">
              Commuting has costs too. The letter doesn&rsquo;t price transportation, so it
              isn&rsquo;t added here.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {/* Loans */}
      {loans.length ? (
        <fieldset>
          <legend className="flex items-center gap-2 text-sm font-medium text-ink">
            <Icon name="loan" size={16} className="text-loan" />
            Loans you accept
          </legend>
          <div className="mt-2 space-y-2">
            {loans.map((l) => (
              <label key={l.id} className={`flex cursor-pointer items-start gap-2.5 rounded text-sm text-ink ${focusRing}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-ink"
                  checked={assumptions.loansAccepted[l.id] === true}
                  onChange={(e) =>
                    onChange({ loansAccepted: { ...assumptions.loansAccepted, [l.id]: e.target.checked } })
                  }
                />
                <span>
                  {l.label} <span className="figures text-ink-2">({formatUSD(l.amount)} a year)</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-2">
            Offered, not required. You can accept some, all, or none.
          </p>
        </fieldset>
      ) : null}

      {/* Work-study */}
      {workStudy > 0 ? (
        <fieldset>
          <legend className="flex items-center gap-2 text-sm font-medium text-ink">
            <Icon name="work" size={16} className="text-work" />
            Work-study
          </legend>
          <label className={`mt-2 flex cursor-pointer items-start gap-2.5 rounded text-sm text-ink ${focusRing}`}>
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-ink"
              checked={assumptions.countWorkStudyTowardCosts}
              onChange={(e) => onChange({ countWorkStudyTowardCosts: e.target.checked })}
            />
            <span>
              Count my earnings toward costs{" "}
              <span className="figures text-ink-2">(up to {formatUSD(workStudy)} a year)</span>
            </span>
          </label>
          <p className="ml-[1.625rem] mt-1 text-xs text-ink-2">
            Only if you find a job and work the hours. It&rsquo;s paid as wages, not taken off
            your bill.
          </p>
        </fieldset>
      ) : null}
    </form>
  );
}
