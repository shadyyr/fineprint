"use client";

/**
 * Renders a PDF and exposes each page's rendered size so callers can position
 * overlays against it.
 *
 * The component owns rendering only. It draws no highlights itself: the
 * evidence overlay and the debug validator both render into the slot this
 * gives them, so there is exactly one place where a normalized bbox becomes
 * pixels (`bboxToStyle`).
 */

import { useEffect, useRef, useState } from "react";

import { isRenderCancelled, loadPdf, renderPage, type PDFDocumentProxy } from "@/lib/pdf";

export interface PageSize {
  width: number;
  height: number;
}

export interface PdfCanvasProps {
  /** Raw PDF bytes, or a URL to fetch them from. */
  source: ArrayBuffer | string;
  /** Rendered width of each page in CSS pixels. */
  width?: number;
  /** Renders overlay content positioned over a given page. */
  renderOverlay?: (page: number, size: PageSize) => React.ReactNode;
  /** Called once the document is loaded, with the page count. */
  onLoad?: (pageCount: number) => void;
}

export function PdfCanvas({
  source,
  width = 720,
  renderOverlay,
  onLoad,
}: PdfCanvasProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Record<number, PageSize>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => Promise<void>) | null = null;

    (async () => {
      try {
        const bytes =
          typeof source === "string"
            ? await (await fetch(source)).arrayBuffer()
            : source;
        const loaded = await loadPdf(bytes);
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        teardown = loaded.destroy;
        setDoc(loaded.doc);
        setError(null);
        onLoad?.(loaded.doc.numPages);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not open the PDF.");
        }
      }
    })();

    return () => {
      cancelled = true;
      void teardown?.();
    };
    // onLoad is intentionally excluded: callers commonly pass an inline
    // function, and including it would re-open the document every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  if (error) {
    return (
      <p role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-red-900">
        {error}
      </p>
    );
  }

  if (!doc) {
    return <p className="p-4 text-slate-500">Loading document…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((pageNumber) => (
        <PdfPage
          key={pageNumber}
          doc={doc}
          pageNumber={pageNumber}
          width={width}
          size={sizes[pageNumber]}
          onSize={(size) =>
            setSizes((prev) =>
              prev[pageNumber]?.width === size.width &&
              prev[pageNumber]?.height === size.height
                ? prev
                : { ...prev, [pageNumber]: size },
            )
          }
          renderOverlay={renderOverlay}
        />
      ))}
    </div>
  );
}

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  size?: PageSize;
  onSize: (size: PageSize) => void;
  renderOverlay?: (page: number, size: PageSize) => React.ReactNode;
}

function PdfPage({
  doc,
  pageNumber,
  width,
  size,
  onSize,
  renderOverlay,
}: PdfPageProps) {
  // The finished canvas is swapped into this holder in one step. Nothing ever
  // draws into a canvas that is already on screen, so a render cannot be reset
  // halfway through and left behind half-drawn (see renderPage).
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let job: ReturnType<typeof renderPage> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      job = renderPage(page, width);
      try {
        const done = await job.promise;
        // A newer render superseded this one while it was drawing. Its canvas
        // never reaches the page.
        if (cancelled || !holderRef.current) return;
        holderRef.current.replaceChildren(done.canvas);
        onSize({ width: done.width, height: done.height });
      } catch (error) {
        if (!isRenderCancelled(error)) throw error;
      }
    })();

    return () => {
      cancelled = true;
      job?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, width]);

  return (
    <figure
      className="relative m-0 bg-white shadow-sm ring-1 ring-slate-300 print:break-inside-avoid print:shadow-none"
      style={{ width }}
    >
      {/* Until the first render lands, hold the page's space at letter
          proportions so the layout doesn't jump when it arrives. */}
      <div
        ref={holderRef}
        style={size ? undefined : { width, height: Math.round(width * (11 / 8.5)) }}
      />
      {size && renderOverlay ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ width: size.width, height: size.height }}
        >
          {renderOverlay(pageNumber, size)}
        </div>
      ) : null}
      <figcaption className="sr-only">Page {pageNumber}</figcaption>
    </figure>
  );
}
