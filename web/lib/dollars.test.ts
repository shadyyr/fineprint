import { describe, expect, it } from "vitest";

import { parseDollars } from "./dollars";

describe("parseDollars", () => {
  it("reads plain, $-prefixed, comma-grouped and cents amounts", () => {
    expect(parseDollars("1500")).toEqual({ ok: true, value: 1500 });
    expect(parseDollars(" $1,500 ")).toEqual({ ok: true, value: 1500 });
    expect(parseDollars("$ 34,800.50")).toEqual({ ok: true, value: 34800.5 });
    expect(parseDollars("0")).toEqual({ ok: true, value: 0 });
  });

  it("treats a blank field as no estimate, not $0", () => {
    expect(parseDollars("")).toEqual({ ok: true, value: null });
    expect(parseDollars("   ")).toEqual({ ok: true, value: null });
  });

  it("rejects negatives, words, malformed numbers and absurd amounts", () => {
    for (const bad of ["-5", "abc", "1e5", "1,50", "12.345", "1.2.3", "NaN", "Infinity", "$", "5000000"]) {
      expect(parseDollars(bad).ok).toBe(false);
    }
  });
});
