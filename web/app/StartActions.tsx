"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { DEFAULT_SAMPLE, sampleHref, useSamples } from "@/lib/samples";
import { useSession } from "@/store/session";

type Health = "checking" | "live" | "unavailable";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function StartActions() {
  const router = useRouter();
  const inputId = useId();
  const privacyId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<Health>("checking");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask up front whether live reading works, so nobody uploads a letter only
  // to be told afterwards that the service isn't running.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => !cancelled && setHealth(body?.live ? "live" : "unavailable"))
      .catch(() => !cancelled && setHealth("unavailable"));
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.type && file.type !== "application/pdf") {
      setError("FinePrint reads PDF files. If your offer is a web page, save it as a PDF first.");
      return;
    }
    // The hosted site can't accept a request body much over 4.5 MB; aid
    // letters are almost always far smaller.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That PDF is larger than 4 MB, more than this site can accept. Try a smaller export of the letter.");
      return;
    }
    setBusy(true);
    router.push("/analyze");
    const ok = await useSession.getState().analyzeFile(file);
    if (!ok) {
      setBusy(false);
      // The analyze page shows the error with next steps.
    }
  };

  const uploadable = health === "live" && !busy;
  const otherSamples = useSamples().filter((s) => s.slug !== DEFAULT_SAMPLE.slug);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          if (!uploadable) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!uploadable) return;
          e.preventDefault();
          setDragging(false);
          void submit(e.dataTransfer.files?.[0]);
        }}
        className={`rounded-xl border-2 border-dashed p-6 transition-colors ${
          dragging ? "border-ink bg-well" : "border-rule-2 bg-card"
        }`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <Icon name="upload" size={28} className="shrink-0 text-ink-2" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">Upload your offer letter</p>
            <p className="text-sm text-ink-2">
              {health === "live"
                ? "A PDF, dragged here or chosen from your files."
                : health === "checking"
                  ? "Checking whether live reading is available…"
                  : "Live reading isn't switched on for this demo. Explore the sample to see how it works."}
            </p>
          </div>
          <label
            htmlFor={inputId}
            aria-disabled={!uploadable}
            className={`rounded-md px-4 py-2 font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
              uploadable
                ? "cursor-pointer bg-ink text-card hover:bg-ink-2"
                : "cursor-not-allowed bg-well text-ink-3"
            }`}
          >
            Choose a PDF
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept="application/pdf"
              disabled={!uploadable}
              aria-describedby={health === "live" ? privacyId : undefined}
              className="sr-only"
              onChange={(e) => void submit(e.target.files?.[0])}
            />
          </label>
        </div>
        {health === "live" ? (
          // Shown before anyone chooses a file (docs/DEPLOY_API.md): an aid
          // letter carries personal details, and it leaves this browser.
          <p id={privacyId} className="mt-4 border-t border-rule pt-3 text-xs leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">Where your letter goes:</span> to
            FinePrint&rsquo;s server and to OpenAI, which reads it. FinePrint doesn&rsquo;t
            save the letter or what&rsquo;s in it. OpenAI doesn&rsquo;t train on it but may keep
            it for up to 30 days for abuse checks. If you can, cover your name and student ID
            first.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/analyze?sample"
          className="inline-flex items-center gap-2 rounded-md border border-rule-2 bg-card px-4 py-2 font-medium text-ink hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Try a sample offer
          <Icon name="arrow-right" size={18} />
        </Link>
        <p className="text-sm text-ink-2">A made-up letter &mdash; no real student&rsquo;s data.</p>
      </div>
      {otherSamples.length ? (
        <p className="text-sm text-ink-2">
          Or a differently laid-out letter:{" "}
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
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
