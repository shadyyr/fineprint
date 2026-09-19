import { Icon, type IconName } from "@/components/Icon";

import { StartActions } from "./StartActions";

const KINDS: { icon: IconName; color: string; title: string; body: string }[] = [
  {
    icon: "gift",
    color: "var(--color-gift)",
    title: "Gift aid",
    body: "Grants and scholarships. The money you don't pay back.",
  },
  {
    icon: "loan",
    color: "var(--color-loan)",
    title: "Loans",
    body: "Borrowed money, repaid with interest. Often counted as “aid” anyway.",
  },
  {
    icon: "work",
    color: "var(--color-work)",
    title: "Work-study",
    body: "A job you'd be paid for during the year — not a discount on your bill.",
  },
  {
    icon: "unclear",
    color: "var(--color-unclear)",
    title: "What the letter doesn't say",
    body: "Missing costs and amounts with no stated timing. FinePrint asks instead of guessing.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
        <p className="text-lg font-semibold tracking-tight text-ink">FinePrint</p>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          <section aria-labelledby="hero-heading">
            <h1
              id="hero-heading"
              className="max-w-xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl"
            >
              Know what your financial-aid offer actually means.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
              A letter can say &ldquo;$45,400 in financial aid&rdquo; when most of it is loans
              you repay or wages you have to earn. FinePrint reads your offer, shows what each
              dollar really is, and points to the exact words it came from.
            </p>
            <div className="mt-8 max-w-xl">
              <StartActions />
            </div>
          </section>

          <section aria-labelledby="kinds-heading" className="lg:pt-2">
            <h2 id="kinds-heading" className="text-sm font-semibold text-ink-2">
              What FinePrint separates out
            </h2>
            <ul className="mt-3 overflow-hidden rounded-xl border border-rule bg-card">
              {KINDS.map((kind) => (
                <li key={kind.title} className="flex gap-3 border-t border-rule px-5 py-4 first:border-t-0">
                  <span
                    aria-hidden="true"
                    className="mt-1 size-3 shrink-0 rounded-[3px]"
                    style={{ background: kind.color }}
                  />
                  <Icon name={kind.icon} size={20} className="mt-px shrink-0 text-ink-2" />
                  <div>
                    <p className="font-semibold text-ink">{kind.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{kind.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <ul className="mt-6 space-y-2.5 text-sm text-ink-2">
              <li className="flex gap-2.5">
                <Icon name="check" size={18} className="mt-px shrink-0 text-ink" />
                Every figure links to the line of the letter it came from.
              </li>
              <li className="flex gap-2.5">
                <Icon name="check" size={18} className="mt-px shrink-0 text-ink" />
                If a number can&rsquo;t be found in the letter&rsquo;s text, it isn&rsquo;t counted.
              </li>
              <li className="flex gap-2.5">
                <Icon name="check" size={18} className="mt-px shrink-0 text-ink" />
                FinePrint doesn&rsquo;t save your letter. It&rsquo;s read by an AI model to find
                the numbers, then your analysis lives only in this browser tab.
              </li>
            </ul>
          </section>
        </div>
      </main>

      <footer className="border-t border-rule">
        <p className="mx-auto max-w-6xl px-4 py-5 text-sm text-ink-2 sm:px-6">
          An educational tool, not financial advice. Built for SASEhack 2026.
        </p>
      </footer>
    </div>
  );
}
