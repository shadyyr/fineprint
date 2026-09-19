/**
 * Says how the analysis on screen was produced.
 *
 * Persistent, visible and not dismissible: a precomputed or cached result must
 * never pass for a live read of someone's letter. If anyone asks during a demo
 * whether the result is live, the answer is already on screen.
 */

import { Icon, type IconName } from "@/components/Icon";
import type { ExtractionSource } from "@/lib/schema";

const COPY: Record<ExtractionSource, { label: string; detail: string; icon: IconName }> = {
  live: {
    label: "Read live",
    detail: "Extracted from this letter just now, every figure checked against its text",
    icon: "spark",
  },
  cached: {
    label: "Cached analysis",
    detail: "A saved result, not a fresh read of this letter",
    icon: "document",
  },
  fixture: {
    label: "Precomputed sample",
    detail: "A saved analysis of the sample letter, not a live read",
    icon: "document",
  },
};

export function SourceBadge({
  source,
  synthetic,
}: {
  source: ExtractionSource;
  synthetic: boolean;
}) {
  const copy = COPY[source];
  const isLive = source === "live";

  return (
    <p
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-sm ${
        isLive
          ? "border-rule-2 bg-card text-ink"
          : "border-dashed border-ink-3 bg-well text-ink"
      }`}
      title={copy.detail}
    >
      <Icon name={copy.icon} size={16} className="shrink-0 text-ink-2" />
      <span className="font-medium">{copy.label}</span>
      {synthetic ? (
        <span className="hidden items-center gap-2 sm:inline-flex">
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <span className="text-ink-2">made-up letter</span>
        </span>
      ) : null}
      {synthetic ? <span className="sr-only sm:hidden">, made-up letter</span> : null}
      <span className="sr-only">. {copy.detail}.</span>
    </p>
  );
}
