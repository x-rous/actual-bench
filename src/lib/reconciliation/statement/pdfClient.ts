/** Browser-only PDF.js bridge. Uploaded files stay in the browser. */

import type { PdfParseOptions, PdfStatementDocument, PdfStatementParseResult, PdfTextItem } from "./pdf";
import { parsePdfStatementDocument } from "./pdf";
import type { PDFPageProxy } from "pdfjs-dist";

/** Large enough for ordinary multi-page statements, bounded for browser memory. */
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_MAX_PAGES = 250;
export const PDF_MAX_TEXT_ITEMS_PER_PAGE = 20_000;
export const PDF_MAX_TEXT_ITEMS = 300_000;
export const PDF_MAX_PROCESSING_MS = 60_000;

/**
 * Extraction limits and the processing budget are reported as typed errors so
 * callers never have to match on message text to tell them apart.
 */
export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly code: "too-large" | "too-many-pages" | "too-many-items" | "time-limit" | "password"
  ) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

export type PdfExtractionProgress = {
  phase: "opening" | "extracting" | "parsing";
  completedPages: number;
  totalPages: number;
};

export type PdfExtractionOptions = {
  signal?: AbortSignal;
  password?: string;
  requestPassword?: (reason: "required" | "incorrect") => Promise<string | null>;
  onProgress?: (progress: PdfExtractionProgress) => void;
};

export async function extractPdfStatement(
  file: File,
  options: PdfExtractionOptions = {}
): Promise<PdfStatementParseResult> {
  const startedAt = Date.now();
  if (file.size > PDF_MAX_BYTES) {
    throw new PdfExtractionError(`The PDF is larger than ${Math.round(PDF_MAX_BYTES / 1024 / 1024)} MB.`, "too-large");
  }
  throwIfAborted(options.signal);
  options.onProgress?.({ phase: "opening", completedPages: 0, totalPages: 0 });
  // PDF.js and its worker are loaded only after the user selects a PDF, keeping
  // the ordinary reconciliation screen out of the initial bundle.
  const pdfjs = await import("pdfjs-dist/webpack.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    password: options.password,
    // PDF.js would otherwise probe for eval, which the Content-Security-Policy
    // refuses; it has a non-eval path and uses it anyway when the probe fails.
    isEvalSupported: false,
  });
  const abort = () => { void loadingTask.destroy(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  let passwordCancelled = false;
  if (options.requestPassword) {
    loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      void options.requestPassword!(reason === 2 ? "incorrect" : "required").then((password) => {
        if (password === null) {
          passwordCancelled = true;
          void loadingTask.destroy();
        }
        else updatePassword(password);
      });
    };
  }
  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    if (options.signal?.aborted || passwordCancelled) throw abortError();
    if (error instanceof Error && /password/i.test(`${error.name} ${error.message}`)) {
      throw new Error("This PDF is password-protected. Enter its password to continue.");
    }
    throw error;
  }

  try {
    if (document.numPages > PDF_MAX_PAGES) {
      throw new PdfExtractionError(`The PDF has ${document.numPages} pages; the limit is ${PDF_MAX_PAGES}.`, "too-many-pages");
    }
    const pages = [];
    const pagePreviews: (string | null)[] = [];
    const failedPages: number[] = [];
    let textItemCount = 0;
    for (let index = 1; index <= document.numPages; index += 1) {
      throwIfAborted(options.signal);
      throwIfTimedOut(startedAt);
      try {
        // Each step races the remaining budget: a PDF.js call that never
        // settles used to hang the import with no way out but the tab.
        const page = await withBudget(document.getPage(index), startedAt);
        const content = await withBudget(page.getTextContent(), startedAt);
        const viewport = page.getViewport({ scale: 1 });
        const items = content.items
          .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
          .map((item, itemIndex) => ({
            id: `p${index}-i${itemIndex}`,
            str: item.str,
            transform: item.transform,
            width: "width" in item ? item.width : undefined,
            height: "height" in item ? item.height : undefined,
            dir: "dir" in item && (item.dir === "ltr" || item.dir === "rtl" || item.dir === "ttb") ? item.dir : undefined,
            fontName: "fontName" in item ? item.fontName : undefined,
            hasEOL: "hasEOL" in item ? item.hasEOL : undefined,
          } satisfies PdfTextItem));
        if (items.length > PDF_MAX_TEXT_ITEMS_PER_PAGE) {
          throw new PdfExtractionError(`PDF page ${index} contains more than ${PDF_MAX_TEXT_ITEMS_PER_PAGE.toLocaleString()} text items.`, "too-many-items");
        }
        textItemCount += items.length;
        if (textItemCount > PDF_MAX_TEXT_ITEMS) {
          throw new PdfExtractionError(`The PDF contains more than ${PDF_MAX_TEXT_ITEMS.toLocaleString()} text items.`, "too-many-items");
        }
        pages.push({
          pageNumber: index,
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
          viewportTransform: [...viewport.transform],
          items,
        });
        pagePreviews.push(await renderPdfPagePreview(page, startedAt));
        page.cleanup();
      } catch (error) {
        if (options.signal?.aborted) throw abortError();
        if (error instanceof PdfExtractionError) throw error;
        failedPages.push(index);
        pages.push({ pageNumber: index, width: 612, height: 792, items: [] });
        pagePreviews.push(null);
      }
      options.onProgress?.({ phase: "extracting", completedPages: index, totalPages: document.numPages });
    }
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: "parsing", completedPages: document.numPages, totalPages: document.numPages });
    const result = await parsePdfStatementOffMainThread({ version: 2, pages }, {}, options.signal, startedAt);
    result.document.pages.forEach((page, index) => {
      const previewDataUrl = pagePreviews[index];
      if (previewDataUrl) page.previewDataUrl = previewDataUrl;
    });
    result.metrics.unreadablePages = failedPages.length;
    if (failedPages.length) {
      result.warnings.push(`${failedPages.length} PDF ${failedPages.length === 1 ? "page could" : "pages could"} not be read. Review the remaining pages before importing.`);
      failedPages.forEach((pageNumber) => result.diagnostics.push({
        stage: "extract",
        code: "PDF_PAGE_UNREADABLE",
        pageNumber,
        metrics: { recoverable: true },
      }));
    }
    return result;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await loadingTask.destroy();
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError();
}

function abortError() {
  return new DOMException("PDF reading was cancelled.", "AbortError");
}

function throwIfTimedOut(startedAt: number) {
  if (remainingBudget(startedAt) <= 0) throw timeLimitError();
}

function remainingBudget(startedAt: number) {
  return PDF_MAX_PROCESSING_MS - (Date.now() - startedAt);
}

function timeLimitError() {
  return new PdfExtractionError(
    `PDF processing exceeded the ${PDF_MAX_PROCESSING_MS / 1000}-second time limit.`,
    "time-limit"
  );
}

function withBudget<T>(work: Promise<T>, startedAt: number): Promise<T> {
  const remaining = remainingBudget(startedAt);
  if (remaining <= 0) return Promise.reject(timeLimitError());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeLimitError()), remaining);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error as Error); }
    );
  });
}

async function renderPdfPagePreview(page: PDFPageProxy, startedAt: number) {
  // A preview is a convenience. Text extraction owns the processing budget, so
  // previews stop once most of it is gone rather than failing the import.
  if (remainingBudget(startedAt) < PDF_MAX_PROCESSING_MS * 0.25) return null;
  const canvas = globalThis.document.createElement("canvas");
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 1100 / Math.max(1, base.width), 1600 / Math.max(1, base.height));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) return null;
    await withBudget(page.render({ canvasContext, viewport }).promise, startedAt);
    return await canvasPreviewUrl(canvas);
  } catch {
    // Text extraction remains usable when a browser cannot render a preview.
    return null;
  } finally {
    // Free the backing store immediately. Browsers cap total canvas memory,
    // and a long statement would otherwise hold every rendered page.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * An object URL keeps the rendered bytes out of the JavaScript heap, where a
 * base64 data URL for every page of a long statement added up quickly. Callers
 * release them with `releasePdfStatementPreviews`.
 */
function canvasPreviewUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  if (typeof canvas.toBlob !== "function") {
    return Promise.resolve(safeDataUrl(canvas));
  }
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : safeDataUrl(canvas)),
      "image/webp",
      0.72
    );
  });
}

function safeDataUrl(canvas: HTMLCanvasElement) {
  try {
    return canvas.toDataURL("image/webp", 0.72);
  } catch {
    return null;
  }
}

/** Release rendered page previews once a parse result is no longer displayed. */
export function releasePdfStatementPreviews(result: PdfStatementParseResult | null | undefined) {
  if (!result || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  result.document.pages.forEach((page) => {
    if (page.previewDataUrl?.startsWith("blob:")) URL.revokeObjectURL(page.previewDataUrl);
    delete page.previewDataUrl;
  });
}

export function parsePdfStatementOffMainThread(
  document: PdfStatementDocument,
  options: PdfParseOptions = {},
  signal?: AbortSignal,
  startedAt = Date.now()
): PdfStatementParseResult | Promise<PdfStatementParseResult> {
  if (typeof Worker === "undefined") {
    throwIfAborted(signal);
    const result = parsePdfStatementDocument(document, options);
    throwIfTimedOut(startedAt);
    return result;
  }
  const previews = document.pages.map((page) => page.previewDataUrl ?? null);
  const parserDocument: PdfStatementDocument = {
    ...document,
    pages: document.pages.map((page) => {
      const parserPage = { ...page };
      delete parserPage.previewDataUrl;
      return parserPage;
    }),
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdfParser.worker.ts", import.meta.url), { type: "module" });
    const remainingMs = Math.max(1, PDF_MAX_PROCESSING_MS - (Date.now() - startedAt));
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error(`PDF processing exceeded the ${PDF_MAX_PROCESSING_MS / 1000}-second time limit.`));
    }, remainingMs);
    const abort = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: PdfStatementParseResult; error?: string }>) => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.result) {
        event.data.result.document.pages.forEach((page, index) => {
          const previewDataUrl = previews[index];
          if (previewDataUrl) page.previewDataUrl = previewDataUrl;
        });
        resolve(event.data.result);
      }
      else reject(new Error("The PDF parser returned no result."));
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      reject(new Error(event.message || "The PDF parser worker failed."));
    };
    worker.postMessage({ document: parserDocument, options });
  });
}
