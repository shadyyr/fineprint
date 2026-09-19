"use client";

/**
 * A question the letter leaves open, answered by the student.
 *
 * FinePrint never guesses a period. Instead each option shows its consequence
 * up front -- the engine is pure, so running it once per hypothetical answer
 * is free -- which turns "is this per year or in total?" from a technicality
 * into the question worth thousands of dollars that it actually is.
 */

import { useId } from "react";

import { Icon } from "@/components/Icon";
import { formatUSD } from "@/lib/engine";
import type { Ambiguity } from "@/lib/schema";

export interface OptionImpact {
  value: string;
  /** Year 1 amount to cover if this option is chosen. */
  amountToCover: number;
}

export function AmbiguityPrompt({
  ambiguity,
  answer,
  impacts,
  onAnswer,
  onClear,
  onShowEvidence,
}: {
  ambiguity: Ambiguity;
  answer: string | undefined;
  impacts: OptionImpact[];
  onAnswer: (value: string) => void;
  onClear: () => void;
  onShowEvidence?: () => void;
}) {
  const headingId = useId();
  const impactOf = (value: string) => impacts.find((i) => i.value === value);

  const spread =
    impacts.length >= 2
      ? Math.max(...impacts.map((i) => i.amountToCover)) -
        Math.min(...impacts.map((i) => i.amountToCover))
      : 0;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-rule bg-card p-5 shadow-[inset_4px_0_0_var(--color-unclear)]"
    >
      <div className="flex items-start gap-3">
        <Icon name="unclear" size={22} className="mt-0.5 shrink-0 text-unclear" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">
            {answer ? "You answered" : "Needs your answer"}
          </p>
          <h3 id={headingId} className="mt-1 text-base font-semibold text-ink">
            {ambiguity.question}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{ambiguity.why}</p>
          {spread > 0 && !answer ? (
            <p className="mt-2 text-sm font-medium text-ink">
              Your answer changes what you&rsquo;d cover in year one by {formatUSD(spread)}.
            </p>
          ) : null}
        </div>
      </div>

      {/* Indented to the heading's text edge (22px icon + 12px gap). */}
      <div className="sm:pl-[34px]">
      <fieldset className="mt-4">
        <legend className="sr-only">{ambiguity.question}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ambiguity.options.map((option) => {
            const chosen = answer === option.value;
            const impact = impactOf(option.value);
            return (
              <label
                key={option.value}
                className={`relative flex cursor-pointer flex-col gap-1 rounded-md border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
                  chosen
                    ? "border-unclear bg-unclear-wash"
                    : "border-rule-2 bg-card hover:border-ink-3"
                }`}
              >
                <input
                  type="radio"
                  name={ambiguity.id}
                  value={option.value}
                  checked={chosen}
                  onChange={() => onAnswer(option.value)}
                  className="sr-only"
                />
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <span
                    aria-hidden="true"
                    className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                      chosen ? "border-unclear" : "border-ink-3"
                    }`}
                  >
                    {chosen ? <span className="size-2 rounded-full bg-unclear" /> : null}
                  </span>
                  {option.label}
                </span>
                {option.detail ? (
                  <span className="pl-6 text-sm text-ink-2">{option.detail}</span>
                ) : null}
                {impact ? (
                  <span className="pl-6 text-sm text-ink-2">
                    Year 1 to cover:{" "}
                    <span className="figures font-medium text-ink">
                      {formatUSD(impact.amountToCover)}
                    </span>
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {onShowEvidence ? (
          <button
            type="button"
            onClick={onShowEvidence}
            className="rounded font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            Show me where the letter says this
          </button>
        ) : null}
        {answer ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded text-ink-2 underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            I&rsquo;m not sure — undo my answer
          </button>
        ) : null}
      </div>
      </div>
    </section>
  );
}
