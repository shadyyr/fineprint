"use client";

/**
 * Coordinate validator (M3 gate).
 *
 * Draws every extracted line box over the rendered PDF. This exists because
 * the extraction service (PyMuPDF, top-left origin, unrotated) and the
 * renderer (pdf.js, rotation applied) are two different coordinate systems,
 * and the signature evidence-highlight interaction is only as good as their
 * agreement.
 *
 * Nothing that depends on evidence linking should be built until the boxes
 * here sit on their text -- including for a deliberately rotated PDF.
 */

import { useCallback, useState } from "react";

import { PdfCanvas, type PageSize } from "@/components/PdfCanvas";
import { bboxToStyle } from "@/lib/pdf";

interface DebugLine {
  line_id: string;
  page: number;
  text: string;
  bbox: [number, number, number, number];
}

interface DebugIngest {
  pages: { page: number; width_pt: number; height_pt: number; rotation: number }[];
  lines: DebugLine[];
  char_count: number;
  text_layer_sufficient: boolean;
}

export default function DebugBoxesPage() {
  const [source, setSource] = useState<ArrayBuffer | string | null>(null);
  const [data, setData] = useState<DebugIngest | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const analyze = useCallback(async (file: File | Blob, name: string) => {
    setStatus("Extracting…");
    setData(null);

    const bytes = await file.arrayBuffer();
    setSource(bytes.slice(0));

    const body = new FormData();
    body.append("file", new File([bytes], name, { type: "application/pdf" }));

    const response = await fetch("/api/debug-ingest", { method: "POST", body });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.detail ?? "Extraction failed.");
      return;
    }
    setData(payload);
    setStatus(null);
  }, []);

  const overlay = useCallback(
    (page: number, size: PageSize) => {
      if (!data) return null;
      return data.lines
        .filter((line) => line.page === page)
        .map((line) => {
          const style = bboxToStyle(line.bbox, size);
          const isSelected = selected === line.line_id;
          return (
            <span
              key={line.line_id}
              title={`${line.line_id}: ${line.text}`}
              onMouseEnter={() => setSelected(line.line_id)}
              className="pointer-events-auto absolute"
              style={{
                ...style,
                outline: `1px solid ${isSelected ? "#dc2626" : "#2563eb"}`,
                background: isSelected
                  ? "rgba(220,38,38,0.22)"
                  : "rgba(37,99,235,0.10)",
              }}
            />
          );
        });
    },
    [data, selected],
  );

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold">Coordinate validator</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        Every extracted line box drawn over the rendered page. Boxes must sit on
        their text. Check a rotated PDF too — PyMuPDF reports unrotated
        geometry while pdf.js applies <code>/Rotate</code>, so rotation is where
        this breaks first.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          onClick={async () => {
            const res = await fetch("/sample_offer.pdf");
            await analyze(await res.blob(), "sample_offer.pdf");
          }}
        >
          Load sample offer
        </button>

        <label className="text-sm">
          <span className="mr-2">or upload a PDF:</span>
          <input
            type="file"
            accept="application/pdf"
            className="text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void analyze(file, file.name);
            }}
          />
        </label>
      </div>

      {status ? (
        <p role="status" className="mt-4 text-sm text-slate-700">
          {status}
        </p>
      ) : null}

      {data ? (
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div>
            <dt className="inline font-medium">Lines: </dt>
            <dd className="inline">{data.lines.length}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Characters: </dt>
            <dd className="inline">{data.char_count}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Text layer: </dt>
            <dd className="inline">
              {data.text_layer_sufficient ? "sufficient" : "INSUFFICIENT"}
            </dd>
          </div>
          {data.pages.map((p) => (
            <div key={p.page}>
              <dt className="inline font-medium">Page {p.page}: </dt>
              <dd className="inline">
                {Math.round(p.width_pt)}×{Math.round(p.height_pt)}pt, rotation{" "}
                {p.rotation}°
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {source ? (
        <div className="mt-6">
          <PdfCanvas source={source} width={720} renderOverlay={overlay} />
        </div>
      ) : null}
    </main>
  );
}
