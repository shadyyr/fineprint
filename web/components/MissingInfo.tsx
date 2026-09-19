"use client";

/**
 * Missing information the student can supply.
 *
 * FinePrint's rule is MISSING != $0: a cost the letter names but doesn't price
 * stays out of every total until the student gives an amount. This is where
 * they give it. Every value entered here is the student's -- labelled "Your
 * estimate" or "Provided by you", never "from your offer" -- and it lives in
 * the overrides layer, so the letter's own facts are never rewritten. The
 * engine does all the arithmetic; this file only collects and shows amounts.
 */

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { parseDollars } from "@/lib/dollars";
import { formatUSD } from "@/lib/engine";
import type { MissingCost } from "@/lib/schema";

const linkButton =
  "rounded text-sm font-medium text-ink underline decoration-rule-2 underline-offset-4 outline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

/**
 * One amount the student can add, change or remove.
 *
 * Unset: an "add" button. Editing: a labelled field with Save/Cancel. Saved:
 * the amount, a text tag saying whose it is, and Edit/Remove. Removing returns
 * to unset -- the cost goes back to missing, not to $0.
 */
export function DollarEntry({
  label,
  value,
  onSave,
  addText,
  tag,
  showValue = true,
  startOpen = false,
}: {
  /** What the amount is, for the field's label ("Transportation, per year"). */
  label: string;
  value: number | undefined;
  onSave: (amount: number | null) => void;
  addText: string;
  /** Says whose value this is: "Your estimate", "Provided by you". */
  tag: string;
  /** Hide the saved amount when it is already shown beside this control. */
  showValue?: boolean;
  startOpen?: boolean;
}) {
  const inputId = useId();
  const errorId = useId();
  const [editing, setEditing] = useState(startOpen && value === undefined);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restRef = useRef<HTMLButtonElement>(null);
  // Only move focus after the student acts, never on first render.
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current) return;
    if (editing) inputRef.current?.focus();
    else restRef.current?.focus();
  }, [editing, value]);

  const open = () => {
    moved.current = true;
    setDraft(value === undefined ? "" : String(value));
    setError(null);
    setEditing(true);
  };

  const save = () => {
    const parsed = parseDollars(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    moved.current = true;
    onSave(parsed.value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-start gap-2">
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <div className="flex items-center rounded-md border border-rule-2 bg-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
          <span aria-hidden="true" className="pl-2.5 text-sm text-ink-2">
            $
          </span>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                moved.current = true;
                setEditing(false);
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="figures w-28 bg-transparent px-1.5 py-1 text-sm text-ink outline-none"
          />
        </div>
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-ink px-3 py-1 text-sm font-medium text-card hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            moved.current = true;
            setEditing(false);
          }}
          className={linkButton}
        >
          Cancel
        </button>
        {error ? (
          <p id={errorId} role="alert" className="w-full text-sm text-ink">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (value === undefined) {
    return (
      <button ref={restRef} type="button" onClick={open} className={linkButton}>
        {addText}
        <span className="sr-only">: {label}</span>
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {showValue ? <span className="figures font-medium text-ink">{formatUSD(value)}</span> : null}
      <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2">
        <Icon name="user" size={14} className="shrink-0" />
        {tag}
      </span>
      <button ref={restRef} type="button" onClick={open} className={linkButton}>
        Edit<span className="sr-only"> {label}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          moved.current = true;
          onSave(null);
        }}
        className={linkButton}
      >
        Remove<span className="sr-only"> {label}</span>
      </button>
    </span>
  );
}

/** The costs the letter names without an amount, each with a place to add one. */
export function MissingCosts({
  missing,
  estimates,
  onEstimate,
}: {
  missing: MissingCost[];
  estimates: Record<string, number>;
  onEstimate: (missingCostId: string, amount: number | null) => void;
}) {
  if (!missing.length) return null;
  const open = missing.filter((m) => estimates[m.id] === undefined).length;

  return (
    <div className="border-t border-rule px-5 py-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon name="missing" size={16} className="shrink-0 text-ink-3" />
        {open ? "Your offer doesn’t include every cost" : "Costs you added"}
      </h4>
      <p className="mt-1 text-sm text-ink-2">
        {open
          ? "FinePrint couldn’t find amounts for these, so they aren’t counted — not treated as $0. Add your own yearly estimates to see a fuller picture."
          : "The letter doesn’t price these; the amounts are yours and are counted in the cost above."}
      </p>
      <ul className="mt-3 divide-y divide-rule text-sm">
        {missing.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
            <span className="text-ink">
              {m.label}
              {estimates[m.id] === undefined ? (
                <span className="block text-xs text-ink-2">Amount not listed</span>
              ) : null}
            </span>
            <DollarEntry
              label={`${m.label}, yearly estimate`}
              value={estimates[m.id]}
              onSave={(amount) => onEstimate(m.id, amount)}
              addText="Add estimate"
              tag="Your estimate"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
