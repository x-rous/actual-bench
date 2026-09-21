"use client";

import { useState } from "react";
import { generateId } from "@/lib/uuid";
import type {
  PdfCorrection,
  PdfCorrectionScope,
  PdfParserGuidance,
  PdfStatementParseResult,
} from "@/lib/reconciliation/statement/pdf";
import { parsePdfStatementOffMainThread } from "@/lib/reconciliation/statement/pdfClient";

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
    onComplete: (output: PdfStatementParseResult) => void
  ) {
    if (!parsed || isParsing) return;
    setParserError(null);
    const output = parsePdfStatementOffMainThread(parsed.document, {
      guidance: nextGuidance,
      corrections: nextCorrections,
    });
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
    setParsed(output);
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
    });
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
      setParsed(output);
      setDraftGuidance(output.guidance);
    });
  }

  function redo() {
    const nextCorrection = redoCorrections[0];
    if (!nextCorrection || !parsed || isParsing) return;
    const next = [...corrections, nextCorrection];
    rerun(parsed.guidance, next, (output) => {
      setCorrections(next);
      setRedoCorrections((current) => current.slice(1));
      setParsed(output);
      setDraftGuidance(output.guidance);
      onCorrectionsApplied?.();
    });
  }

  function updateDraft(patch: Partial<PdfParserGuidance>) {
    setDraftGuidance((current) => (current ? { ...current, ...patch } : current));
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
