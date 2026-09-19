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
 * Render a page at a given CSS width into a canvas of its own.
 *
 * Every render gets a brand-new canvas that the caller swaps into the page only
 * once it is completely drawn. The previous version drew into the canvas that
 * was already on screen, and re-rendered it whenever the pane's width changed
 * -- which a space-taking scrollbar appearing does moments after the first
 * render starts. Setting canvas.width to begin the second render cleared the
 * canvas and reset its drawing state while the first render was still
 * painting, so the rest of page 1 was drawn with no viewport transform: upside
 * down (PDF space is y-up), at one device pixel per point, on a transparent
 * background. A canvas that nothing else ever draws into cannot be reset out
 * from under a render.
 *
 * The device pixel ratio is folded into the viewport's scale rather than passed
 * as pdf.js's separate `transform` option, and only `{ canvas, viewport }` is
 * passed: the plainest form of the pdf.js 6 render call, with nothing left for
 * a browser to compose differently.
 */
export interface PageRenderJob {
  /** Resolves with the finished canvas and its CSS size. */
  promise: Promise<{ canvas: HTMLCanvasElement; width: number; height: number }>;
  /** Stops a render that has been superseded. */
  cancel: () => void;
}

export function renderPage(page: PDFPageProxy, cssWidth: number): PageRenderJob {
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const cssViewport = page.getViewport({ scale });
  const deviceViewport = page.getViewport({ scale: scale * dpr });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(deviceViewport.width);
  canvas.height = Math.floor(deviceViewport.height);
  canvas.style.width = `${cssViewport.width}px`;
  canvas.style.height = `${cssViewport.height}px`;
  canvas.style.display = "block";

  const task = page.render({ canvas, viewport: deviceViewport });

  return {
    cancel: () => task.cancel(),
    promise: task.promise.then(() => ({
      canvas,
      width: cssViewport.width,
      height: cssViewport.height,
    })),
  };
}

/** True for the rejection pdf.js raises when a render is deliberately cancelled. */
export function isRenderCancelled(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "RenderingCancelledException";
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
