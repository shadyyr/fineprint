/**
 * Reading a dollar amount a student typed.
 *
 * Deliberately plain: USD only, whole or cents, an optional "$" and thousands
 * commas. Anything else is rejected with a sentence, never coerced -- a blank
 * field means "no estimate" (the cost goes back to missing), not $0.
 */

export type ParsedDollars =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Above this a yearly college cost is almost certainly a typo. */
const MAX = 1_000_000;

export function parseDollars(text: string): ParsedDollars {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };

  const cleaned = trimmed.replace(/^\$\s*/, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: "Enter a dollar amount, like 1500 or 1,500." };
  }
  const value = Number(cleaned.replace(/,/g, ""));
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Enter a dollar amount, like 1500 or 1,500." };
  }
  if (value > MAX) {
    return { ok: false, error: "That's more than $1,000,000 a year — check the amount." };
  }
  return { ok: true, value };
}
