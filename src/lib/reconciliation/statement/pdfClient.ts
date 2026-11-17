/** Browser-only PDF.js bridge. Uploaded files stay in the browser. */

import type { PdfParseOptions, PdfStatementDocument, PdfStatementParseResult, PdfTextItem } from "./pdf";
import { parsePdfStatementDocument } from "./pdf";
import type { PdfParserResponse } from "./pdfParser.worker";
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

/**
 * Where PDF.js finds the data it loads only when a PDF needs it, copied into
 * `public/pdfjs/` from the installed package by `scripts/copy-pdfjs-assets.mjs`.
 * Same-origin, so the page security policy already allows the requests.
 * Without character maps, a statement whose fonts use one cannot have its text
 * read; the fonts, decoders and colour profiles are for previews.
 */
export function pdfSupportAssets(origin: string) {
  // Absolute, because PDF.js may fetch them from inside its worker, where a
  // path would resolve against the worker script rather than the page.
  const at = (path: string) => new URL(path, origin).href;
  return {
    cMapUrl: at("/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: at("/pdfjs/standard_fonts/"),
    wasmUrl: at("/pdfjs/wasm/"),
    iccUrl: at("/pdfjs/iccs/"),
  };
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
    ...pdfSupportAssets(window.location.origin),
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
    // Page proxies kept for their previews, which are drawn while the parser
    // works rather than before it starts.
    const proxies: (PDFPageProxy | null)[] = [];
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
        proxies.push(page);
      } catch (error) {
        if (options.signal?.aborted) throw abortError();
        if (error instanceof PdfExtractionError) throw error;
        failedPages.push(index);
        pages.push({ pageNumber: index, width: 612, height: 792, items: [] });
        proxies.push(null);
      }
      options.onProgress?.({ phase: "extracting", completedPages: index, totalPages: document.numPages });
    }
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: "parsing", completedPages: document.numPages, totalPages: document.numPages });
    const extractedAt = Date.now();
    const parsing = Promise.resolve(parsePdfStatementOffMainThread({ version: 2, pages }, {}, options.signal, startedAt));
    // Handled below, after the previews; marked now so an early failure is not
    // reported as unhandled while they render.
    parsing.catch(() => undefined);
    // Previews render on this thread while the worker parses on its own.
    const pagePreviews: (string | null)[] = [];
    for (const proxy of proxies) {
      if (options.signal?.aborted) break;
      pagePreviews.push(proxy ? await renderPdfPagePreview(proxy, startedAt) : null);
      proxy?.cleanup();
    }
    let result: PdfStatementParseResult;
    try {
      result = await parsing;
      // A parse that finished while previews rendered still belongs to a read
      // the user cancelled; returning it would replace the current draft.
      throwIfAborted(options.signal);
    } catch (error) {
      for (const url of pagePreviews) if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      throw error;
    }
    result.extraction = {
      pdfjsVersion: pdfjs.version,
      extractMs: extractedAt - startedAt,
      parseMs: Date.now() - extractedAt,
      unreadablePages: failedPages,
    };
    result.document.pages.forEach((page, index) => {
      const previewDataUrl = pagePreviews[index];
      if (previewDataUrl) page.previewDataUrl = previewDataUrl;
    });
    result.metrics.unreadablePages = failedPages.length;
    if (failedPages.length) {
      const message = `${failedPages.length} PDF ${failedPages.length === 1 ? "page could" : "pages could"} not be read. Review the remaining pages before importing.`;
      result.warnings.push(message);
      result.notices.push({ code: "UNREADABLE_PAGES", kind: "note", message, pageNumbers: failedPages });
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
    await withBudget(page.render({ canvas, canvasContext, viewport }).promise, startedAt);
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

type PendingParse = {
  document: PdfStatementDocument;
  documentId: string;
  options: PdfParseOptions;
  resolve: (result: PdfStatementParseResult) => void;
  reject: (error: Error) => void;
  /** Set once the document has been resent after a worker restart. */
  resent: boolean;
};

let parserWorker: Worker | null = null;
let heldDocumentId: string | null = null;
let nextRequestId = 1;
let nextDocumentId = 1;
const pendingParses = new Map<number, PendingParse>();
const documentIds = new WeakMap<PdfStatementDocument, string>();

function documentIdFor(document: PdfStatementDocument): string {
  let id = documentIds.get(document);
  if (!id) {
    id = `pdf-${nextDocumentId++}`;
    documentIds.set(document, id);
  }
  return id;
}

/** The document as the parser sees it: page previews are display-only. */
function parserCopy(document: PdfStatementDocument): PdfStatementDocument {
  return {
    ...document,
    pages: document.pages.map((page) => {
      const parserPage = { ...page };
      delete parserPage.previewDataUrl;
      return parserPage;
    }),
  };
}

function stopParserWorker(reason: Error | null) {
  parserWorker?.terminate();
  parserWorker = null;
  heldDocumentId = null;
  if (reason) {
    for (const pending of pendingParses.values()) pending.reject(reason);
    pendingParses.clear();
  }
}

function sendParse(requestId: number, pending: PendingParse, includeDocument: boolean) {
  const worker = parserWorkerInstance();
  worker.postMessage({
    requestId,
    documentId: pending.documentId,
    options: pending.options,
    ...(includeDocument ? { document: parserCopy(pending.document) } : {}),
  });
  if (includeDocument) heldDocumentId = pending.documentId;
}

function parserWorkerInstance(): Worker {
  if (parserWorker) return parserWorker;
  const worker = new Worker(new URL("./pdfParser.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<PdfParserResponse>) => {
    const { requestId, result, error, missingDocument } = event.data;
    const pending = pendingParses.get(requestId);
    if (!pending) return;
    if (missingDocument && !pending.resent) {
      pending.resent = true;
      sendParse(requestId, pending, true);
      return;
    }
    pendingParses.delete(requestId);
    if (error) pending.reject(new Error(error));
    else if (result) pending.resolve({ ...result, document: pending.document } as PdfStatementParseResult);
    else pending.reject(new Error("The PDF parser returned no result."));
  };
  worker.onerror = (event) => {
    stopParserWorker(new Error(event.message || "The PDF parser worker failed."));
  };
  parserWorker = worker;
  return worker;
}

/**
 * Parse a statement off the main thread.
 *
 * The result's `document` is the very object passed in, so its page previews
 * stay attached without being copied to the worker and back.
 */
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
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;
    const documentId = documentIdFor(document);
    const remainingMs = Math.max(1, PDF_MAX_PROCESSING_MS - (Date.now() - startedAt));
    const settle = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const timeout = window.setTimeout(() => {
      // A parse that overran is still running in the worker; only a restart stops it.
      pendingParses.delete(requestId);
      stopParserWorker(null);
      reject(new Error(`PDF processing exceeded the ${PDF_MAX_PROCESSING_MS / 1000}-second time limit.`));
      for (const [id, other] of pendingParses) {
        pendingParses.delete(id);
        other.reject(new Error("The PDF parser was restarted. Try again."));
      }
    }, remainingMs);
    const abort = () => {
      settle();
      pendingParses.delete(requestId);
      // Nothing else waiting on the worker: stop the abandoned parse outright.
      if (pendingParses.size === 0) stopParserWorker(null);
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    const pending: PendingParse = {
      document,
      documentId,
      options,
      resent: false,
      resolve: (result) => { settle(); resolve(result); },
      reject: (error) => { settle(); reject(error); },
    };
    pendingParses.set(requestId, pending);
    sendParse(requestId, pending, heldDocumentId !== documentId);
  });
}
