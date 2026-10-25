"use client";

import { useState } from "react";
import { generateId } from "@/lib/uuid";
import type {
  PdfCorrection,
  PdfCorrectionScope,
  PdfParserGuidance,
  PdfStatementParseResult,
} from "@/lib/reconciliation/statement/pdf";
import { parsePdfStatementDocument } from "@/lib/reconciliation/statement/pdf";
import { parsePdfStatementOffMainThread } from "@/lib/reconciliation/statement/pdfClient";

/**
 * A statement this small is re-read on the page itself after a correction.
 * Starting a worker means loading the parser again and copying the whole
 * document across and the whole result back, which cost more than reading
 * a statement of this size; a long one is still worth keeping off the page.
 */
const INLINE_PARSE_MAX_TEXT_ITEMS = 30_000;

/**
 * The new result, sharing every transaction and block with the previous one
 * that came out the same. A correction re-reads the whole statement, but it
 * changes a row or two; handing the table the same objects for the rest is
 * what lets it skip them.
 */
function sharingUnchangedRows(
  previous: PdfStatementParseResult | null,
  next: PdfStatementParseResult
): PdfStatementParseResult {
  if (!previous) return next;
  const reuse = <T extends { id: string }>(before: T[], after: T[]) => {
    const known = new Map(before.map((entry) => [entry.id, [entry, JSON.stringify(entry)] as const]));
    return after.map((entry) => {
      const match = known.get(entry.id);
      return match && match[1] === JSON.stringify(entry) ? match[0] : entry;
    });
  };
  return {
    ...next,
    transactions: reuse(previous.transactions, next.transactions),
    blocks: reuse(previous.blocks, next.blocks),
  };
}

export type PdfCorrectionInput = PdfCorrection extends infer Correction
  ? Correction extends PdfCorrection
    ? Omit<Correction, "id" | "createdAt" | "scope">
    : never
  : never;

/**
 * The statement being worked on, and everything that re-reads it.
 *
 * Every correction and every detection change is the same move: hand the
 * parser the document again with a different set of instructions, and take the
 * whole result back. Nothing is patched in place, so what the reviewer sees is
 * always something the parser actually produced - which is why undo is a list
 * of corrections rather than a list of undo handlers.
 *
 * The preview lives here too: it is the same re-run, kept to one side instead
 * of adopted, so the reviewer can see what a change would do before it becomes
 * what they are looking at.
 */
export function usePdfStatementWorkbench(
  result: PdfStatementParseResult | null,
  /**
   * Called whenever a correction lands. Rows are re-assembled on every re-run,
   * so anything holding row ids - a selection, an offer to repeat a correction -
   * is about rows that may no longer exist.
   */
  onCorrectionsApplied?: () => void
) {
  const [parsed, setParsed] = useState(result);
  const [draftGuidance, setDraftGuidance] = useState<PdfParserGuidance | null>(result?.guidance ?? null);
  const [corrections, setCorrections] = useState<PdfCorrection[]>([]);
  const [redoCorrections, setRedoCorrections] = useState<PdfCorrection[]>([]);
  const [preview, setPreview] = useState<PdfStatementParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parserError, setParserError] = useState<string | null>(null);

  function rerun(
    nextGuidance: PdfParserGuidance,
    nextCorrections: PdfCorrection[],
    onComplete: (output: PdfStatementParseResult) => void,
    /** A correction to rows, which a small statement takes on this thread. */
    inline = false
  ) {
    if (!parsed || isParsing) return;
    setParserError(null);
    let output: PdfStatementParseResult | Promise<PdfStatementParseResult>;
    try {
      const options = { guidance: nextGuidance, corrections: nextCorrections };
      const textItems = parsed.document.pages.reduce((total, entry) => total + entry.items.length, 0);
      output = inline && textItems <= INLINE_PARSE_MAX_TEXT_ITEMS
        ? parsePdfStatementDocument(parsed.document, options)
        : parsePdfStatementOffMainThread(parsed.document, options);
    } catch (error: unknown) {
      // Where there is no Worker the parser runs here and throws here, so this
      // failure arrives as an exception rather than a rejected promise. Left
      // uncaught it escapes the click handler having just cleared the last
      // error, and the workbench reports nothing at all.
      setParserError(error instanceof Error ? error.message : "The PDF parser could not re-run.");
      return;
    }
    // A synchronous result means the parser ran on this thread, and making it
    // async here would flash a busy state for work that is already done.
    if (!(output instanceof Promise)) {
      onComplete(output);
      return;
    }
    setIsParsing(true);
    void output
      .then(onComplete)
      .catch((error: unknown) => {
        setParserError(error instanceof Error ? error.message : "The PDF parser could not re-run.");
      })
      .finally(() => setIsParsing(false));
  }

  function adopt(output: PdfStatementParseResult) {
    setParsed(sharingUnchangedRows(parsed, output));
    setDraftGuidance(output.guidance);
    setPreview(null);
  }

  function applyCorrections(additions: PdfCorrection[]) {
    if (!parsed || isParsing) return;
    const next = [...corrections, ...additions];
    rerun(parsed.guidance, next, (output) => {
      setCorrections(next);
      setRedoCorrections([]);
      adopt(output);
      onCorrectionsApplied?.();
    }, true);
  }

  function structuralCorrections(items: PdfCorrectionInput[], scope: PdfCorrectionScope = "row") {
    const createdAt = new Date().toISOString();
    applyCorrections(items.map((correction) => ({ ...correction, id: generateId(), createdAt, scope } as PdfCorrection)));
  }

  function structuralCorrection(correction: PdfCorrectionInput, scope: PdfCorrectionScope = "row") {
    structuralCorrections([correction], scope);
  }

  function undo() {
    if (!parsed || corrections.length === 0 || isParsing) return;
    const removed = corrections.at(-1)!;
    const next = corrections.slice(0, -1);
    rerun(parsed.guidance, next, (output) => {
      setRedoCorrections((current) => [removed, ...current]);
      setCorrections(next);
      setParsed(sharingUnchangedRows(parsed, output));
      setDraftGuidance(output.guidance);
      // Undoing re-assembles the blocks just as applying does, so a row the
      // caller had selected may no longer exist. Same reason as the other two.
      onCorrectionsApplied?.();
    }, true);
  }

  function redo() {
    const nextCorrection = redoCorrections[0];
    if (!nextCorrection || !parsed || isParsing) return;
    const next = [...corrections, nextCorrection];
    rerun(parsed.guidance, next, (output) => {
      setCorrections(next);
      setRedoCorrections((current) => current.slice(1));
      setParsed(sharingUnchangedRows(parsed, output));
      setDraftGuidance(output.guidance);
      onCorrectionsApplied?.();
    }, true);
  }

  /**
   * A patch, or a function of what the draft is now.
   *
   * The function form matters when one gesture makes two changes - moving a
   * column and then putting the list back in order - because both would
   * otherwise read the same state and the second would undo the first.
   */
  function updateDraft(
    patch: Partial<PdfParserGuidance> | ((current: PdfParserGuidance) => Partial<PdfParserGuidance>)
  ) {
    setDraftGuidance((current) => {
      if (!current) return current;
      return { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    });
    setPreview(null);
  }

  function previewDetection() {
    if (!draftGuidance || isParsing) return;
    rerun(draftGuidance, corrections, setPreview);
  }

  /** Re-read the statement with a different set of instructions entirely. */
  function applyGuidance(guidance: PdfParserGuidance, onApplied?: (output: PdfStatementParseResult) => void) {
    rerun(guidance, corrections, (output) => {
      adopt(output);
      onApplied?.(output);
    });
  }

  return {
    parsed,
    draftGuidance,
    corrections,
    preview,
    isParsing,
    parserError,
    canUndo: corrections.length > 0,
    canRedo: redoCorrections.length > 0,
    setParsed,
    setDraftGuidance,
    setPreview,
    setParserError,
    adopt,
    applyCorrections,
    structuralCorrection,
    structuralCorrections,
    undo,
    redo,
    updateDraft,
    previewDetection,
    applyGuidance,
  };
}
