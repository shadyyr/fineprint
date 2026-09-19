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
import { ZodError } from "zod";

import {
  defaultAssumptions,
  emptyOverrides,
  type Assumptions,
  type Overrides,
} from "@/lib/engine";
import { DEFAULT_SAMPLE, fetchSamples } from "@/lib/samples";
import { CanonicalDocument, type CanonicalDocument as Doc } from "@/lib/schema";

export type Status = "idle" | "loading" | "ready" | "error";

interface SessionState {
  status: Status;
  error: string | null;
  /** Which path failed, so the error page can offer the right way forward. */
  failed: "upload" | "sample" | null;
  /** Which demo sample is loaded (or loading); null for an upload. */
  sampleSlug: string | null;
  doc: Doc | null;
  /** PDF bytes for an upload, or a URL for the bundled sample. */
  pdf: ArrayBuffer | string | null;
  overrides: Overrides;
  assumptions: Assumptions;
  selectedItemId: string | null;

  /** Load a demo sample by slug; omitted means the first (Meridian). */
  loadSample: (slug?: string) => Promise<void>;
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
  failed: null as "upload" | "sample" | null,
  sampleSlug: null as string | null,
  doc: null,
  pdf: null,
  overrides: emptyOverrides(),
  assumptions: defaultAssumptions(),
  selectedItemId: null,
});

/** "about 40 minutes" / "about 3 hours", from a Retry-After in seconds. */
function waitText(retryAfter: string | null): string | null {
  const seconds = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return "about a minute";
  if (minutes < 90) return `about ${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") {
      const wait = response.status === 429 ? waitText(response.headers.get("Retry-After")) : null;
      return wait ? `${body.detail} You can try again in ${wait}.` : body.detail;
    }
  } catch {
    // Fall through.
  }
  if (response.status === 413) {
    return "That PDF is too large to upload here. Try a smaller export of the letter.";
  }
  return `Something went wrong on FinePrint's side (error ${response.status}). Try again, or explore the sample offer.`;
}

/** A thrown error, in words a student can act on. Never a stack of JSON. */
function describe(cause: unknown): string {
  if (cause instanceof ZodError) {
    // The reader's result is checked against the schema before anything is
    // shown. When it doesn't fit, nothing from it is trustworthy enough to show.
    return "The result didn't match the format FinePrint checks every reading against, so none of it is shown. Try again, or explore the sample offer.";
  }
  if (cause instanceof TypeError) {
    // fetch() rejects with a TypeError when the request never completes.
    return "FinePrint couldn't reach its server. Check your internet connection and try again.";
  }
  return cause instanceof Error ? cause.message : "Something unexpected went wrong.";
}

export const useSession = create<SessionState>((set) => ({
  ...fresh(),

  async loadSample(slug) {
    const wanted = slug || DEFAULT_SAMPLE.slug;
    set({ ...fresh(), status: "loading", sampleSlug: wanted });
    try {
      const samples = await fetchSamples();
      const entry = slug ? samples.find((s) => s.slug === slug) : samples[0];
      if (!entry) {
        throw new Error("There's no sample by that name. Start over to pick one of the samples.");
      }
      const response = await fetch(entry.json);
      if (!response.ok) {
        throw new Error(`The sample offer couldn't be loaded (error ${response.status}). Try again in a moment.`);
      }
      // Parsed at the boundary, so a fixture that drifts from the schema fails
      // here with a clear error instead of halfway through a projection.
      const doc = CanonicalDocument.parse(await response.json());
      set({ status: "ready", doc, pdf: entry.pdf, sampleSlug: entry.slug });
    } catch (cause) {
      set({ status: "error", failed: "sample", error: describe(cause) });
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
        set({ status: "error", failed: "upload", error: await readError(response) });
        return false;
      }

      const doc = CanonicalDocument.parse(await response.json());
      set({ status: "ready", doc, pdf: await file.arrayBuffer() });
      return true;
    } catch (cause) {
      set({ status: "error", failed: "upload", error: describe(cause) });
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
