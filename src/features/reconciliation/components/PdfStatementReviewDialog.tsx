"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  CircleHelp,
  GitMerge,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { generateId } from "@/lib/uuid";
import { columnBoundsForPage } from "@/lib/reconciliation/statement/pdf/columns";
import {
  columnExamplesForRegions,
  guidanceFromPdfLayoutProfile,
  matchPdfLayoutProfile,
  type PdfColumn,
  type PdfConfidenceReason,
  type PdfLayoutProfile,
  type PdfParserGuidance,
  type PdfStatementParseResult,
  type PdfTransactionProposal,
} from "@/lib/reconciliation/statement/pdf";
import { usePdfStatementWorkbench, type PdfCorrectionInput } from "../hooks/usePdfStatementWorkbench";
import { formatMinorUnits } from "../lib/format";
import { isActionableReason, reasonText } from "../lib/pdfReasonText";
import {
  csvFileNameFor,
  formatTableAmount,
  matchesCategory,
  matchesSearch,
  newColumnBounds,
  nextSortState,
  normalizeTableAmountInput,
  pageForSourceIds,
  resultDiff,
  sortTransactions,
  transactionTotals,
  type PdfReviewCategory,
  type PdfSortState,
} from "../lib/pdfReviewTable";
import { PDF_DEFAULT_ZOOM, PdfSourcePreview } from "./PdfSourcePreview";
import { PdfDetectionProfileManagerDialog } from "./PdfDetectionProfileManagerDialog";
import { PdfDetectionStep } from "./PdfDetectionStep";
import { PdfDiagnosticsSheet } from "./PdfDiagnosticsSheet";
import { PdfPageControls } from "./PdfPageControls";
import { PdfReviewStep } from "./PdfReviewStep";
import { PdfLayoutSaveDialog, type PdfLayoutSaveRequest } from "./PdfStatementLayoutPanel";
import type { PdfDetectionIssue } from "./PdfDetectionIssueList";
import type { PdfTransactionField } from "./PdfTransactionTable";
import type { PdfDetectionBankRecord } from "../lib/reconciliationApi";

type WorkbenchMode = "review" | "adjust";

type ScopedCorrectionOffer = {
  label: string;
  similarIds: string[];
  remainingIds: string[];
  build: (transactionIds: string[]) => PdfCorrectionInput[];
};

/**
 * Warnings that a bulk "mark reviewed" would clear without resolving. They are
 * named in a confirmation so accepting them stays a decision, not a reflex.
 */
const UNRESOLVED_REVIEW_REASONS: PdfConfidenceReason[] = [
  "POSSIBLE_DUPLICATE",
  "BALANCE_MISMATCH",
  "STATEMENT_SUMMARY_MISMATCH",
  "DATE_OUTSIDE_STATEMENT_PERIOD",
  "DATE_AMBIGUOUS_ORDER",
  "SIGN_CONVENTION_UNCONFIRMED",
  "ACCOUNT_TYPE_UNCONFIRMED",
];

const NOOP = () => {};

export type PdfDetectionProfileOption = {
  recordId: string;
  bankId: string;
  bankName: string;
  envelope: { kind: "pdf-layout-v2"; profile: PdfLayoutProfile; history?: PdfLayoutProfile[] };
};

export function PdfStatementReviewDialog({
  fileName,
  result,
  profiles = [],
  activeProfileId = null,
  profileNotice = null,
  open,
  onOpenChange,
  onImport,
  onSaveProfile,
  onProfileChange,
  accountName = "this account",
  banks = [],
  accountProfileId = null,
  onAssignProfile,
  onRemoveAccountAssignment,
  onRenameBank,
  onRenameProfile,
  onDeleteProfile,
  isSavingProfile = false,
}: {
  fileName: string;
  result: PdfStatementParseResult | null;
  profiles?: PdfDetectionProfileOption[];
  activeProfileId?: string | null;
  profileNotice?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: PdfTransactionProposal[], result: PdfStatementParseResult) => void;
  onSaveProfile?: (input: PdfLayoutSaveRequest & {
    result: PdfStatementParseResult;
  }) => Promise<{ bankId: string; profileId: string } | void>;
  onProfileChange?: (profile: PdfDetectionProfileOption | null) => void;
  accountName?: string;
  banks?: PdfDetectionBankRecord[];
  accountProfileId?: string | null;
  onAssignProfile?: (profileId: string) => Promise<unknown>;
  onRemoveAccountAssignment?: () => Promise<unknown>;
  onRenameBank?: (bankId: string, name: string) => Promise<unknown>;
  onRenameProfile?: (profileId: string, name: string) => Promise<unknown>;
  onDeleteProfile?: (profileId: string) => Promise<unknown>;
  isSavingProfile?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const workbench = usePdfStatementWorkbench(result, () => setSelectedIds(new Set()));
  const {
    parsed,
    draftGuidance,
    preview,
    isParsing,
    parserError,
    setParserError,
    setPreview,
    adopt,
    structuralCorrection,
    structuralCorrections,
    undo,
    redo,
    updateDraft,
    previewDetection,
    applyGuidance,
    setDraftGuidance,
  } = workbench;

  const [mode, setMode] = useState<WorkbenchMode>(() => initialModeForResult(result, Boolean(profileNotice)));
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [filter, setFilter] = useState<PdfReviewCategory>(() => initialReviewFilter(result));
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PdfSortState>(null);
  const [scopedCorrectionOffer, setScopedCorrectionOffer] = useState<ScopedCorrectionOffer | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [highlightedSourceIds, setHighlightedSourceIds] = useState<Set<string>>(new Set());
  const [selectedSourceRowId, setSelectedSourceRowId] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [drawingRegion, setDrawingRegion] = useState(false);
  const [showColumnMappings, setShowColumnMappings] = useState(true);
  const [pdfZoom, setPdfZoom] = useState(PDF_DEFAULT_ZOOM);
  const [columnFocusRequest, setColumnFocusRequest] = useState<{ columnId: string; requestId: number } | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(activeProfileId);
  const [manageProfilesOpen, setManageProfilesOpen] = useState(false);
  const [saveProfileOpen, setSaveProfileOpen] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const [controlFocus, setControlFocus] = useState<{ id: string; requestId: number } | null>(null);
  const [interpretationOpen, setInterpretationOpen] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pageWarningsAcknowledged, setPageWarningsAcknowledged] = useState(false);

  const rows = useMemo(() => parsed?.transactions ?? [], [parsed]);
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesCategory(row, filter) && matchesSearch(row, search)),
    [filter, rows, search]
  );
  const sortedRows = useMemo(() => sortTransactions(visibleRows, sort), [sort, visibleRows]);
  const tableRows = useMemo(
    () => sortedRows.map((row) => ({ ...row, amount: formatTableAmount(row.amount) })),
    [sortedRows]
  );
  const visibleIds = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const selectedReviewIds = selectedRows.filter((row) => row.status === "review").map((row) => row.id);
  const selectedHasRejected = selectedRows.some((row) => row.status === "rejected");
  const blockingCount = rows.filter((row) => row.status === "rejected").length;
  const reviewCount = rows.filter((row) => row.status === "review").length;
  const totals = useMemo(() => transactionTotals(rows), [rows]);
  const page = parsed?.reconstructedPages.find((entry) => entry.pageNumber === pageNumber)
    ?? parsed?.reconstructedPages[0]
    ?? null;
  const pagePreviewDataUrl = parsed?.document.pages
    .find((entry) => entry.pageNumber === page?.pageNumber)?.previewDataUrl ?? null;
  const pageRegions = useMemo(
    () => parsed?.regions.filter((region) => region.pageNumber === page?.pageNumber) ?? [],
    [page?.pageNumber, parsed?.regions]
  );
  const selectedProfile = profiles.find((profile) => profile.recordId === selectedProfileId) ?? null;
  const previewDiff = useMemo(
    () => (parsed && preview ? resultDiff(parsed, preview) : null),
    [parsed, preview]
  );
  const detectionDirty = useMemo(
    () => (parsed ? JSON.stringify(draftGuidance) !== JSON.stringify(parsed.guidance) : false),
    [draftGuidance, parsed]
  );
  const draftColumnExamples = useMemo(() => new Map(
    (draftGuidance?.columns ?? []).map((column) => [
      column.id,
      parsed ? columnExamplesForRegions(parsed.reconstructedPages, draftGuidance?.regions ?? [], column) : [],
    ])
  ), [draftGuidance?.columns, draftGuidance?.regions, parsed]);
  const detectionIssues = useMemo(
    () => detectionIssuesFor(parsed, draftGuidance),
    [draftGuidance, parsed]
  );
  const parserDetailCount = useMemo(
    () => new Set([...detectionIssues.map((issue) => issue.message), ...(parsed?.warnings ?? [])]).size,
    [detectionIssues, parsed?.warnings]
  );

  // Pages the parser could not read are missing transactions, not a detail in
  // a secondary view: import stays disabled until they are acknowledged.
  const unreadablePageCount = (parsed?.metrics.unreadablePages ?? 0) + (parsed?.metrics.imageOnlyPages ?? 0);
  const pageWarnings = useMemo(
    () => (parsed?.warnings ?? []).filter((warning) => /readable text layer|could not be read/.test(warning)),
    [parsed?.warnings]
  );
  const importBlockedByPages = unreadablePageCount > 0 && !pageWarningsAcknowledged;

  useEffect(() => {
    if (filter !== "all" && !rows.some((row) => matchesCategory(row, filter))) setFilter("all");
  }, [filter, rows]);

  useEffect(() => {
    setPdfZoom(PDF_DEFAULT_ZOOM);
    setColumnFocusRequest(null);
  }, [fileName, result?.document]);

  function resolveIssue(issue: PdfDetectionIssue) {
    setScopedCorrectionOffer(null);
    setDiagnosticsOpen(false);
    setMode("adjust");
    if (!issue.focus) return;
    setInterpretationOpen(true);
    setControlFocus((current) => ({ id: issue.focus!, requestId: (current?.requestId ?? 0) + 1 }));
  }

  function similarTargetIds(row: PdfTransactionProposal) {
    const reasons = new Set(row.issueCodes.filter(isActionableReason));
    if (!reasons.size) return [];
    return rows
      .filter((entry) => entry.issueCodes.some((reason) => isActionableReason(reason) && reasons.has(reason)))
      .map((entry) => entry.id);
  }

  function offerBroaderCorrection(
    row: PdfTransactionProposal,
    label: string,
    build: ScopedCorrectionOffer["build"]
  ) {
    const similarIds = similarTargetIds(row).filter((id) => id !== row.id);
    const remainingIds = rows.map((entry) => entry.id).filter((id) => id !== row.id && !similarIds.includes(id));
    setScopedCorrectionOffer(similarIds.length || remainingIds.length ? { label, similarIds, remainingIds, build } : null);
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function setDirection(row: PdfTransactionProposal, direction: "debit" | "credit") {
    structuralCorrection({ kind: "set-direction", transactionIds: [row.id], direction });
    offerBroaderCorrection(row, direction === "debit" ? "Money out" : "Money in", (transactionIds) => [
      { kind: "set-direction", transactionIds, direction },
    ]);
  }

  function setField(row: PdfTransactionProposal, field: PdfTransactionField, value: string | null) {
    const edits: PdfCorrectionInput[] = [{ kind: "set-field", transactionIds: [row.id], field, value }];
    const selectedImportField = parsed?.guidance.importDate === "transaction"
      ? "transactionDate"
      : parsed?.guidance.importDate === "posting"
        ? "postedDate"
        : "valueDate";
    if (field === selectedImportField) {
      edits.push({ kind: "set-field", transactionIds: [row.id], field: "importDate", value });
    }
    structuralCorrections(edits);
    if (["description", "amount", "currency"].includes(field)) {
      const label = field === "description" ? "Description" : field === "amount" ? "Amount" : "Currency";
      offerBroaderCorrection(row, label, (transactionIds) => [{ kind: "set-field", transactionIds, field, value }]);
    } else {
      setScopedCorrectionOffer(null);
    }
  }

  function acceptSelectedRows() {
    if (!selectedReviewIds.length) return;
    const counts = new Map<PdfConfidenceReason, number>();
    rows
      .filter((row) => selectedReviewIds.includes(row.id))
      .forEach((row) => row.issueCodes
        .filter((reason) => UNRESOLVED_REVIEW_REASONS.includes(reason))
        .forEach((reason) => counts.set(reason, (counts.get(reason) ?? 0) + 1)));
    const accept = () => structuralCorrection({ kind: "accept-transaction", transactionIds: selectedReviewIds });
    if (counts.size === 0) {
      accept();
      return;
    }
    setConfirm({
      title: `Mark ${selectedReviewIds.length} ${selectedReviewIds.length === 1 ? "transaction" : "transactions"} reviewed?`,
      destructive: false,
      destructiveLabel: "Mark reviewed anyway",
      // The confirmation renders inside the dialog description, which is a
      // paragraph, so the breakdown uses block spans rather than a list.
      message: (
        <span className="block">
          This accepts warnings that are still unresolved:
          {[...counts.entries()].map(([reason, count]) => (
            <span key={reason} className="mt-1 block">• {count} × {reasonText([reason])}</span>
          ))}
        </span>
      ),
      onConfirm: accept,
    });
  }

  function showSource(row: PdfTransactionProposal, field: keyof PdfTransactionProposal["confidence"]) {
    const confidence = row.confidence[field];
    const sourceIds = Array.isArray(confidence)
      ? confidence.flatMap((entry) => entry.sourceIds)
      : confidence?.sourceIds ?? row.raw.sourceIds;
    setHighlightedSourceIds(new Set(sourceIds));
    // The preview selects reconstructed rows, so highlight the block's own
    // anchor row rather than the transaction id, which belongs to no row.
    setSelectedSourceRowId(parsed?.blocks.find((block) => block.id === row.id)?.rowIds[0] ?? null);
    setPageNumber(pageForSourceIds(parsed, sourceIds, row.raw.pageNumber));
    setSourceOpen(true);
  }

  function focusMappedColumn(column: PdfColumn) {
    if (column.pageNumber !== null) setPageNumber(column.pageNumber);
    setColumnFocusRequest((current) => ({ columnId: column.id, requestId: (current?.requestId ?? 0) + 1 }));
  }

  function applyDetection() {
    if (!draftGuidance || !parsed || !preview || isParsing) return;
    const output = preview;
    const diff = resultDiff(parsed, output);
    adopt(output);
    setMode("review");
    setFilter(output.metrics.review + output.metrics.rejected > 0 ? "needs-review" : "all");
    clearSelection();
    // Applying moves to the review step, so the chance to keep these settings
    // travels with the confirmation rather than being left behind on the
    // detection screen.
    if (selectedProfile) {
      setLayoutNotice(`These settings differ from ${selectedProfile.envelope.profile.name}. Save the layout to reuse them next month.`);
    }
    toast.success("Detection changes applied", {
      description: `${diff.after} ${diff.after === 1 ? "transaction" : "transactions"} found · ${diff.afterReview} ${diff.afterReview === 1 ? "needs" : "need"} review`,
      ...(onSaveProfile && output.metrics.rejected === 0
        ? { action: { label: "Save layout", onClick: () => setSaveProfileOpen(true) } }
        : {}),
    });
  }

  function resetDetection() {
    if (!parsed) return;
    setDraftGuidance(parsed.detectedGuidance);
    setPreview(null);
    setLayoutNotice(null);
  }

  function updateColumn(id: string, patch: Partial<PdfColumn>) {
    if (!draftGuidance) return;
    updateDraft({ columns: draftGuidance.columns.map((column) => (column.id === id ? { ...column, ...patch } : column)) });
  }

  function addColumn() {
    if (!draftGuidance || !page) return;
    const bounds = newColumnBounds(draftGuidance.columns, page.pageNumber, page.width);
    updateDraft({
      columns: [...draftGuidance.columns, {
        id: generateId(),
        pageNumber: null,
        referencePageWidth: page.width,
        ...bounds,
        role: "ignore",
        header: null,
        examples: [],
        confidence: 1,
      }],
    });
  }

  /**
   * Swap two mappings, and the parts of the page they describe with them. The
   * list is the page read left to right, so reordering it without moving the
   * columns would leave the two disagreeing.
   */
  function moveColumn(id: string, offset: -1 | 1) {
    if (!draftGuidance || !page) return;
    const currentIndex = draftGuidance.columns.findIndex((column) => column.id === id);
    const adjacentIndex = currentIndex + offset;
    if (currentIndex < 0 || adjacentIndex < 0 || adjacentIndex >= draftGuidance.columns.length) return;

    const current = draftGuidance.columns[currentIndex];
    const adjacent = draftGuidance.columns[adjacentIndex];
    const currentBounds = columnBoundsForPage(current, page.width);
    const adjacentBounds = columnBoundsForPage(adjacent, page.width);
    const leftBounds = offset < 0 ? adjacentBounds : currentBounds;
    const rightBounds = offset < 0 ? currentBounds : adjacentBounds;
    const gap = Math.max(0, rightBounds.xStart - leftBounds.xEnd);
    const spanStart = leftBounds.xStart;
    const currentWidth = Math.max(1, currentBounds.xEnd - currentBounds.xStart);
    const adjacentWidth = Math.max(1, adjacentBounds.xEnd - adjacentBounds.xStart);
    const currentNext = offset < 0
      ? { xStart: spanStart, xEnd: spanStart + currentWidth }
      : { xStart: spanStart + adjacentWidth + gap, xEnd: spanStart + adjacentWidth + gap + currentWidth };
    const adjacentNext = offset < 0
      ? { xStart: spanStart + currentWidth + gap, xEnd: spanStart + currentWidth + gap + adjacentWidth }
      : { xStart: spanStart, xEnd: spanStart + adjacentWidth };
    const nextColumns = [...draftGuidance.columns];
    nextColumns[currentIndex] = { ...current, ...currentNext, referencePageWidth: page.width };
    nextColumns[adjacentIndex] = { ...adjacent, ...adjacentNext, referencePageWidth: page.width };
    [nextColumns[currentIndex], nextColumns[adjacentIndex]] = [nextColumns[adjacentIndex], nextColumns[currentIndex]];
    updateDraft({ columns: nextColumns });
  }

  function applyProfile(option: PdfDetectionProfileOption, profile: PdfLayoutProfile = option.envelope.profile) {
    if (!parsed || isParsing) return;
    const profileMatch = matchPdfLayoutProfile(profile, parsed.reconstructedPages, parsed.activeSchema);
    if (profileMatch.outcome === "conflicting") {
      setParserError("That layout conflicts with the detected table. Adjust the mapping or choose another layout.");
      return;
    }
    applyGuidance(guidanceFromPdfLayoutProfile(profile, parsed), () => {
      setSelectedProfileId(option.recordId);
      setLayoutNotice(null);
      onProfileChange?.(option);
    });
  }

  function selectProfile(recordId: string) {
    if (!recordId) {
      if (!parsed || isParsing) return;
      applyGuidance(parsed.detectedGuidance, () => {
        setSelectedProfileId(null);
        onProfileChange?.(null);
      });
      return;
    }
    const option = profiles.find((profile) => profile.recordId === recordId);
    if (option) applyProfile(option);
  }

  async function assignSelectedProfile() {
    if (!selectedProfile || !onAssignProfile) return;
    try {
      await onAssignProfile(selectedProfile.recordId);
      toast.success("Account statement layout updated", {
        description: `${selectedProfile.bankName} · ${selectedProfile.envelope.profile.name}`,
      });
    } catch (error) {
      setParserError(error instanceof Error ? error.message : "The account statement layout could not be updated.");
    }
  }

  /**
   * Export what the screen currently shows: the same rows, in the same order,
   * carrying the corrections made so far. A filtered view exports the filtered
   * rows, because that is what the reader is looking at.
   */
  function exportVisibleRows() {
    if (!parsed || sortedRows.length === 0) return;
    const showPosting = parsed.guidance.columns.some((column) => column.role === "posting-date")
      || sortedRows.some((row) => row.postedDate);
    const showValue = parsed.guidance.columns.some((column) => column.role === "value-date")
      || sortedRows.some((row) => row.valueDate);
    const showBalance = sortedRows.some((row) => row.balance);
    const header = [
      "Statement row",
      "Status",
      "Transaction date",
      ...(showPosting ? ["Posting date"] : []),
      ...(showValue ? ["Value date"] : []),
      "Import date",
      "Description",
      "Reference",
      "Amount",
      "Currency",
      ...(showBalance ? ["Balance"] : []),
      "Page",
      "Notes",
    ];
    const body = sortedRows.map((row) => [
      row.sourceRowNumber,
      row.status === "accepted" ? "Ready" : row.status === "rejected" ? "Fix" : "Review",
      row.transactionDate ?? "",
      ...(showPosting ? [row.postedDate ?? ""] : []),
      ...(showValue ? [row.valueDate ?? ""] : []),
      row.importDate ?? "",
      row.description,
      row.reference ?? "",
      row.amount,
      row.currency ?? "",
      ...(showBalance ? [row.balance ?? ""] : []),
      row.raw.pageNumber,
      row.status === "accepted" ? "" : reasonText(row.issueCodes),
    ]);
    downloadCsv(csvFileNameFor(fileName), [header, ...body]);
    toast.success(`Exported ${sortedRows.length} ${sortedRows.length === 1 ? "transaction" : "transactions"}`);
  }

  function copyDiagnostics() {
    const payload = JSON.stringify({
      modelVersion: parsed?.modelVersion,
      metrics: parsed?.metrics,
      accountType: parsed?.accountType,
      balanceBehavior: parsed?.balanceBehavior,
      warnings: parsed?.warnings,
      diagnostics: parsed?.diagnostics.map(({ stage, code, pageNumber: diagnosticPage, metrics }) => ({
        stage,
        code,
        pageNumber: diagnosticPage,
        metrics,
      })),
    }, null, 2);
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard access is unavailable");
      return;
    }
    void navigator.clipboard.writeText(payload)
      .then(() => toast.success("Parser diagnostics copied"))
      .catch(() => toast.error("Could not copy parser diagnostics"));
  }

  if (!parsed || !draftGuidance) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" aria-busy={isParsing}>
        <DialogHeader className="shrink-0 border-b px-4 py-2.5 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            <DialogTitle>Review PDF statement</DialogTitle>
            <DialogDescription className="min-w-0 flex-1 truncate" title={fileName}>{fileName}</DialogDescription>
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
              title="The PDF is processed locally in your browser and is not uploaded."
            >
              <ShieldCheck aria-hidden="true" className="size-3.5" />Local only
            </span>
          </div>
        </DialogHeader>

        {parsed.likelyScanned ? (
          <div role="alert" className="m-5 rounded-md border border-amber-500/50 bg-amber-500/5 p-4 text-sm">
            <p className="font-medium">This PDF does not have a usable text layer.</p>
            <p className="mt-1 text-muted-foreground">Use a text-based PDF, CSV, OFX, or QIF. Actual Bench did not upload or save this file.</p>
          </div>
        ) : (
          <>
            <div className="shrink-0 border-b bg-muted/10">
              <div className="flex items-center gap-2 px-4 py-1.5">
                <nav className="flex shrink-0 items-center gap-1" aria-label="PDF import steps">
                  <WorkflowStepButton
                    step={1}
                    active={mode === "adjust"}
                    label="Check detection"
                    onClick={() => { setScopedCorrectionOffer(null); setMode("adjust"); }}
                  />
                  <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  <WorkflowStepButton
                    step={2}
                    active={mode === "review"}
                    label="Review transactions"
                    onClick={() => setMode("review")}
                  />
                </nav>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {isParsing && <span role="status" className="mr-1 text-xs text-muted-foreground">Re-running parser…</span>}
                  {unreadablePageCount > 0 && pageWarningsAcknowledged && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-amber-700 dark:text-amber-300"
                      title="Show the pages that could not be read"
                      onClick={() => setPageWarningsAcknowledged(false)}
                    >
                      <TriangleAlert aria-hidden="true" className="mr-1 size-3.5" />
                      {unreadablePageCount} {unreadablePageCount === 1 ? "page" : "pages"} unreadable
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant={diagnosticsOpen ? "secondary" : "ghost"}
                    title="View parsing summary and technical diagnostics"
                    onClick={() => setDiagnosticsOpen(true)}
                  >
                    <CircleHelp aria-hidden="true" className="mr-1 size-3.5" />
                    Parser details{parserDetailCount > 0 ? ` (${parserDetailCount})` : ""}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Undo PDF correction"
                    title="Undo"
                    disabled={isParsing || !workbench.canUndo}
                    onClick={undo}
                  >
                    <Undo2 className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Redo PDF correction"
                    title="Redo"
                    disabled={isParsing || !workbench.canRedo}
                    onClick={redo}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                </div>
              </div>
              <SummaryBar result={parsed} totals={totals} />
            </div>

            {parserError && (
              <div role="alert" className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
                Re-run failed: {parserError}
              </div>
            )}

            {pageWarnings.length > 0 && !pageWarningsAcknowledged && (
              <div role="alert" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/5 px-4 py-2 text-xs">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
                <span className="min-w-0 flex-1">{pageWarnings.join(" ")}</span>
                <Button
                  className="shrink-0"
                  size="xs"
                  variant="outline"
                  onClick={() => setPageWarningsAcknowledged(true)}
                >
                  I checked these pages
                </Button>
              </div>
            )}

            {mode === "review" && (
              <PdfReviewStep
                rows={rows}
                tableRows={tableRows}
                result={parsed}
                filter={filter}
                setFilter={setFilter}
                search={search}
                setSearch={setSearch}
                sort={sort}
                onSort={(key, direction) => setSort((current) => nextSortState(current, key, direction))}
                selectedIds={selectedIds}
                allVisibleSelected={allVisibleSelected}
                someVisibleSelected={selectedVisible > 0}
                busy={isParsing}
                exportCount={sortedRows.length}
                onExport={exportVisibleRows}
                onToggleAll={() => {
                  setScopedCorrectionOffer(null);
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    visibleIds.forEach((id) => (allVisibleSelected ? next.delete(id) : next.add(id)));
                    return next;
                  });
                }}
                onToggle={(id, checked) => {
                  setScopedCorrectionOffer(null);
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                }}
                onDirection={setDirection}
                onField={(row, field, value) => setField(
                  row,
                  field,
                  field === "amount" && value ? normalizeTableAmountInput(value) : value
                )}
                onSource={showSource}
                onAccept={(row) => structuralCorrection({ kind: "accept-transaction", transactionIds: [row.id] })}
                onIgnore={(row) => structuralCorrection({ kind: "ignore-block", blockId: row.id })}
                onSplit={(row) => {
                  const block = parsed.blocks.find((entry) => entry.id === row.id);
                  if (block?.rowIds[1]) structuralCorrection({ kind: "split-block", blockId: block.id, beforeRowId: block.rowIds[1] });
                }}
                sourcePanel={sourceOpen && page ? (
                  <aside className="flex w-[42%] min-w-[26rem] flex-col border-l p-3 max-lg:absolute max-lg:inset-0 max-lg:z-30 max-lg:w-full max-lg:min-w-0 max-lg:bg-background">
                    <div className="mb-2 flex shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap">
                      <PdfPageControls
                        pageNumber={page.pageNumber}
                        pageCount={parsed.reconstructedPages.length}
                        onChange={setPageNumber}
                      />
                      <h3 className="text-sm font-medium">Source</h3>
                      <span className="text-xs text-muted-foreground">Highlighted text supports the selected field.</span>
                      <Button className="ml-auto" size="xs" variant="ghost" onClick={() => setSourceOpen(false)}>Close</Button>
                    </div>
                    <PdfSourcePreview
                      page={page}
                      previewDataUrl={pagePreviewDataUrl}
                      regions={pageRegions}
                      columns={parsed.guidance.columns}
                      highlightedSourceIds={highlightedSourceIds}
                      selectedRowId={selectedSourceRowId}
                      calibration={false}
                      showPageMetadata={false}
                      zoom={pdfZoom}
                      onZoomChange={setPdfZoom}
                      onSelectRow={setSelectedSourceRowId}
                      onToggleRegion={NOOP}
                      onColumnChange={NOOP}
                    />
                  </aside>
                ) : null}
              />
            )}

            {mode === "adjust" && page && (
              <PdfDetectionStep
                result={parsed}
                page={page}
                previewDataUrl={pagePreviewDataUrl}
                guidance={draftGuidance}
                issues={detectionIssues}
                busy={isParsing}
                preview={preview}
                previewDiff={previewDiff}
                drawingRegion={drawingRegion}
                showColumnMappings={showColumnMappings}
                highlightedSourceIds={highlightedSourceIds}
                selectedSourceRowId={selectedSourceRowId}
                columnFocusRequest={columnFocusRequest}
                controlFocus={controlFocus}
                interpretationOpen={interpretationOpen}
                zoom={pdfZoom}
                columnExamples={draftColumnExamples}
                layoutPanel={{
                  profiles,
                  selectedProfileId,
                  accountProfileId,
                  accountName,
                  notices: [profileNotice, layoutNotice].filter((notice): notice is string => Boolean(notice)),
                  disabled: isParsing,
                  canSave: Boolean(onSaveProfile) && parsed.metrics.rejected === 0 && !detectionDirty,
                  saveBlockedReason: parsed.metrics.rejected > 0
                    ? "Resolve rejected transactions before saving this layout"
                    : detectionDirty ? "Preview and apply the detection changes before saving this layout" : null,
                  onSelect: selectProfile,
                  onAssign: onAssignProfile ? () => void assignSelectedProfile() : undefined,
                  onManage: onAssignProfile && onRemoveAccountAssignment && onRenameBank && onRenameProfile && onDeleteProfile
                    ? () => setManageProfilesOpen(true)
                    : undefined,
                  onSave: onSaveProfile ? () => setSaveProfileOpen(true) : undefined,
                }}
                onZoomChange={setPdfZoom}
                onPageChange={setPageNumber}
                onToggleDrawingRegion={() => setDrawingRegion((current) => !current)}
                onToggleColumnMappings={() => setShowColumnMappings((current) => !current)}
                onSelectSourceRow={setSelectedSourceRowId}
                onInterpretationOpenChange={setInterpretationOpen}
                onResolveIssue={resolveIssue}
                onUpdateDraft={updateDraft}
                onUpdateColumn={updateColumn}
                onAddColumn={addColumn}
                onMoveColumn={moveColumn}
                onRemoveColumn={(id) => updateDraft({ columns: draftGuidance.columns.filter((entry) => entry.id !== id) })}
                onFocusColumn={focusMappedColumn}
                onMarkRow={(rowId) => structuralCorrection({ kind: "mark-row", rowId, pageNumber: page.pageNumber })}
                onRestoreBlock={(blockId) => structuralCorrection({ kind: "restore-block", blockId })}
                onReset={resetDetection}
                onPreview={previewDetection}
                onApply={applyDetection}
              />
            )}

            <PdfDiagnosticsSheet
              open={diagnosticsOpen}
              onOpenChange={setDiagnosticsOpen}
              result={parsed}
              issues={detectionIssues}
              warnings={parsed.warnings}
              profiles={profiles}
              onResolveIssue={resolveIssue}
              onApplyProfile={applyProfile}
              onCopyDiagnostics={copyDiagnostics}
            />

            {saveProfileOpen && (
              <PdfLayoutSaveDialog
                open
                onOpenChange={setSaveProfileOpen}
                profiles={profiles}
                initialBankName={selectedProfile?.bankName ?? ""}
                initialProfileName={selectedProfile?.envelope.profile.name ?? ""}
                accountName={accountName}
                isSaving={isSavingProfile}
                onSave={async (request) => {
                  if (!onSaveProfile) return;
                  try {
                    const saved = await onSaveProfile({ ...request, result: parsed });
                    if (saved) setSelectedProfileId(saved.profileId);
                    setSaveProfileOpen(false);
                    setLayoutNotice(null);
                    toast.success(request.mode === "update" ? "Statement layout updated" : "Statement layout saved", {
                      description: `${request.bankName} · ${request.profileName}`,
                    });
                  } catch (error) {
                    setParserError(error instanceof Error ? error.message : "The statement layout could not be saved.");
                  }
                }}
              />
            )}
            <ConfirmDialog open={confirm !== null} onOpenChange={(next) => { if (!next) setConfirm(null); }} state={confirm} />
            {manageProfilesOpen && onAssignProfile && onRemoveAccountAssignment && onRenameBank && onRenameProfile && onDeleteProfile && (
              <PdfDetectionProfileManagerDialog
                open
                onOpenChange={setManageProfilesOpen}
                accountName={accountName}
                banks={banks}
                profiles={profiles}
                accountProfileId={accountProfileId}
                onAssign={onAssignProfile}
                onRemoveAssignment={onRemoveAccountAssignment}
                onRenameBank={onRenameBank}
                onRenameProfile={onRenameProfile}
                onDeleteProfile={onDeleteProfile}
              />
            )}
          </>
        )}

        <DialogFooter className="m-0 flex-row shrink-0 items-center rounded-none border-t bg-muted/60 px-5 py-2 sm:justify-between">
          {mode === "review" && selectedIds.size > 0 ? (
            <div aria-label="Selected transaction actions" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs">
              <span className="mr-1 shrink-0 font-medium">{selectedIds.size} selected</span>
              <Button className="shrink-0" size="xs" variant="outline" disabled={isParsing || selectedHasRejected || selectedReviewIds.length === 0} onClick={acceptSelectedRows}>Mark {selectedReviewIds.length} reviewed</Button>
              <Button className="shrink-0" size="xs" variant="outline" disabled={isParsing} onClick={() => structuralCorrection({ kind: "set-direction", transactionIds: [...selectedIds], direction: "debit" })}>Money out</Button>
              <Button className="shrink-0" size="xs" variant="outline" disabled={isParsing} onClick={() => structuralCorrection({ kind: "set-direction", transactionIds: [...selectedIds], direction: "credit" })}>Money in</Button>
              <Button
                className="shrink-0"
                size="xs"
                variant="outline"
                disabled={isParsing || [...selectedIds].some((id) => rows.find((row) => row.id === id)?.direction === "unknown")}
                onClick={() => structuralCorrections([...selectedIds].flatMap((id) => {
                  const row = rows.find((entry) => entry.id === id);
                  return row && row.direction !== "unknown"
                    ? [{
                        kind: "set-direction" as const,
                        transactionIds: [id],
                        direction: row.direction === "debit" ? "credit" as const : "debit" as const,
                      }]
                    : [];
                }))}
              >
                Reverse
              </Button>
              <Button className="shrink-0" size="xs" variant="outline" disabled={isParsing || selectedIds.size < 2} onClick={() => structuralCorrection({ kind: "merge-blocks", blockIds: [...selectedIds] })}><GitMerge className="mr-1 size-3" />Merge rows</Button>
              <Button className="shrink-0" size="xs" variant="outline" disabled={isParsing} onClick={() => structuralCorrections([...selectedIds].map((blockId) => ({ kind: "ignore-block", blockId })))}><Trash2 className="mr-1 size-3" />Ignore</Button>
              <Button className="shrink-0" size="xs" variant="ghost" onClick={clearSelection}>Clear</Button>
            </div>
          ) : mode === "review" && scopedCorrectionOffer ? (
            <div aria-label="Apply correction to more transactions" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs">
              <span className="mr-1 shrink-0"><strong>{scopedCorrectionOffer.label}</strong> changed for this row.</span>
              {scopedCorrectionOffer.similarIds.length > 0 && (
                <Button size="xs" variant="outline" disabled={isParsing} onClick={() => {
                  structuralCorrections(scopedCorrectionOffer.build(scopedCorrectionOffer.similarIds), "similar-rows");
                  setScopedCorrectionOffer(null);
                }}>Apply to {scopedCorrectionOffer.similarIds.length} similar</Button>
              )}
              {scopedCorrectionOffer.remainingIds.length > 0 && (
                <Button size="xs" variant="outline" disabled={isParsing} onClick={() => {
                  const transactionIds = [...scopedCorrectionOffer.similarIds, ...scopedCorrectionOffer.remainingIds];
                  structuralCorrections(scopedCorrectionOffer.build(transactionIds), "file");
                  setScopedCorrectionOffer(null);
                }}>Apply to all {scopedCorrectionOffer.similarIds.length + scopedCorrectionOffer.remainingIds.length} remaining</Button>
              )}
              <Button size="xs" variant="ghost" onClick={() => setScopedCorrectionOffer(null)}>Dismiss</Button>
            </div>
          ) : (
            <div className="min-w-0 flex-1 text-xs">
              {importBlockedByPages ? <span className="text-amber-700 dark:text-amber-300">Confirm the pages that could not be read before importing.</span>
                : blockingCount > 0 ? <span className="text-destructive">Resolve {blockingCount} rejected {blockingCount === 1 ? "transaction" : "transactions"}.</span>
                : reviewCount > 0 ? <span className="text-amber-700 dark:text-amber-300">Check and mark {reviewCount} {reviewCount === 1 ? "transaction" : "transactions"} reviewed.</span>
                  : <span className="text-muted-foreground">All transactions are ready.</span>}
            </div>
          )}
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" disabled={isParsing} onClick={() => onOpenChange(false)}>Cancel</Button>
            {!parsed.likelyScanned && (
              <Button
                disabled={isParsing || rows.length === 0 || blockingCount > 0 || reviewCount > 0 || importBlockedByPages}
                title={importBlockedByPages ? "Confirm that you checked the pages that could not be read" : undefined}
                onClick={() => onImport(rows, parsed)}
              >
                Use {rows.length} {rows.length === 1 ? "transaction" : "transactions"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initialModeForResult(result: PdfStatementParseResult | null, profileNeedsReview = false): WorkbenchMode {
  if (profileNeedsReview || !result || result.transactions.length === 0) return "adjust";
  return result.metrics.rejected / result.transactions.length > 0.5 ? "adjust" : "review";
}

function initialReviewFilter(result: PdfStatementParseResult | null): PdfReviewCategory {
  return result && result.metrics.review + result.metrics.rejected > 0 ? "needs-review" : "all";
}

/**
 * What stands between this statement and an import, worded as the next thing
 * to do. Where one setting answers the question, the issue carries the control
 * that sets it so the reader is not left hunting for it.
 */
function detectionIssuesFor(
  result: PdfStatementParseResult | null,
  guidance: PdfParserGuidance | null
): PdfDetectionIssue[] {
  if (!result || !guidance) return [{ message: "No detection result is available." }];
  const issues: PdfDetectionIssue[] = [];
  // Not the statement-layout notice: that is about the layout in force, and it
  // is said in the panel that holds the control for it, immediately below.
  if (!guidance.regions.some((region) => region.included && region.kind === "transactions")) {
    issues.push({ message: "Select at least one transaction area." });
  }
  if (!guidance.columns.some((column) => ["transaction-date", "posting-date", "value-date"].includes(column.role))) {
    issues.push({ message: "Map the statement date column." });
  }
  if (!guidance.columns.some((column) => ["amount", "debit", "credit"].includes(column.role))) {
    issues.push({ message: "Map the account amount, money-out, or money-in column." });
  }
  // Worded exactly like the parser's own warning so the two are one item in
  // the Parser details list rather than the same question asked twice.
  if (!guidance.currency) {
    issues.push({
      message: "The statement currency was not detected. Set it in Statement interpretation.",
      focus: "pdf-statement-currency",
    });
  }

  const blocked = result.transactions.filter((row) => row.status === "rejected");
  if (result.transactions.length > 0 && blocked.length / result.transactions.length > 0.5) {
    const unresolvedDirection = blocked.filter((row) => row.issueCodes.includes("DIRECTION_UNRESOLVED")).length;
    const missingAmount = blocked.filter((row) => row.issueCodes.includes("AMOUNT_MISSING")).length;
    if (unresolvedDirection >= blocked.length / 2) {
      issues.push({
        message: `${unresolvedDirection} transactions do not say whether they are money in or money out. Choose what an unmarked amount means.`,
        focus: "pdf-unsigned-direction",
      });
    } else if (missingAmount >= blocked.length / 2) {
      issues.push({ message: `${missingAmount} transactions have no amount. Map the column that holds the account amount.` });
    } else {
      issues.push({ message: "Most detected transactions have unresolved required fields." });
    }
  }
  return issues.filter((issue, index, entries) => entries.findIndex((entry) => entry.message === issue.message) === index);
}

function WorkflowStepButton({ step, active, label, onClick }: { step: number; active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "step" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs",
        active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
      )}
    >
      <span className={cn("inline-flex size-4 items-center justify-center rounded-full border text-[10px]", active && "border-foreground")}>{step}</span>
      <span>{label}</span>
    </button>
  );
}

const SummaryBar = memo(function SummaryBar({
  result,
  totals,
}: {
  result: PdfStatementParseResult;
  totals: { credits: number; debits: number };
}) {
  const dates = result.transactions.map((row) => row.importDate).filter((date): date is string => Boolean(date)).sort();
  const outstanding = result.metrics.review + result.metrics.rejected;
  const net = totals.credits - totals.debits;
  return (
    <section
      aria-label="PDF parse summary"
      className="flex items-center gap-x-4 gap-y-1 overflow-x-auto border-t px-4 py-1.5 text-[11px] whitespace-nowrap"
    >
      <span className="shrink-0">
        <strong className="tabular-nums">{result.transactions.length}</strong>{" "}
        <span className="text-muted-foreground">{result.transactions.length === 1 ? "transaction" : "transactions"}</span>
        {dates.length > 0 && (
          <span className="text-muted-foreground">
            {" · "}{dates[0]}{dates.length > 1 && dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ""}
          </span>
        )}
      </span>

      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />

      <span className="flex shrink-0 items-baseline gap-3">
        <SummaryMetric label="In" value={`+${formatMinorUnits(totals.credits)}`} tone="positive" />
        <SummaryMetric label="Out" value={formatMinorUnits(-totals.debits)} tone="negative" />
        <span className="flex items-baseline gap-1">
          <span className="text-muted-foreground">Net</span>
          <strong className={cn(
            "text-xs tabular-nums",
            net > 0 && "text-emerald-700 dark:text-emerald-400",
            net < 0 && "text-red-600 dark:text-red-400"
          )}>{`${net > 0 ? "+" : ""}${formatMinorUnits(net)}`}</strong>
        </span>
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span className="text-muted-foreground">{result.metrics.transactionPages} of {result.metrics.pages} pages</span>
        <Badge
          variant={result.metrics.rejected > 0
            ? "status-error"
            : result.metrics.review > 0 ? "status-warning" : "status-active"}
        >
          {result.metrics.rejected > 0
            ? `${result.metrics.rejected} to fix`
            : result.metrics.review > 0
              ? `${result.metrics.review} to review`
              : outstanding === 0 ? "All ready" : `${outstanding} to review`}
        </Badge>
      </span>
    </section>
  );
});

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn(
        "font-semibold tabular-nums",
        tone === "positive" && "text-emerald-700 dark:text-emerald-400",
        tone === "negative" && "text-red-600 dark:text-red-400"
      )}>{value}</span>
    </span>
  );
}
