"use client";

/**
 * The X-ray of the headline: what the letter's aid total is actually made of.
 *
 * Mark specs follow the dataviz method: a single bar no thicker than 24px,
 * square at the baseline with a 4px rounded data end, and 2px surface gaps
 * between segments rather than strokes. Values are never printed inside the
 * segments -- on the loans fill neither white nor ink text reaches AA at body
 * size -- so the legend carries them. The legend is a real <table>, which makes
 * it the screen-reader table view as well as the visual key.
 */

import { useState } from "react";

import { Icon } from "@/components/Icon";
import { formatUSD } from "@/lib/engine";
import { CATEGORY, type Breakdown, type CategoryKey } from "@/lib/view";

export function AidBreakdown({
  breakdown,
  onSelectCategory,
}: {
  breakdown: Breakdown;
  onSelectCategory?: (key: CategoryKey) => void;
}) {
  const [hover, setHover] = useState<CategoryKey | null>(null);
  const { segments, total, headline } = breakdown;
  if (!segments.length || total <= 0) return null;

  const reconciles = headline !== null && Math.abs(headline - total) < 0.5;
  const caption =
    headline !== null
      ? `What the letter's ${formatUSD(headline)} in "financial aid" is made of`
      : `What the ${formatUSD(total)} in aid is made of`;

  return (
    <figure className="m-0">
      <div
        className="flex h-6 w-full gap-[2px] bg-card"
        role="img"
        aria-label={`${caption}: ${segments
          .map((s) => `${CATEGORY[s.key].label} ${formatUSD(s.amount)}`)
          .join(", ")}.`}
      >
        {segments.map((segment, index) => {
          const last = index === segments.length - 1;
          const dimmed = hover !== null && hover !== segment.key;
          return (
            <div
              key={segment.key}
              className={`h-full transition-opacity duration-150 ${last ? "rounded-r-[4px]" : ""}`}
              style={{
                flexGrow: segment.amount,
                flexBasis: 0,
                background: CATEGORY[segment.key].color,
                opacity: dimmed ? 0.28 : 1,
              }}
              onMouseEnter={() => setHover(segment.key)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </div>

      <table className="mt-4 w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Kind of money</th>
            <th scope="col">What it means</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => {
            const meta = CATEGORY[segment.key];
            const active = hover === segment.key;
            return (
              <tr
                key={segment.key}
                className={`border-t border-rule transition-colors first:border-t-0 ${
                  active ? "bg-well" : ""
                }`}
                onMouseEnter={() => setHover(segment.key)}
                onMouseLeave={() => setHover(null)}
              >
                <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                  <button
                    type="button"
                    disabled={!onSelectCategory}
                    onClick={() => onSelectCategory?.(segment.key)}
                    onFocus={() => setHover(segment.key)}
                    onBlur={() => setHover(null)}
                    className="group inline-flex items-center gap-2.5 rounded text-left font-medium text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink enabled:cursor-pointer"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-[3px]"
                      style={{ background: meta.color }}
                    />
                    <Icon name={meta.icon} size={18} className="shrink-0 text-ink-2" />
                    <span>
                      <span className="block group-enabled:group-hover:underline">{meta.label}</span>
                      {/* On narrow screens the meaning moves under the label
                          rather than squeezing a third column. */}
                      <span className="block font-normal text-ink-2 sm:hidden">{meta.meaning}</span>
                    </span>
                  </button>
                </th>
                <td className="hidden py-2.5 pr-3 text-ink-2 sm:table-cell">{meta.meaning}</td>
                <td className="figures py-2.5 text-right font-medium text-ink">
                  {formatUSD(segment.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
        {headline !== null ? (
          <tfoot>
            <tr className="border-t-2 border-rule-2">
              <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink sm:hidden">
                The letter&rsquo;s total
              </th>
              <th
                scope="row"
                className="hidden py-2.5 pr-3 text-left font-medium text-ink sm:table-cell"
                colSpan={2}
              >
                The letter&rsquo;s total
                {!reconciles ? (
                  <span className="ml-2 font-normal text-ink-2">
                    (the parts above add to {formatUSD(total)})
                  </span>
                ) : null}
              </th>
              <td className="figures py-2.5 text-right font-medium text-ink">
                {formatUSD(headline)}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}
