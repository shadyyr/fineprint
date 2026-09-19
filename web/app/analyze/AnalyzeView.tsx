"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";

import { Icon } from "@/components/Icon";
import { Overview, type AmbiguityView } from "@/components/Overview";
import { SourceBadge } from "@/components/SourceBadge";
import { XRay, type PanelGroup } from "@/components/XRay";
import { derive, formatUSD } from "@/lib/engine";
import type { CanonicalDocument } from "@/lib/schema";
import { aidBreakdown, xrayGroups, type CategoryKey } from "@/lib/view";
import { useSession } from "@/store/session";

export function AnalyzeView({ autoloadSample }: { autoloadSample: boolean }) {
  const { status, error, doc, pdf, overrides, assumptions, selectedItemId } = useSession();
  const { loadSample, answer, clearAnswer, select, reset } = useSession.getState();

  useEffect(() => {
    if (autoloadSample && !useSession.getState().doc) void loadSample();
  }, [autoloadSample, loadSample]);

  if (status === "loading") return <Reading />;
  if (status === "error") return <Failure message={error} onRetry={() => void loadSample()} />;
  if (!doc || !pdf) return <Empty onSample={() => void loadSample()} />;

  return (
    <Analysis
      doc={doc}
      pdf={pdf}
      overrides={overrides}
      assumptions={assumptions}
      selectedId={selectedItemId}
      onAnswer={answer}
      onClear={clearAnswer}
      onSelect={select}
      onReset={reset}
    />
  );
}

function Analysis({
  doc,
  pdf,
  overrides,
  assumptions,
  selectedId,
  onAnswer,
  onClear,
  onSelect,
  onReset,
}: {
  doc: CanonicalDocument;
  pdf: ArrayBuffer | string;
  overrides: ReturnType<typeof useSession.getState>["overrides"];
  assumptions: ReturnType<typeof useSession.getState>["assumptions"];
  selectedId: string | null;
  onAnswer: (id: string, value: string) => void;
  onClear: (id: string) => void;
  onSelect: (id: string | null) => void;
  onReset: () => void;
}) {
  // The engine is pure, so recomputing on every answer is cheap and exact.
  const model = useMemo(() => derive(doc, overrides, assumptions), [doc, overrides, assumptions]);
  const breakdown = useMemo(
    () => aidBreakdown(doc, overrides, assumptions),
    [doc, overrides, assumptions],
  );

  // For each open question, what each answer would do -- computed by running
  // the engine once per hypothetical answer.
  const ambiguities: AmbiguityView[] = useMemo(
    () =>
      doc.ambiguities.map((ambiguity) => ({
        ambiguity,
        answer: overrides.ambiguityAnswers[ambiguity.id],
        itemId: ambiguity.target.split(".")[0] || null,
        impacts: ambiguity.options.map((option) => ({
          value: option.value,
          amountToCover: derive(
            doc,
            {
              ...overrides,
              ambiguityAnswers: { ...overrides.ambiguityAnswers, [ambiguity.id]: option.value },
            },
            assumptions,
          ).yearOne.amountToCover.value,
        })),
      })),
    [doc, overrides, assumptions],
  );

  const groups: PanelGroup[] = useMemo(() => {
    const base: PanelGroup[] = xrayGroups(doc, overrides);

    if (doc.missing_costs.length) {
      base.push({
        key: "missing",
        title: "Not in the letter",
        meaning: "Costs it names but never prices",
        icon: "missing",
        color: "var(--color-rule-2)",
        note: "FinePrint leaves these out rather than guessing, so the real cost is higher than the letter's total.",
        rows: doc.missing_costs.map((mc) => ({
          id: mc.id,
          label: mc.label,
          amount: null,
          category: null,
          isTotal: false,
          periodText: "not stated",
          conditions: [],
          evidenceIds: mc.evidence_ids,
        })),
      });
    }
    return base;
  }, [doc, overrides]);

  const showItem = (itemId: string) => {
    onSelect(itemId);
    document.getElementById("xray")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectCategory = (key: CategoryKey) => {
    const first = groups.find((g) => g.key === key)?.rows[0];
    if (first) showItem(first.id);
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-rule bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            onClick={onReset}
            className="rounded text-lg font-semibold tracking-tight text-ink outline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
          >
            FinePrint
          </Link>
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
            <Icon name="document" size={16} className="shrink-0" />
            <span className="truncate">
              {doc.document.institution_name ?? doc.document.source_file_name}
              {doc.document.academic_year ? ` · ${doc.document.academic_year}` : ""}
            </span>
          </p>
          <div className="ml-auto flex items-center gap-3">
            <SourceBadge
              source={doc.extraction_meta.source}
              synthetic={doc.document.synthetic}
            />
            <Link
              href="/"
              onClick={onReset}
              className="whitespace-nowrap rounded text-sm font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              Start over
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-16 px-4 py-10 sm:px-6">
        <Overview
          model={model}
          breakdown={breakdown}
          ambiguities={ambiguities}
          onAnswer={onAnswer}
          onClear={onClear}
          onShowItem={showItem}
          onSelectCategory={selectCategory}
        />

        <XRay doc={doc} pdf={pdf} groups={groups} selectedId={selectedId} onSelect={onSelect} />

        {doc.unverified_claims.length ? (
          <section aria-labelledby="unverified-heading" className="rounded-lg border border-rule bg-card p-5">
            <h2 id="unverified-heading" className="flex items-center gap-2 font-semibold text-ink">
              <Icon name="unverified" size={20} className="text-ink-2" />
              Things we couldn&rsquo;t confirm
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              The reader reported these, but FinePrint couldn&rsquo;t find them in the
              letter&rsquo;s text, so none of them are counted anywhere above.
            </p>
            <ul className="mt-3 divide-y divide-rule text-sm">
              {doc.unverified_claims.map((claim) => (
                <li key={claim.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-medium text-ink">{claim.claimed_label}</span>
                  <span className="text-ink-2">
                    {claim.claimed_amount !== null ? `${formatUSD(claim.claimed_amount)} · ` : ""}
                    {claim.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-rule">
        <p className="mx-auto max-w-7xl px-4 py-5 text-sm text-ink-2 sm:px-6">
          FinePrint is an educational tool, not financial advice. Figures come from the
          letter; projections are estimates built on assumptions you can see and change.
        </p>
      </footer>
    </div>
  );
}

function Reading() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <div role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="size-5 animate-spin rounded-full border-2 border-rule-2 border-t-ink"
          />
          <p className="text-lg font-semibold text-ink">Reading your letter…</p>
        </div>
        {/* A description of the process, not fake per-step progress: the
            server does not report which stage it is on, so ticking steps off
            on a timer would be pretending. */}
        <p className="mt-4 text-ink-2">While it works, FinePrint is:</p>
        <ul className="mt-2 space-y-1.5 text-ink-2">
          <li>finding every cost and every award in the text,</li>
          <li>sorting them into grants, loans and work-study,</li>
          <li>checking each number against the exact words on the page,</li>
          <li>and flagging anything the letter leaves unclear.</li>
        </ul>
      </div>
    </main>
  );
}

function Failure({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <div role="alert" className="rounded-lg border border-rule bg-card p-6">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Icon name="unverified" size={20} className="text-ink-2" />
          FinePrint couldn&rsquo;t read that letter
        </p>
        {message ? <p className="mt-2 text-ink-2">{message}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-ink px-4 py-2 font-medium text-card hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Try the sample offer
          </button>
          <Link
            href="/"
            className="rounded-md border border-rule-2 px-4 py-2 font-medium text-ink hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Upload a different file
          </Link>
        </div>
      </div>
    </main>
  );
}

function Empty({ onSample }: { onSample: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16 text-center">
      <p className="text-lg font-semibold text-ink">No offer loaded</p>
      <p className="mt-2 text-ink-2">Upload your letter, or explore a sample to see how it works.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onSample}
          className="rounded-md bg-ink px-4 py-2 font-medium text-card hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Try a sample offer
        </button>
        <Link
          href="/"
          className="rounded-md border border-rule-2 px-4 py-2 font-medium text-ink hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Upload a letter
        </Link>
      </div>
    </main>
  );
}
