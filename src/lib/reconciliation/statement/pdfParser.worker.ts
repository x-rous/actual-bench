import { parsePdfStatementDocument } from "./pdf";
import type { PdfParseOptions, PdfStatementDocument, PdfStatementParseResult } from "./pdf";

/**
 * The PDF parser, off the main thread.
 *
 * Kept alive between parses and holding the last document it was sent: every
 * correction in the review dialog re-parses the same statement, and sending the
 * whole document in (and the whole document back) for each one was most of the
 * cost on a long statement. The client sends the document only when it is not
 * the one held here, and the result comes back without it — the client already
 * has it.
 */
export type PdfParserRequest = {
  requestId: number;
  documentId: string;
  /** Omitted when the worker already holds `documentId`. */
  document?: PdfStatementDocument;
  options: PdfParseOptions;
};

export type PdfParserResponse = {
  requestId: number;
  /** `document` is omitted from the result; the client reattaches its own. */
  result?: Omit<PdfStatementParseResult, "document">;
  error?: string;
  /** The worker does not hold `documentId` (it was restarted); resend it. */
  missingDocument?: boolean;
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PdfParserRequest>) => void) | null;
  postMessage: (message: PdfParserResponse) => void;
};

let held: { id: string; document: PdfStatementDocument } | null = null;

workerScope.onmessage = (event: MessageEvent<PdfParserRequest>) => {
  const { requestId, documentId, document, options } = event.data;
  if (document) held = { id: documentId, document };
  if (!held || held.id !== documentId) {
    workerScope.postMessage({ requestId, missingDocument: true });
    return;
  }
  try {
    const parsed: Partial<PdfStatementParseResult> = parsePdfStatementDocument(held.document, options);
    delete parsed.document;
    workerScope.postMessage({ requestId, result: parsed as Omit<PdfStatementParseResult, "document"> });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : "The PDF parser failed.",
    });
  }
};

export {};
