"use client";

/**
 * The Financial X-Ray: the letter on one side, what FinePrint found in it on
 * the other, linked both ways. Select a line of the analysis and the document
 * scrolls to the words it came from; select a highlight in the document and the
 * analysis follows.
 *
 * Every highlight is drawn from coordinates the server resolved and verified
 * against the PDF's own text layer. The model never supplied a box.
 *
 * Accessibility, deliberately:
 *  - The analysis panel comes first in the DOM and the document second, then
 *    CSS places the document on the left. Screen readers and keyboard users
 *    reach the findings before the evidence.
 *  - Document highlights are real buttons but sit outside the tab order. The
 *    panel is the keyboard path; without this, a keyboard user would tab
 *    through two dozen highlights before reaching the list.
 *  - Selection is announced in a live region.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { PdfCanvas, type PageSize } from "@/components/PdfCanvas";
import { formatUSD } from "@/lib/engine";
import { bboxToStyle } from "@/lib/pdf";
import type { CanonicalDocument, Evidence } from "@/lib/schema";
import { CATEGORY, type CategoryKey, type XRayGroup, type XRayRow } from "@/lib/view";

export interface PanelGroup extends Omit<XRayGroup, "rows"> {
  rows: (Omit<XRayRow, "amount" | "category"> & {
    amount: number | null;
    category: CategoryKey | null;
  })[];
}

function truncate(text: string, max = 46): string {
  const clean = text.replace(/\.{3,}/g, " … ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      // Snap to 16px steps so a window drag doesn't re-rasterize every frame.
      const next = Math.floor(entry.contentRect.width / 16) * 16;
      setWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function XRay({
  doc,
  pdf,
  groups,
  selectedId,
  onSelect,
}: {
  doc: CanonicalDocument;
  pdf: ArrayBuffer | string;
  groups: PanelGroup[];
  selectedId: string | null;
  onSelect: (rowId: string | null) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [measureRef, paneWidth] = useElementWidth<HTMLDivElement>();
  const [announcement, setAnnouncement] = useState("");

  const evidenceById = useMemo(
    () => new Map(doc.evidence.map((e) => [e.id, e] as const)),
    [doc.evidence],
  );

  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);

  // Evidence -> the row that owns it. First owner wins, in panel order, so a
  // line shared by two loans selects the first of them.
  const ownerOf = useMemo(() => {
    const map = new Map<string, XRayRowLike>();
    for (const row of rows) {
      for (const ev of row.evidenceIds) if (!map.has(ev)) map.set(ev, row);
    }
    return map;
  }, [rows]);

  const selected = selectedId ? rowById.get(selectedId) ?? null : null;
  const selectedEvidence = useMemo(
    () => new Set(selected?.evidenceIds ?? []),
    [selected],
  );

  const scrollToEvidence = useCallback((evidenceId: string) => {
    const pane = paneRef.current;
    const target = pane?.querySelector<HTMLElement>(`[data-evidence="${evidenceId}"]`);
    if (!pane || !target) return;
    const paneBox = pane.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const top = pane.scrollTop + (box.top - paneBox.top) - pane.clientHeight / 2 + box.height / 2;
    pane.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);

  // Follow the selection into the document.
  useEffect(() => {
    if (!selected?.evidenceIds.length) return;
    const primary = selected.evidenceIds[0];
    // Pages render asynchronously; retry briefly until the highlight exists.
    let tries = 0;
    const tick = () => {
      if (paneRef.current?.querySelector(`[data-evidence="${primary}"]`)) {
        scrollToEvidence(primary);
      } else if (tries++ < 20) {
        timer = window.setTimeout(tick, 100);
      }
    };
    let timer = window.setTimeout(tick, 0);

    const ev = evidenceById.get(primary);
    const amount = selected.amount !== null ? `, ${formatUSD(selected.amount)}` : "";
    const kind = selected.category ? `, ${CATEGORY[selected.category].label}` : "";
    setAnnouncement(`${selected.label}${amount}${kind}. Shown on page ${ev?.page ?? "?"} of the letter.`);

    return () => window.clearTimeout(timer);
  }, [selected, evidenceById, scrollToEvidence]);

  const selectFromDocument = (evidenceId: string) => {
    const owner = ownerOf.get(evidenceId);
    if (!owner) return;
    onSelect(owner.id);
    document
      .getElementById(`row-${owner.id}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const renderOverlay = (page: number, size: PageSize) =>
    doc.evidence
      .filter((ev) => ev.page === page && ownerOf.has(ev.id))
      .map((ev) => (
        <Highlight
          key={ev.id}
          evidence={ev}
          size={size}
          owner={ownerOf.get(ev.id) as XRayRowLike}
          active={selectedEvidence.has(ev.id)}
          dimmed={selectedEvidence.size > 0 && !selectedEvidence.has(ev.id)}
          onSelect={() => selectFromDocument(ev.id)}
        />
      ));

  return (
    <section aria-labelledby="xray-heading" id="xray" className="scroll-mt-6">
      <div className="mb-5 max-w-2xl">
        <h2 id="xray-heading" className="text-2xl font-semibold tracking-tight text-ink">
          Financial X-Ray
        </h2>
        <p className="mt-1 text-ink-2">
          Every figure, traced to the exact words it came from. Select a line to see it in
          the letter &mdash; or select a highlight in the letter to see what it means.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        {/* Findings: first in the DOM for keyboard and screen-reader users. */}
        <div className="lg:order-2">
          <Panel groups={groups} selectedId={selectedId} onSelect={onSelect} evidenceById={evidenceById} onJump={scrollToEvidence} />
        </div>

        {/* The letter. */}
        <div className="lg:order-1 lg:sticky lg:top-4">
          <div
            ref={paneRef}
            className="max-h-[78vh] overflow-auto rounded-lg border border-rule bg-well p-3 sm:p-4"
          >
            <div ref={measureRef} className="w-full">
              {paneWidth > 0 ? (
                <PdfCanvas source={pdf} width={paneWidth} renderOverlay={renderOverlay} />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

type XRayRowLike = PanelGroup["rows"][number];

function Highlight({
  evidence,
  size,
  owner,
  active,
  dimmed,
  onSelect,
}: {
  evidence: Evidence;
  size: PageSize;
  owner: XRayRowLike;
  active: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const meta = owner.category ? CATEGORY[owner.category] : null;
  const color = meta?.color ?? "var(--color-ink-3)";
  const wash = meta?.wash ?? "rgb(98 104 122 / 0.1)";
  const box = bboxToStyle(evidence.bbox, size);
  // Pad the hit target: a 10pt row is about 12px tall at this width, too small
  // to select comfortably (master context 19).
  const pad = 4;

  return (
    <button
      type="button"
      tabIndex={-1}
      data-evidence={evidence.id}
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`${owner.label}${owner.amount !== null ? `, ${formatUSD(owner.amount)}` : ""}${
        meta ? `, ${meta.label}` : ""
      }. Page ${evidence.page}.`}
      className="pointer-events-auto absolute cursor-pointer rounded-[3px] transition-[opacity,background-color,box-shadow] duration-200"
      style={{
        left: box.left - pad,
        top: box.top - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
        background: active ? wash : "transparent",
        boxShadow: active
          ? `0 0 0 2px ${color}`
          : `inset 0 -2px 0 ${color}`,
        opacity: dimmed ? 0.25 : 1,
      }}
    >
      {active && evidence.amount_bbox ? (
        <AmountMark evidence={evidence} size={size} color={color} origin={box} pad={pad} />
      ) : null}
    </button>
  );
}

/** Emphasizes the number itself inside a selected row. */
function AmountMark({
  evidence,
  size,
  color,
  origin,
  pad,
}: {
  evidence: Evidence;
  size: PageSize;
  color: string;
  origin: { left: number; top: number };
  pad: number;
}) {
  const amount = bboxToStyle(evidence.amount_bbox as [number, number, number, number], size);
  // A ring only. An earlier version laid a translucent white fill over the
  // number, which faded the one figure the highlight exists to point at.
  return (
    <span
      aria-hidden="true"
      className="absolute rounded-[2px]"
      style={{
        left: amount.left - origin.left + pad - 3,
        top: amount.top - origin.top + pad - 3,
        width: amount.width + 6,
        height: amount.height + 6,
        boxShadow: `0 0 0 2px ${color}`,
      }}
    />
  );
}

function Panel({
  groups,
  selectedId,
  onSelect,
  evidenceById,
  onJump,
}: {
  groups: PanelGroup[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  evidenceById: Map<string, Evidence>;
  onJump: (evidenceId: string) => void;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`group-${group.key}`}>
          <header className="mb-2 flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-3 shrink-0 rounded-[3px]"
              style={{ background: group.color }}
            />
            <div className="min-w-0">
              <h3 id={`group-${group.key}`} className="flex items-center gap-1.5 font-semibold text-ink">
                <Icon name={group.icon} size={18} className="text-ink-2" />
                {group.title}
              </h3>
              <p className="text-sm text-ink-2">{group.meaning}</p>
            </div>
          </header>

          <ul className="overflow-hidden rounded-lg border border-rule bg-card">
            {group.rows.map((row) => {
              const isSelected = row.id === selectedId;
              const citations = row.evidenceIds
                .map((id) => evidenceById.get(id))
                .filter((e): e is Evidence => Boolean(e));
              return (
                <li
                  key={row.id}
                  id={`row-${row.id}`}
                  className={`scroll-mt-24 border-t border-rule first:border-t-0 ${
                    isSelected ? "bg-well" : ""
                  }`}
                  style={isSelected ? { boxShadow: `inset 3px 0 0 ${group.color}` } : undefined}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    disabled={!citations.length}
                    onClick={() => onSelect(isSelected ? null : row.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left outline-offset-[-2px] hover:bg-well focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-default enabled:cursor-pointer"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">{row.label}</span>
                      <span className="block text-sm text-ink-2">
                        {row.isTotal ? "Stated total · " : ""}
                        {row.periodText}
                      </span>
                    </span>
                    {row.amount !== null ? (
                      <span className="figures shrink-0 font-semibold text-ink">
                        {formatUSD(row.amount)}
                      </span>
                    ) : (
                      <span className="shrink-0 text-sm text-ink-2">no amount</span>
                    )}
                  </button>

                  {isSelected && (row.conditions.length || citations.length > 1) ? (
                    <div className="space-y-3 px-4 pb-4">
                      {row.conditions.length ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                            Conditions
                          </p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
                            {row.conditions.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {citations.length > 1 ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                            Where the letter says it
                          </p>
                          <ul className="mt-1.5 flex flex-col gap-1.5">
                            {citations.map((ev) => (
                              <li key={ev.id}>
                                <button
                                  type="button"
                                  onClick={() => onJump(ev.id)}
                                  className="flex w-full items-baseline gap-2 rounded border border-rule bg-card px-2.5 py-1.5 text-left text-sm hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-ink"
                                >
                                  <span className="shrink-0 font-medium text-ink">p.{ev.page}</span>
                                  <span className="min-w-0 truncate text-ink-2">
                                    &ldquo;{truncate(ev.quote)}&rdquo;
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {group.note ? <p className="mt-1.5 text-sm text-ink-2">{group.note}</p> : null}
        </section>
      ))}
    </div>
  );
}
