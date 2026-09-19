import { parsePdfStatementDocument } from "./pdf";
import type { PdfParseOptions, PdfStatementDocument, PdfStatementParseResult } from "./pdf";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ document: PdfStatementDocument; options: PdfParseOptions }>) => void) | null;
  postMessage: (message: { result?: PdfStatementParseResult; error?: string }) => void;
};

workerScope.onmessage = (event: MessageEvent<{ document: PdfStatementDocument; options: PdfParseOptions }>) => {
  try {
    const result: PdfStatementParseResult = parsePdfStatementDocument(event.data.document, event.data.options);
    workerScope.postMessage({ result });
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : "The PDF parser failed.",
    });
  }
};

export {};
