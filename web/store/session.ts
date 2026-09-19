/**
 * Session state.
 *
 * Holds the three layers the engine consumes -- the parsed document (source
 * facts), the user's answers (overrides) and the scenario (assumptions) -- as
 * three separate fields. Nothing here merges them; `derive()` does that on
 * read, so what the letter said and what the user told us stay distinguishable.
 *
 * In memory only. A student's aid letter is never written to browser storage.
 */

import { create } from "zustand";

import {
  defaultAssumptions,
  emptyOverrides,
  type Assumptions,
  type Overrides,
} from "@/lib/engine";
import { CanonicalDocument, type CanonicalDocument as Doc } from "@/lib/schema";

export type Status = "idle" | "loading" | "ready" | "error";

interface SessionState {
  status: Status;
  error: string | null;
  doc: Doc | null;
  /** PDF bytes for an upload, or a URL for the bundled sample. */
  pdf: ArrayBuffer | string | null;
  overrides: Overrides;
  assumptions: Assumptions;
  selectedItemId: string | null;

  loadSample: () => Promise<void>;
  analyzeFile: (file: File) => Promise<boolean>;
  answer: (ambiguityId: string, value: string) => void;
  clearAnswer: (ambiguityId: string) => void;
  setAssumptions: (patch: Partial<Assumptions>) => void;
  select: (itemId: string | null) => void;
  reset: () => void;
}

const fresh = () => ({
  status: "idle" as Status,
  error: null,
  doc: null,
  pdf: null,
  overrides: emptyOverrides(),
  assumptions: defaultAssumptions(),
  selectedItemId: null,
});

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // Fall through.
  }
  return `Something went wrong (${response.status}). Try the sample offer instead.`;
}

export const useSession = create<SessionState>((set) => ({
  ...fresh(),

  async loadSample() {
    set({ ...fresh(), status: "loading" });
    try {
      const response = await fetch("/sample_offer.json");
      if (!response.ok) throw new Error(`Sample unavailable (${response.status}).`);
      // Parsed at the boundary, so a fixture that drifts from the schema fails
      // here with a clear error instead of halfway through a projection.
      const doc = CanonicalDocument.parse(await response.json());
      set({ status: "ready", doc, pdf: "/sample_offer.pdf" });
    } catch (cause) {
      set({
        status: "error",
        error: cause instanceof Error ? cause.message : "Could not load the sample.",
      });
    }
  },

  async analyzeFile(file) {
    set({ ...fresh(), status: "loading" });
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await fetch("/api/analyze", { method: "POST", body });

      if (!response.ok) {
        // No fixture fallback here, deliberately: the fixture describes a
        // different, made-up letter. Showing it for someone's own upload would
        // present another school's numbers as theirs.
        set({ status: "error", error: await readError(response) });
        return false;
      }

      const doc = CanonicalDocument.parse(await response.json());
      set({ status: "ready", doc, pdf: await file.arrayBuffer() });
      return true;
    } catch (cause) {
      set({
        status: "error",
        error:
          cause instanceof Error
            ? `FinePrint couldn't read that letter: ${cause.message}`
            : "FinePrint couldn't read that letter.",
      });
      return false;
    }
  },

  answer(ambiguityId, value) {
    set((s) => ({
      overrides: {
        ...s.overrides,
        ambiguityAnswers: { ...s.overrides.ambiguityAnswers, [ambiguityId]: value },
      },
    }));
  },

  clearAnswer(ambiguityId) {
    set((s) => {
      const next = { ...s.overrides.ambiguityAnswers };
      delete next[ambiguityId];
      return { overrides: { ...s.overrides, ambiguityAnswers: next } };
    });
  },

  setAssumptions(patch) {
    set((s) => ({ assumptions: { ...s.assumptions, ...patch } }));
  },

  select(itemId) {
    set({ selectedItemId: itemId });
  },

  reset() {
    set(fresh());
  },
}));
