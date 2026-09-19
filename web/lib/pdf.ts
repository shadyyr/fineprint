/**
 * pdf.js setup.
 *
 * The worker is copied into public/ by the `sync:pdfworker` npm script (run
 * on postinstall) rather than imported, because bundling pdf.js's worker
 * through Next's build is the classic way to lose an afternoon.
 *
 * Coordinate contract: the API returns bounding boxes normalized to 0-1 with
 * a top-left origin and page rotation already applied. That is exactly the
 * space `getViewport()` renders into, so a box maps to pixels by multiplying
 * against viewport width and height. Nothing here re-derives geometry.
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Load pdf.js on first use, in the browser only.
 *
 * A top-level import gets evaluated on the server during SSR, where pdf.js
 * warns that it needs its legacy Node build and can reach for DOM APIs that do
 * not exist. Every caller runs from an effect, so deferring the import keeps
 * the library out of the server bundle entirely. Type imports above are erased.
 */
function getPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  });
  return pdfjsPromise;
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  /** Aborts pending work and tears down the worker. */
  destroy: () => Promise<void>;
}

/**
 * Open a PDF.
 *
 * In pdf.js 6 the teardown method lives on the loading task rather than the
 * document, so it is returned alongside: dropping only the document leaks a
 * worker per load, which matters here because the debug page and the X-Ray
 * both reopen documents as the user switches files.
 */
export async function loadPdf(data: ArrayBuffer | Uint8Array): Promise<LoadedPdf> {
  const pdfjs = await getPdfJs();
  // pdf.js transfers and neuters the buffer it is given, so hand it a copy.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

/**
 * Render a page to a canvas at a given CSS width, accounting for device
 * pixel ratio so text stays sharp on retina displays.
 *
 * Returns the CSS pixel size of the rendered page, which is the box the
 * evidence overlay is positioned against.
 */
export async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<{ width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get a 2D canvas context.");

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
  }).promise;

  return { width: viewport.width, height: viewport.height };
}

/** Convert a normalized bbox into CSS pixel offsets within a rendered page. */
export function bboxToStyle(
  bbox: readonly [number, number, number, number],
  size: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const [x0, y0, x1, y1] = bbox;
  return {
    left: x0 * size.width,
    top: y0 * size.height,
    width: (x1 - x0) * size.width,
    height: (y1 - y0) * size.height,
  };
}

export type { PDFDocumentProxy, PDFPageProxy };
