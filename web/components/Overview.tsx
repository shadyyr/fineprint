"use client";

/**
 * The Overview exists to land one contrast: what the letter calls "financial
 * aid" versus the money the student will not have to repay.
 *
 * Exactly one hero figure (gift aid this year). The letter's own total sits
 * beside it at a smaller size so the gap between the two is the first thing a
 * reader sees. Everything else -- the breakdown, the open question, the year-one
 * picture -- supports that contrast; nothing on this screen competes with it.
 */

import { AidBreakdown } from "@/components/AidBreakdown";
import { AmbiguityPrompt, type OptionImpact } from "@/components/AmbiguityPrompt";
import { Icon } from "@/components/Icon";
import { DollarEntry, MissingCosts } from "@/components/MissingInfo";
import {
  formatUSD,
  type Assumptions,
  type DerivedModel,
  type Exclusion,
  type Money,
  type YearOne,
} from "@/lib/engine";
import type { Ambiguity, MissingCost } from "@/lib/schema";
import type { Breakdown, CategoryKey, LoanLever } from "@/lib/view";

export interface AmbiguityView {
  ambiguity: Ambiguity;
  answer: string | undefined;
  impacts: OptionImpact[];
  itemId: string | null;
}

function exclusionText(ex: Exclusion): string {
  switch (ex.reason) {
    case "period_unknown":
    case "ambiguity_unresolved":
      return `the ${ex.amount ? formatUSD(ex.amount) + " " : ""}${ex.label}, until you answer the question above`;
    case "term_count_unknown":
      return `${ex.label}, because the letter doesn't say how many terms there are`;
    case "cost_missing":
      return ex.label.toLowerCase();
  }
}

/**
 * One definition-list group. dt and dd are direct children of the wrapping div,
 * which is itself a direct child of the dl -- the only nesting the HTML spec
 * allows, and the one screen readers rely on to pair a term with its value.
 */
function FigureRow({
  label,
  description,
  amount,
  money,
  emphasis = false,
  icon,
}: {
  label: string;
  description: React.ReactNode;
  amount: string;
  money?: Money;
  emphasis?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-x-6 gap-y-0.5 px-5 py-4 sm:grid-cols-[1fr_auto] ${
        emphasis ? "bg-well" : ""
      }`}
    >
      <dt className={`flex items-center gap-2 text-ink ${emphasis ? "font-semibold" : "font-medium"}`}>
        {icon}
        {label}
      </dt>
      <dd
        className={`figures font-semibold text-ink sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:text-right ${
          emphasis ? "text-2xl" : "text-xl"
        }`}
      >
        {amount}
      </dd>
      <dd className="text-sm text-ink-2 sm:col-start-1 sm:row-start-2">
        {description}
        {money ? <Caveat money={money} /> : null}
      </dd>
    </div>
  );
}

/** One plain-language sentence about what a figure leaves out. */
function Caveat({ money }: { money: Money }) {
  if (money.complete) return null;
  const pending = money.excluded.filter((e) => e.reason !== "cost_missing");
  const missing = money.excluded.filter((e) => e.reason === "cost_missing");

  return (
    <ul className="mt-2 space-y-1 text-sm text-ink-2">
      {pending.length ? (
        <li className="flex gap-2">
          <Icon name="unclear" size={16} className="mt-0.5 shrink-0 text-unclear" />
          <span>Leaves out {pending.map(exclusionText).join(" and ")}.</span>
        </li>
      ) : null}
      {missing.length ? (
        <li className="flex gap-2">
          <Icon name="missing" size={16} className="mt-0.5 shrink-0 text-ink-3" />
          <span>
            Leaves out {missing.map(exclusionText).join(", ")} &mdash; the letter names{" "}
            {missing.length === 1 ? "this cost" : "these costs"} but gives no amount, so
            the real figure is higher.
          </span>
        </li>
      ) : null}
    </ul>
  );
}

export function Overview({
  model,
  breakdown,
  ambiguities,
  onAnswer,
  onClear,
  onShowItem,
  onSelectCategory,
  listsCosts,
  unverifiedCount,
  loans,
  workStudy,
  assumptions,
  onAssumptions,
  missingCosts,
  estimates,
  onEstimate,
  costTotal,
  onCostTotal,
}: {
  model: DerivedModel;
  breakdown: Breakdown;
  ambiguities: AmbiguityView[];
  onAnswer: (ambiguityId: string, value: string) => void;
  onClear: (ambiguityId: string) => void;
  onShowItem: (itemId: string) => void;
  onSelectCategory: (key: CategoryKey) => void;
  /** False when the letter prices no costs at all -- common for award-only letters. */
  listsCosts: boolean;
  /** Figures the reader reported that failed the evidence check -- never counted. */
  unverifiedCount: number;
  /** Loans the letter offers, and work-study -- the same levers the What-If uses. */
  loans: LoanLever[];
  workStudy: number;
  assumptions: Assumptions;
  onAssumptions: (patch: Partial<Assumptions>) => void;
  /** Every cost the letter names without an amount (estimated or not). */
  missingCosts: MissingCost[];
  /** The student's estimates for those, by missing-cost id. */
  estimates: Record<string, number>;
  onEstimate: (missingCostId: string, amount: number | null) => void;
  /** A total yearly cost the student entered when the letter gives none. */
  costTotal: number | undefined;
  onCostTotal: (amount: number | null) => void;
}) {
  const { yearOne } = model;
  const estimated = yearOne.userEstimates.value;
  // Any unanswered question that blocks headline figures -- a period, or which
  // of two rates applies -- means the amount below is not the final one.
  const openQuestions = ambiguities.filter(
    (v) => v.ambiguity.blocks_headline && v.answer === undefined,
  ).length;
  const headline = yearOne.headlineAidTotal?.value ?? null;
  const gift = yearOne.giftAid;
  const pendingGift = gift.excluded
    .filter((e) => e.reason === "period_unknown")
    .reduce((acc, e) => acc + (e.amount ?? 0), 0);

  return (
    <section aria-labelledby="overview-heading" className="space-y-8">
      {/* The whole analysis in one sentence, before any table: what the letter
          calls aid, how much of it is not repaid, and what that leaves. Every
          figure comes from the engine, and an unresolved question always takes
          precedence over stating a final amount. */}
      <p className="max-w-3xl text-lg leading-relaxed text-ink-2">
        {headline !== null ? (
          <>
            This letter calls{" "}
            <strong className="font-semibold text-ink">{formatUSD(headline)}</strong> financial
            aid.{" "}
          </>
        ) : null}
        Only <strong className="font-semibold text-ink">{formatUSD(gift.value)}</strong> is aid
        you don&rsquo;t repay
        {!listsCosts ? (
          <> &mdash; and this letter doesn&rsquo;t say what college costs, so what&rsquo;s left
            to cover is still unknown.</>
        ) : openQuestions > 0 ? (
          // An open question outranks the figure: stating one here would imply
          // a total FinePrint cannot know yet.
          <>
            {" "}
            &mdash; and what&rsquo;s left to cover depends on the question
            {openQuestions > 1 ? "s" : ""} below.
          </>
        ) : (
          <>
            {" "}
            &mdash; leaving about{" "}
            <strong className="font-semibold text-ink">
              {formatUSD(Math.max(0, yearOne.amountToCover.value))}
            </strong>{" "}
            to cover this year.
          </>
        )}
      </p>

      {/* The sentence above already explains this stage, so the heading carries
          no second line of its own. */}
      <h2 id="overview-heading" className="text-2xl font-semibold tracking-tight text-ink">
        1. What the letter says, and what&rsquo;s actually yours
      </h2>

      {/* The contrast. */}
      <div className="grid items-end gap-6 sm:grid-cols-[auto_auto_1fr] sm:gap-8">
        {headline !== null ? (
          <>
            <div>
              <p className="text-sm font-medium text-ink-2">The letter says</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight text-ink-2">
                {formatUSD(headline)}
              </p>
              <p className="mt-1 text-sm text-ink-2">in &ldquo;financial aid&rdquo;</p>
            </div>
            <Icon
              name="arrow-right"
              size={28}
              className="hidden text-ink-3 sm:mb-8 sm:block"
            />
          </>
        ) : null}

        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <span aria-hidden="true" className="size-3 rounded-[3px] bg-gift" />
            Money you won&rsquo;t repay, this year
          </p>
          <p className="mt-1 text-6xl font-semibold tracking-tight text-ink">
            {formatUSD(gift.value)}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {pendingGift > 0 ? (
              <>
                confirmed so far &middot; {formatUSD(pendingGift)} more depends on one
                answer below
              </>
            ) : gift.value === 0 && unverifiedCount > 0 ? (
              // $0 here can mean "none confirmed", not "none offered". Say which.
              <>
                none confirmed &middot; {unverifiedCount} reported{" "}
                {unverifiedCount === 1 ? "figure" : "figures"} couldn&rsquo;t be checked against
                the letter and {unverifiedCount === 1 ? "is" : "are"} listed at the end
              </>
            ) : (
              <>grants and scholarships &middot; loans and work-study are not counted</>
            )}
          </p>
        </div>
      </div>

      <AidBreakdown breakdown={breakdown} onSelectCategory={onSelectCategory} />

      {ambiguities.map((view) => (
        <AmbiguityPrompt
          key={view.ambiguity.id}
          ambiguity={view.ambiguity}
          answer={view.answer}
          impacts={view.impacts}
          onAnswer={(value) => onAnswer(view.ambiguity.id, value)}
          onClear={() => onClear(view.ambiguity.id)}
          onShowEvidence={view.itemId ? () => onShowItem(view.itemId as string) : undefined}
        />
      ))}

      {/* Year one, stated precisely. Each figure says what it is and what it leaves out. */}
      <div>
        <h2 id="year-one" className="scroll-mt-6 text-2xl font-semibold tracking-tight text-ink">
          2. What you&rsquo;d pay this year
        </h2>
        <p className="mt-1 max-w-2xl text-ink-2">
          Costs minus the aid you don&rsquo;t repay &mdash; then how loans, work-study and your
          own money could cover what&rsquo;s left.
        </p>
      </div>

      <div className="rounded-lg border border-rule bg-card">
        <h3 className="border-b border-rule px-5 py-3 text-sm font-semibold text-ink">
          Your first year
        </h3>
        {listsCosts ? (
          <dl className="divide-y divide-rule">
            <FigureRow
              label="Cost of attendance"
              description={
                // Say where the figure came from, and how much of it is the student's.
                yearOne.costBasis === "user_total" ? (
                  <>
                    <span className="block">
                      Your school&rsquo;s yearly cost of attendance, as you entered it &mdash;
                      the letter doesn&rsquo;t give one.
                    </span>
                    <span className="mt-1 block">
                      <DollarEntry
                        label="Your school's yearly cost of attendance"
                        value={costTotal}
                        onSave={onCostTotal}
                        addText="Enter your school's yearly cost"
                        tag="Provided by you"
                        showValue={false}
                      />
                    </span>
                  </>
                ) : (
                  <>
                    {yearOne.costBasis === "letter_total"
                      ? "The total cost of attendance the letter states for the year."
                      : "Tuition, housing, meals and other costs the letter lists for the year."}
                    {estimated > 0 ? (
                      <span className="mt-1 flex items-center gap-1.5 text-ink">
                        <Icon name="user" size={14} className="shrink-0 text-ink-2" />
                        Includes {formatUSD(estimated)} you estimated for costs the letter
                        doesn&rsquo;t price.
                      </span>
                    ) : null}
                  </>
                )
              }
              amount={formatUSD(yearOne.costOfAttendance.value)}
              money={yearOne.costOfAttendance}
            />
            <FigureRow
              label="Minus gift aid"
              icon={<Icon name="gift" size={18} className="text-gift" />}
              description="Only money you don't repay. Loans and work-study are not subtracted."
              amount={`${gift.value > 0 ? "−" : ""}${formatUSD(gift.value)}`}
            />
            <FigureRow
              label="Estimated amount to cover"
              description={
                yearOne.amountToCover.value < 0 ? (
                  // Nobody owes a negative amount; the surplus is not spending money.
                  <>
                    Gift aid is {formatUSD(-yearOne.amountToCover.value)} more than these costs.
                    Don&rsquo;t count on the difference: ask the aid office before planning
                    around it.
                  </>
                ) : (
                  "What's left to pay from savings, earnings or loans."
                )
              }
              amount={formatUSD(Math.max(0, yearOne.amountToCover.value))}
              money={yearOne.amountToCover}
              emphasis
            />
          </dl>
        ) : (
          // Missing costs are never treated as $0 -- that would show a debt-free
          // year for a letter that simply didn't print the bill. The student can
          // supply the figure; FinePrint never looks it up or guesses it.
          <div className="flex gap-3 px-5 py-4 text-sm text-ink-2">
            <Icon name="missing" size={20} className="mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">We need one more piece of information.</p>
              <p className="mt-1">
                This letter lists your aid, but not what college costs &mdash; so FinePrint
                can&rsquo;t work out what&rsquo;s left to cover, and won&rsquo;t guess. Because there is
                no starting cost figure, enter the complete yearly cost here instead of adding
                only a few missing categories. Your school&rsquo;s yearly cost of attendance is
                on its financial-aid website or portal; it normally already includes books,
                transportation and personal costs.
              </p>
              <div className="mt-3">
                <DollarEntry
                  label="Your school's yearly cost of attendance"
                  value={costTotal}
                  onSave={onCostTotal}
                  addText="Enter your school's yearly cost"
                  tag="Provided by you"
                />
              </div>
            </div>
          </div>
        )}

        {listsCosts && yearOne.costBasis !== "user_total" ? (
          <MissingCosts missing={missingCosts} estimates={estimates} onEstimate={onEstimate} />
        ) : null}
        {listsCosts ? (
          <p aria-live="polite" className="sr-only">
            Cost of attendance for the year: {formatUSD(yearOne.costOfAttendance.value)}
            {estimated > 0 ? `, including ${formatUSD(estimated)} you estimated` : ""}.
          </p>
        ) : null}

        {/* How it might be paid for. With no costs there is nothing to split, so
            just say what is offered. */}
        {listsCosts ? (
          <CoverIt
            yearOne={yearOne}
            loans={loans}
            workStudy={workStudy}
            assumptions={assumptions}
            onAssumptions={onAssumptions}
          />
        ) : (
          <div className="grid gap-4 border-t border-rule px-5 py-4 sm:grid-cols-2">
            <p className="flex gap-3 text-sm text-ink-2">
              <Icon name="loan" size={20} className="mt-0.5 shrink-0 text-loan" />
              <span>
                <span className="block font-medium text-ink">
                  Loans offered: <span className="figures">{formatUSD(yearOne.loansOffered.value)}</span>
                </span>
                Could cover part of this, but you repay it with interest. You don&rsquo;t have
                to accept it.
              </span>
            </p>
            <p className="flex gap-3 text-sm text-ink-2">
              <Icon name="work" size={20} className="mt-0.5 shrink-0 text-work" />
              <span>
                <span className="block font-medium text-ink">
                  Work-study offered:{" "}
                  <span className="figures">{formatUSD(yearOne.workStudyOffered.value)}</span>
                </span>
                Paid as wages for hours you work during the year &mdash; not taken off your bill
                up front.
              </span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

const focusRing =
  "outline-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";

/**
 * How the amount to cover might be paid for: financing, never cost.
 *
 * Accepting a loan or counting work-study moves money into "still to cover
 * from other sources" -- it never touches "Estimated amount to cover" above,
 * because borrowing does not make college cheaper. The toggles write the same
 * assumptions the What-If panel does, so the two can never disagree, and every
 * figure here is read from the engine's year-one result.
 */
function CoverIt({
  yearOne,
  loans,
  workStudy,
  assumptions,
  onAssumptions,
}: {
  yearOne: YearOne;
  loans: LoanLever[];
  workStudy: number;
  assumptions: Assumptions;
  onAssumptions: (patch: Partial<Assumptions>) => void;
}) {
  if (!loans.length && workStudy <= 0) return null;

  const borrowed = yearOne.loansAccepted.value;
  const stillToCover = Math.max(0, yearOne.outOfPocket.value);
  const beyondNeed = yearOne.outOfPocket.value < 0;

  return (
    <div className="border-t border-rule px-5 py-4">
      <fieldset>
        <legend className="text-sm font-semibold text-ink">How will you cover it?</legend>
        <div className="mt-2 space-y-2 text-sm">
          {loans.map((l) => {
            const on = assumptions.loansAccepted[l.id] === true;
            return (
              <label
                key={l.id}
                className={`flex cursor-pointer items-start justify-between gap-4 rounded ${focusRing}`}
              >
                <span className="flex items-start gap-2.5 text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-ink"
                    checked={on}
                    onChange={(e) =>
                      onAssumptions({
                        loansAccepted: { ...assumptions.loansAccepted, [l.id]: e.target.checked },
                      })
                    }
                  />
                  <span>
                    <Icon name="loan" size={14} className="mr-1 inline text-loan" />
                    {l.label}
                  </span>
                </span>
                <span className={`figures shrink-0 ${on ? "font-medium text-ink" : "text-ink-3"}`}>
                  {on ? "−" : ""}
                  {formatUSD(l.amount)}
                </span>
              </label>
            );
          })}
          {workStudy > 0 ? (
            <label className={`flex cursor-pointer items-start justify-between gap-4 rounded ${focusRing}`}>
              <span className="flex items-start gap-2.5 text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-ink"
                  checked={assumptions.countWorkStudyTowardCosts}
                  onChange={(e) => onAssumptions({ countWorkStudyTowardCosts: e.target.checked })}
                />
                <span>
                  <Icon name="work" size={14} className="mr-1 inline text-work" />
                  Count expected work-study earnings
                  <span className="block text-xs text-ink-2">
                    {formatUSD(workStudy)} offered &middot; earned through work, not paid upfront
                  </span>
                </span>
              </span>
              <span
                className={`figures shrink-0 ${
                  assumptions.countWorkStudyTowardCosts ? "font-medium text-ink" : "text-ink-3"
                }`}
              >
                {assumptions.countWorkStudyTowardCosts ? "−" : ""}
                {formatUSD(workStudy)}
              </span>
            </label>
          ) : null}
        </div>
      </fieldset>

      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-rule pt-3">
        <span className="font-medium text-ink">Still to cover from other sources</span>
        <span className="figures text-xl font-semibold text-ink">{formatUSD(stillToCover)}</span>
      </div>
      <p aria-live="polite" className="sr-only">
        Still to cover from other sources: {formatUSD(stillToCover)}.
      </p>
      {beyondNeed ? (
        <p className="mt-1 text-sm text-ink-2">
          What you&rsquo;ve selected is more than you need to cover. You don&rsquo;t have to
          borrow the full amount offered.
        </p>
      ) : null}

      {borrowed > 0 ? (
        <div className="mt-3 flex gap-3 text-sm text-ink-2">
          <Icon name="loan" size={20} className="mt-0.5 shrink-0 text-loan" />
          <p>
            <span className="block font-semibold text-ink">{formatUSD(borrowed)} borrowed</span>
            You&rsquo;ll still owe this loan principal, plus interest.
            <span className="mt-1 block text-xs">
              Federal repayment terms depend on your total loan balance and repayment plan.{" "}
              {/* Listed in studentaid.gov/sitemap.xml, checked 2026-09-19. */}
              <a
                href="https://studentaid.gov/manage-loans/repayment"
                className="rounded font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                Learn about federal repayment
              </a>
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
