"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { BrandMark } from "@/components/BrandMark";
import { Icon } from "@/components/Icon";
import { FourYear } from "@/components/FourYear";
import { Overview, type AmbiguityView } from "@/components/Overview";
import { SourceBadge } from "@/components/SourceBadge";
import { XRay, type PanelGroup } from "@/components/XRay";
import { defaultAssumptions, derive, formatUSD, type Assumptions } from "@/lib/engine";
import { scrollBehavior } from "@/lib/motion";
import { DEFAULT_SAMPLE, sampleHref, useSamples } from "@/lib/samples";
import type { CanonicalDocument } from "@/lib/schema";
import { aidBreakdown, scenarioLevers, xrayGroups, type CategoryKey } from "@/lib/view";
import { useSession } from "@/store/session";

/** `sample`: null when the URL names no sample, "" for the first, else a slug. */
export function AnalyzeView({ sample }: { sample: string | null }) {
  const { status, error, failed, sampleSlug, doc, pdf, overrides, assumptions, selectedItemId } =
    useSession();
  const { loadSample, answer, clearAnswer, select, reset, setAssumptions } = useSession.getState();

  // Load the requested sample unless it is already loaded (or already failed:
  // the error page offers the retry, so no loop).
  useEffect(() => {
    if (sample === null) return;
    if (useSession.getState().sampleSlug !== (sample || DEFAULT_SAMPLE.slug)) {
      void loadSample(sample || undefined);
    }
  }, [sample, loadSample]);

  if (status === "loading") return <Reading />;
  if (status === "error") {
    return (
      <Failure
        message={error}
        sample={failed === "sample"}
        onSample={() => void loadSample(failed === "sample" ? (sampleSlug ?? undefined) : undefined)}
      />
    );
  }
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
      onAssumptions={setAssumptions}
      onEstimate={useSession.getState().setMissingCostEstimate}
      onCostTotal={useSession.getState().setCostOfAttendanceTotal}
      sampleSlug={sampleSlug}
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
  onAssumptions,
  onEstimate,
  onCostTotal,
  sampleSlug,
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
  onAssumptions: (patch: Partial<Assumptions>) => void;
  onEstimate: (missingCostId: string, amount: number | null) => void;
  onCostTotal: (amount: number | null) => void;
  /** The loaded demo sample, or null for an upload. */
  sampleSlug: string | null;
}) {
  const samples = useSamples();
  const otherSamples = sampleSlug ? samples.filter((s) => s.slug !== sampleSlug) : [];

  // The engine is pure, so recomputing on every answer is cheap and exact.
  const model = useMemo(() => derive(doc, overrides, assumptions), [doc, overrides, assumptions]);
  const breakdown = useMemo(
    () => aidBreakdown(doc, overrides, assumptions),
    [doc, overrides, assumptions],
  );

  // Cost "unknown" is never shown as $0 -- until the letter's own total or a
  // total the student enters fills it in (the engine's CostBasis).
  const listsCosts = model.yearOne.costBasis !== "unknown";

  // For each open question, what each answer would do -- computed by running
  // the engine once per hypothetical answer.
  const ambiguities: AmbiguityView[] = useMemo(
    () =>
      doc.ambiguities.map((ambiguity) => ({
        ambiguity,
        answer: overrides.ambiguityAnswers[ambiguity.id],
        itemId: ambiguity.target.split(".")[0] || null,
        // Without costs there is nothing to cover, so no per-answer figure.
        impacts: !listsCosts ? [] : ambiguity.options.map((option) => ({
          value: option.value,
          // Floored like every other "to cover" figure: nobody owes a negative amount.
          amountToCover: Math.max(0, derive(
            doc,
            {
              ...overrides,
              ambiguityAnswers: { ...overrides.ambiguityAnswers, [ambiguity.id]: option.value },
            },
            assumptions,
          ).yearOne.amountToCover.value),
        })),
      })),
    [doc, overrides, assumptions, listsCosts],
  );

  // "The letter as written": the same document and the same answers, with
  // every scenario lever at its default. What-if deltas are measured from here.
  const baseline = useMemo(() => derive(doc, overrides, defaultAssumptions()), [doc, overrides]);
  const levers = useMemo(
    () => scenarioLevers(doc, overrides, assumptions),
    [doc, overrides, assumptions],
  );
  const pending = doc.ambiguities.find(
    (a) => a.blocks_headline && !overrides.ambiguityAnswers[a.id],
  );
  // What each open question holds out -- an award's period, or a cost whose
  // amount the letter leaves open (in-state or out-of-state, say). Every one is
  // named, not just the first.
  const pendingLabels = doc.ambiguities
    .filter((a) => a.blocks_headline && !overrides.ambiguityAnswers[a.id])
    .map((a) => {
      const item = [...doc.aid, ...doc.costs].find(
        (i) => `${i.id}.period` === a.target || `${i.id}.amount` === a.target,
      );
      if (!item) return null;
      // An open amount is the question itself, so don't print the placeholder.
      return a.target.endsWith(".amount") ? item.label : `${formatUSD(item.amount)} ${item.label}`;
    })
    .filter((label): label is string => label !== null);

  const groups: PanelGroup[] = useMemo(() => {
    const base: PanelGroup[] = xrayGroups(doc, overrides);

    if (doc.missing_costs.length) {
      const wholeCostEntry =
        model.yearOne.costBasis === "unknown" || model.yearOne.costBasis === "user_total";
      base.push({
        key: "missing",
        title: "Not in the letter",
        meaning: "Costs it names but never prices",
        icon: "missing",
        color: "var(--color-rule-2)",
        note: wholeCostEntry ? (
          <>
            FinePrint doesn&rsquo;t guess these individual costs.{" "}
            {model.yearOne.costBasis === "user_total"
              ? "It is using the full yearly cost of attendance you entered in "
              : "Enter your school’s full yearly cost of attendance in "}
            <a
              href="#year-one"
              className="rounded font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              2. What you&rsquo;d pay this year
            </a>
            .
          </>
        ) : (
          <>
            FinePrint leaves these out rather than guessing. Add your own yearly estimates in{" "}
            <a
              href="#year-one"
              className="rounded font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              2. What you&rsquo;d pay this year
            </a>
            .
          </>
        ),
        rows: doc.missing_costs.map((mc) => ({
          id: mc.id,
          label: mc.label,
          // The student's estimate, labelled as theirs -- the letter still
          // gives no amount, and the evidence shown is where it names the cost.
          amount: overrides.missingCostEstimates[mc.id] ?? null,
          category: null,
          isTotal: false,
          derived: false,
          periodText:
            overrides.missingCostEstimates[mc.id] === undefined
              ? "not stated"
              : "your estimate · not in the letter",
          conditions: [],
          evidenceIds: mc.evidence_ids,
        })),
      });
    }
    return base;
  }, [doc, overrides, model.yearOne.costBasis]);

  const showItem = (itemId: string) => {
    onSelect(itemId);
    document.getElementById("xray")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
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
            className="rounded outline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
          >
            <BrandMark compact className="translate-y-[3px]" />
          </Link>
          {/* The page's h1: which offer this is. Styled as the quiet label it looks like. */}
          <h1 className="flex min-w-0 items-center gap-2 text-sm font-normal text-ink-2">
            <Icon name="document" size={16} className="shrink-0" />
            <span className="truncate">
              {doc.document.institution_name ?? doc.document.source_file_name}
              {doc.document.academic_year ? ` · ${doc.document.academic_year}` : ""}
            </span>
          </h1>
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
        <div className="space-y-6">
          {otherSamples.length ? (
            <nav aria-label="Other sample letters" className="text-sm text-ink-2">
              A made-up sample letter. Another layout:{" "}
              {otherSamples.map((s, i) => (
                <span key={s.slug}>
                  {i > 0 ? " · " : null}
                  <Link
                    href={sampleHref(s.slug)}
                    prefetch={false}
                    className="rounded font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    {s.title}
                  </Link>{" "}
                  <span className="text-ink-3">({s.layout.toLowerCase()})</span>
                </span>
              ))}
            </nav>
          ) : null}

          <Overview
            model={model}
            breakdown={breakdown}
            ambiguities={ambiguities}
            onAnswer={onAnswer}
            onClear={onClear}
            onShowItem={showItem}
            onSelectCategory={selectCategory}
            listsCosts={listsCosts}
            unverifiedCount={doc.unverified_claims.length}
            loans={levers.loans}
            workStudy={levers.workStudy}
            assumptions={assumptions}
            onAssumptions={onAssumptions}
            missingCosts={doc.missing_costs}
            estimates={overrides.missingCostEstimates}
            onEstimate={onEstimate}
            costTotal={overrides.costOfAttendanceTotal}
            onCostTotal={onCostTotal}
          />
        </div>

        <XRay doc={doc} pdf={pdf} groups={groups} selectedId={selectedId} onSelect={onSelect} />

        <FourYear
          model={model}
          baseline={baseline}
          assumptions={assumptions}
          renewals={levers.renewals}
          loans={levers.loans}
          workStudy={levers.workStudy}
          residential={levers.residential}
          pendingLabel={pendingLabels.length ? pendingLabels.join(" and the ") : null}
          pendingCount={pendingLabels.length}
          onChange={onAssumptions}
          onReset={() => onAssumptions(defaultAssumptions())}
          listsCosts={listsCosts}
          onShowQuestion={() =>
            pending &&
            document
              .getElementById(`question-${pending.id}`)
              ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" })
          }
        />

        {doc.unverified_claims.length ? (
          <section
            aria-labelledby="unverified-heading"
            className="overflow-hidden rounded-lg border border-rule bg-card"
          >
            {/* Nothing here is counted anywhere, so it starts closed -- still
                one click away, and the count is visible without opening it. */}
            <details>
              <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 outline-offset-[-2px] hover:bg-well focus-visible:outline-2 focus-visible:outline-ink">
                <Icon name="unverified" size={20} className="shrink-0 text-ink-2" />
                <span className="min-w-0">
                  <h2 id="unverified-heading" className="font-semibold text-ink">
                    Things we couldn&rsquo;t confirm ({doc.unverified_claims.length})
                  </h2>
                  <span className="block text-sm text-ink-2">
                    Reported by the reader but not found in the letter&rsquo;s text, so counted
                    nowhere.
                  </span>
                </span>
              </summary>
              <ul className="divide-y divide-rule border-t border-rule px-5 text-sm">
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
            </details>
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
          <h1 className="text-lg font-semibold text-ink">Reading your letter…</h1>
        </div>
        {/* A description of the process, not fake per-step progress: the
            server does not report which stage it is on, so ticking steps off
            on a timer would be pretending. */}
        <p className="mt-4 text-ink-2">
          A long or dense letter can take a minute or two. While it works, FinePrint is:
        </p>
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

function Failure({
  message,
  sample,
  onSample,
}: {
  message: string | null;
  /** The bundled sample failed, not an upload -- so "try the sample" is a retry. */
  sample: boolean;
  onSample: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Whoever was waiting on the reading lands here; start them at the problem.
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-lg border border-rule bg-card p-6">
        <div role="alert">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-2 font-semibold text-ink outline-none"
          >
            <Icon name="unverified" size={20} className="shrink-0 text-ink-2" />
            {sample ? "The sample offer didn’t load" : "FinePrint couldn’t read that letter"}
          </h1>
          {message ? <p className="mt-2 text-ink-2">{message}</p> : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onSample}
            className="rounded-md bg-ink px-4 py-2 font-medium text-card hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {sample ? "Try again" : "Try the sample offer"}
          </button>
          <Link
            href="/"
            className="rounded-md border border-rule-2 px-4 py-2 font-medium text-ink hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {sample ? "Back to the start" : "Upload a different file"}
          </Link>
        </div>
      </div>
    </main>
  );
}

function Empty({ onSample }: { onSample: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-ink">No offer loaded</h1>
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
