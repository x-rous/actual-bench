"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Eye,
  GitMerge,
  ListPlus,
  ListRestart,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Split,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/uuid";
import { columnBoundsForPage } from "@/lib/reconciliation/statement/pdf/columns";
import {
  columnExamplesForRegions,
  guidanceFromPdfLayoutProfile,
  matchPdfLayoutProfile,
  type PdfAccountType,
  type PdfColumn,
  type PdfColumnRole,
  type PdfConfidenceReason,
  type PdfCorrection,
  type PdfCorrectionScope,
  type PdfDateFormatOption,
  type PdfImportDate,
  type PdfLayoutProfile,
  type PdfNumberFormat,
  type PdfParserGuidance,
  type PdfRegion,
  type PdfStatementParseResult,
  type PdfTransactionProposal,
} from "@/lib/reconciliation/statement/pdf";
import { parsePdfStatementOffMainThread } from "@/lib/reconciliation/statement/pdfClient";
import { formatMinorUnits } from "../lib/format";
import { PDF_DEFAULT_ZOOM, PdfSourcePreview, pdfColumnColor } from "./PdfSourcePreview";
import { PdfDetectionProfileManagerDialog } from "./PdfDetectionProfileManagerDialog";
import type { PdfDetectionBankRecord } from "../lib/reconciliationApi";

type ReviewCategory = "all" | "needs-review" | "ready" | "structure" | "dates" | "amounts" | "reconciliation" | "duplicates" | "manual";
type WorkbenchMode = "review" | "adjust" | "diagnostics";
type PdfCorrectionInput = PdfCorrection extends infer Correction
  ? Correction extends PdfCorrection
    ? Omit<Correction, "id" | "createdAt" | "scope">
    : never
  : never;

type ScopedCorrectionOffer = {
  label: string;
  similarIds: string[];
  remainingIds: string[];
  build: (transactionIds: string[]) => PdfCorrectionInput[];
};

const COLUMN_ROLE_GROUPS: { label: string; roles: { value: PdfColumnRole; label: string }[] }[] = [
  { label: "Dates", roles: [
    { value: "transaction-date", label: "Transaction date" },
    { value: "posting-date", label: "Posting date" },
    { value: "value-date", label: "Value date" },
  ] },
  { label: "Transaction details", roles: [
    { value: "description", label: "Description" },
    { value: "reference", label: "Reference" },
  ] },
  { label: "Account values", roles: [
    { value: "amount", label: "Amount" },
    { value: "debit", label: "Money out" },
    { value: "credit", label: "Money in" },
    { value: "direction", label: "DR / CR marker" },
    { value: "currency", label: "Currency" },
    { value: "balance", label: "Balance" },
  ] },
  { label: "Foreign-currency details", roles: [
    { value: "original-amount", label: "Original-currency amount" },
    { value: "original-currency", label: "Original currency" },
    { value: "exchange-rate", label: "Exchange rate" },
  ] },
  { label: "Charges", roles: [
    { value: "fee", label: "Fee" },
    { value: "vat", label: "VAT / tax" },
  ] },
  { label: "Exclude", roles: [
    { value: "ignore", label: "Ignore this column" },
  ] },
];

const DATE_FORMATS: { value: PdfDateFormatOption; label: string }[] = [
  { value: "auto", label: "Auto-detect from mapped dates" },
  { value: "dmy", label: "Day / month / year" },
  { value: "mdy", label: "Month / day / year" },
  { value: "ymd", label: "Year / month / day" },
  { value: "dmy-name", label: "Month-name date (03 Jul or Jul 03)" },
  { value: "iso", label: "ISO year-month-day" },
  { value: "ymd-compact", label: "Compact YYYYMMDD" },
];

const NUMBER_FORMATS: { value: PdfNumberFormat; label: string }[] = [
  { value: "auto", label: "Auto-detect from printed values" },
  { value: "us", label: "1,234.56" },
  { value: "european", label: "1.234,56" },
  { value: "space", label: "1 234,56" },
  { value: "indian", label: "1,23,456.78" },
  { value: "swiss", label: "1'234.56" },
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
  accountName = "This account",
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
  onSaveProfile?: (input: {
    bankName: string;
    profileName: string;
    assignToAccount: boolean;
    result: PdfStatementParseResult;
  }) => Promise<{ bankId: string; profileId: string; profileVersion: number } | void>;
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
  const [parsed, setParsed] = useState(result);
  const [draftGuidance, setDraftGuidance] = useState<PdfParserGuidance | null>(result?.guidance ?? null);
  const [corrections, setCorrections] = useState<PdfCorrection[]>([]);
  const [redoCorrections, setRedoCorrections] = useState<PdfCorrection[]>([]);
  const [mode, setMode] = useState<WorkbenchMode>(() =>
    initialModeForResult(result, Boolean(profileNotice))
  );
  const [filter, setFilter] = useState<ReviewCategory>(() => initialReviewFilter(result));
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scopedCorrectionOffer, setScopedCorrectionOffer] = useState<ScopedCorrectionOffer | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [highlightedSourceIds, setHighlightedSourceIds] = useState<Set<string>>(new Set());
  const [selectedSourceRowId, setSelectedSourceRowId] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [preview, setPreview] = useState<PdfStatementParseResult | null>(null);
  const [drawingRegion, setDrawingRegion] = useState(false);
  const [showColumnMappings, setShowColumnMappings] = useState(true);
  const [pdfZoom, setPdfZoom] = useState(PDF_DEFAULT_ZOOM);
  const [columnFocusRequest, setColumnFocusRequest] = useState<{ columnId: string; requestId: number } | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parserError, setParserError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(activeProfileId);
  const [manageProfilesOpen, setManageProfilesOpen] = useState(false);
  const [appliedProfileVersion, setAppliedProfileVersion] = useState<number | null>(() =>
    profiles.find((profile) => profile.recordId === activeProfileId)?.envelope.profile.profileVersion ?? null
  );
  const [saveProfileOpen, setSaveProfileOpen] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => parsed?.transactions ?? [], [parsed]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    const query = search.trim().toLowerCase();
    return matchesCategory(row, filter)
      && (!query || row.description.toLowerCase().includes(query) || row.amount.includes(query) || row.importDate?.includes(query));
  }), [filter, rows, search]);
  const tableRows = useMemo(() => visibleRows.map((row) => ({
    ...row,
    amount: formatTableAmount(row.amount),
  })), [visibleRows]);
  const visibleIds = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const selectedReviewIds = selectedRows.filter((row) => row.status === "review").map((row) => row.id);
  const selectedHasRejected = selectedRows.some((row) => row.status === "rejected");
  const blockingCount = rows.filter((row) => row.status === "rejected").length;
  const reviewCount = rows.filter((row) => row.status === "review").length;
  const totals = useMemo(() => transactionTotals(rows), [rows]);
  const page = parsed?.reconstructedPages.find((entry) => entry.pageNumber === pageNumber) ?? parsed?.reconstructedPages[0] ?? null;
  const pagePreviewDataUrl = parsed?.document.pages.find((entry) => entry.pageNumber === page?.pageNumber)?.previewDataUrl ?? null;
  const pageRegions = useMemo(
    () => parsed?.regions.filter((region) => region.pageNumber === page?.pageNumber) ?? [],
    [page?.pageNumber, parsed?.regions]
  );
  const ignoredPageBlocks = useMemo(
    () => parsed?.blocks.filter((block) => block.pageNumber === page?.pageNumber && block.excluded) ?? [],
    [page?.pageNumber, parsed?.blocks]
  );
  const profileMatches = useMemo(() => profiles.flatMap((option) => [
    option.envelope.profile,
    ...(option.envelope.history ?? []),
  ].map((profile) => ({
    option,
    profile,
    current: profile.id === option.envelope.profile.id,
    match: parsed ? matchPdfLayoutProfile(profile, parsed.reconstructedPages, parsed.activeSchema) : null,
  }))), [parsed, profiles]);
  const selectedProfile = profiles.find((profile) => profile.recordId === selectedProfileId) ?? null;
  const selectedIsAccountProfile = accountProfileId === selectedProfile?.recordId;
  const profilesByBank = useMemo(() => profiles.reduce<Map<string, PdfDetectionProfileOption[]>>(
    (groups, profile) => {
      const current = groups.get(profile.bankName) ?? [];
      groups.set(profile.bankName, [...current, profile]);
      return groups;
    },
    new Map()
  ), [profiles]);
  const previewDiff = useMemo(
    () => parsed && preview ? resultDiff(parsed, preview) : null,
    [parsed, preview]
  );
  const detectionDirty = useMemo(
    () => parsed ? JSON.stringify(draftGuidance) !== JSON.stringify(parsed.guidance) : false,
    [draftGuidance, parsed]
  );
  const draftColumnExamples = useMemo(() => new Map(
    (draftGuidance?.columns ?? []).map((column) => [
      column.id,
      parsed ? columnExamplesForRegions(parsed.reconstructedPages, draftGuidance?.regions ?? [], column) : [],
    ])
  ), [draftGuidance?.columns, draftGuidance?.regions, parsed]);
  const detectionIssues = useMemo(
    () => detectionIssuesFor(parsed, draftGuidance, profileNotice),
    [draftGuidance, parsed, profileNotice]
  );
  const parserDetailCount = parsed
    ? new Set([...parsed.warnings, ...detectionIssues]).size
    : 0;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedVisible > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedVisible]);

  useEffect(() => {
    if (filter !== "all" && !rows.some((row) => matchesCategory(row, filter))) setFilter("all");
  }, [filter, rows]);

  useEffect(() => {
    setPdfZoom(PDF_DEFAULT_ZOOM);
    setColumnFocusRequest(null);
  }, [fileName, result?.document]);

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

  function applyCorrections(additions: PdfCorrection[]) {
    if (!parsed || isParsing) return;
    const next = [...corrections, ...additions];
    rerun(parsed.guidance, next, (output) => {
      setCorrections(next);
      setRedoCorrections([]);
      setParsed(output);
      setDraftGuidance(output.guidance);
      setSelectedIds(new Set());
    });
  }

  function applyCorrection(correction: PdfCorrection) {
    applyCorrections([correction]);
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
      setSelectedIds(new Set());
    });
  }

  function structuralCorrection(correction: PdfCorrectionInput, correctionScope: PdfCorrectionScope = "row") {
    applyCorrection({ ...correction, id: generateId(), createdAt: new Date().toISOString(), scope: correctionScope } as PdfCorrection);
  }

  function structuralCorrections(items: PdfCorrectionInput[], correctionScope: PdfCorrectionScope = "row") {
    const createdAt = new Date().toISOString();
    applyCorrections(items.map((correction) => ({
      ...correction,
      id: generateId(),
      createdAt,
      scope: correctionScope,
    } as PdfCorrection)));
  }

  function similarTargetIds(row: PdfTransactionProposal) {
    const reasons = new Set(row.issueCodes.filter(isActionableReason));
    if (!reasons.size) return [];
    return rows.filter((entry) => entry.issueCodes.some((reason) => isActionableReason(reason) && reasons.has(reason))).map((entry) => entry.id);
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

  function setDirection(row: PdfTransactionProposal, direction: "debit" | "credit") {
    structuralCorrection({ kind: "set-direction", transactionIds: [row.id], direction });
    offerBroaderCorrection(row, direction === "debit" ? "Money out" : "Money in", (transactionIds) => [
      { kind: "set-direction", transactionIds, direction },
    ]);
  }

  function setField(row: PdfTransactionProposal, field: "transactionDate" | "postedDate" | "valueDate" | "importDate" | "description" | "reference" | "amount" | "currency", value: string | null) {
    const corrections: PdfCorrectionInput[] = [{ kind: "set-field", transactionIds: [row.id], field, value }];
    const selectedImportField = parsed?.guidance.importDate === "transaction"
      ? "transactionDate"
      : parsed?.guidance.importDate === "posting"
        ? "postedDate"
        : "valueDate";
    if (field === selectedImportField) {
      corrections.push({ kind: "set-field", transactionIds: [row.id], field: "importDate", value });
    }
    structuralCorrections(corrections);
    if (["description", "amount", "currency"].includes(field)) {
      const label = field === "description" ? "Description" : field === "amount" ? "Amount" : "Currency";
      offerBroaderCorrection(row, label, (transactionIds) => [{ kind: "set-field", transactionIds, field, value }]);
    } else {
      setScopedCorrectionOffer(null);
    }
  }

  function showSource(row: PdfTransactionProposal, field: keyof PdfTransactionProposal["confidence"]) {
    const confidence = row.confidence[field];
    const sourceIds = Array.isArray(confidence)
      ? confidence.flatMap((entry) => entry.sourceIds)
      : confidence?.sourceIds ?? row.raw.sourceIds;
    setHighlightedSourceIds(new Set(sourceIds));
    setSelectedSourceRowId(row.id);
    setPageNumber(pageForSourceIds(parsed, sourceIds, row.raw.pageNumber));
    setSourceOpen(true);
  }

  function focusMappedColumn(column: PdfColumn) {
    if (column.pageNumber !== null) setPageNumber(column.pageNumber);
    setColumnFocusRequest((current) => ({
      columnId: column.id,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }

  function updateDraft(patch: Partial<PdfParserGuidance>) {
    setDraftGuidance((current) => current ? { ...current, ...patch } : current);
    setPreview(null);
  }

  function previewDetection() {
    if (!draftGuidance || isParsing) return;
    rerun(draftGuidance, corrections, setPreview);
  }

  function applyDetection() {
    if (!draftGuidance || !parsed || !preview || isParsing) return;
    const output = preview;
    const diff = resultDiff(parsed, output);
    setParsed(output);
    setDraftGuidance(output.guidance);
    setPreview(null);
    setMode("review");
    setFilter(output.metrics.review + output.metrics.rejected > 0 ? "needs-review" : "all");
    setSelectedIds(new Set());
    toast.success("Detection changes applied", {
      description: `${diff.after} ${diff.after === 1 ? "transaction" : "transactions"} found · ${diff.afterReview} ${diff.afterReview === 1 ? "needs" : "need"} review`,
    });
  }

  function resetDetection() {
    if (!parsed) return;
    setDraftGuidance(parsed.detectedGuidance);
    setPreview(null);
  }

  function updateColumn(id: string, patch: Partial<PdfColumn>) {
    if (!draftGuidance) return;
    updateDraft({ columns: draftGuidance.columns.map((column) => column.id === id ? { ...column, ...patch } : column) });
  }

  function addColumn() {
    if (!draftGuidance || !page) return;
    const bounds = newColumnBounds(draftGuidance.columns, page.pageNumber, page.width);
    updateDraft({ columns: [...draftGuidance.columns, { id: generateId(), pageNumber: null, referencePageWidth: page.width, ...bounds, role: "ignore", header: null, examples: [], confidence: 1 }] });
  }

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

  function applyProfile(
    option: PdfDetectionProfileOption,
    profile: PdfLayoutProfile = option.envelope.profile
  ) {
    if (!parsed || isParsing) return;
    const profileMatch = matchPdfLayoutProfile(
      profile,
      parsed.reconstructedPages,
      parsed.activeSchema
    );
    if (profileMatch.outcome === "conflicting") {
      setParserError("That layout conflicts with the detected table. Adjust the mapping or choose another layout.");
      return;
    }
    const profileGuidance = guidanceFromPdfLayoutProfile(profile, parsed);
    rerun(profileGuidance, corrections, (output) => {
      setParsed(output);
      setDraftGuidance(output.guidance);
      setPreview(null);
      setSelectedProfileId(option.recordId);
      setAppliedProfileVersion(profile.profileVersion);
      onProfileChange?.(option);
    });
  }

  function selectProfile(recordId: string) {
    if (!recordId) {
      if (!parsed || isParsing) return;
      rerun(parsed.detectedGuidance, corrections, (output) => {
        setParsed(output);
        setDraftGuidance(output.guidance);
        setPreview(null);
        setSelectedProfileId(null);
        setAppliedProfileVersion(null);
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
      <DialogContent aria-busy={isParsing} className="flex h-[94vh] max-h-[94vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)]">
        <DialogHeader className="shrink-0 border-b px-4 py-2.5 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            <DialogTitle>Review PDF statement</DialogTitle>
            <DialogDescription className="min-w-0 flex-1 truncate" title={fileName}>{fileName}</DialogDescription>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title="The PDF is processed locally in your browser and is not uploaded."><ShieldCheck aria-hidden="true" className="size-3.5" />Local only</span>
          </div>
        </DialogHeader>

        {parsed.likelyScanned ? (
          <div role="alert" className="m-5 rounded-md border border-amber-500/50 bg-amber-500/5 p-4 text-sm">
            <p className="font-medium">This PDF does not have a usable text layer.</p>
            <p className="mt-1 text-muted-foreground">Use a text-based PDF, CSV, OFX, or QIF. Actual Bench did not upload or save this file.</p>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-muted/10 px-4 py-1.5">
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
              <SummaryBar result={parsed} totals={totals} />
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  size="xs"
                  variant={mode === "diagnostics" ? "secondary" : "ghost"}
                  title={parserDetailCount > 0 ? [...new Set([...detectionIssues, ...parsed.warnings])].join("\n") : "View parsing summary and technical diagnostics"}
                  onClick={() => { setScopedCorrectionOffer(null); setMode("diagnostics"); }}
                >
                  <CircleHelp aria-hidden="true" className="mr-1 size-3.5" />Parser details{parserDetailCount > 0 ? ` (${parserDetailCount})` : ""}
                </Button>
                {isParsing && <span role="status" className="mr-2 text-xs text-muted-foreground">Re-running parser…</span>}
                <Button size="icon-sm" variant="ghost" aria-label="Undo PDF correction" title="Undo" disabled={isParsing || !corrections.length} onClick={undo}><Undo2 className="size-3.5" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Redo PDF correction" title="Redo" disabled={isParsing || !redoCorrections.length} onClick={redo}><RotateCcw className="size-3.5" /></Button>
              </div>
            </div>

            {parserError && (
              <div role="alert" className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
                Re-run failed: {parserError}
              </div>
            )}

            {mode === "review" && (
              <div className="relative flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  <ReviewToolbar
                    rows={rows}
                    filter={filter}
                    setFilter={setFilter}
                    search={search}
                    setSearch={setSearch}
                  />
                  <TransactionTable
                    rows={tableRows}
                    result={parsed}
                    selectedIds={selectedIds}
                    allVisibleSelected={allVisibleSelected}
                    selectAllRef={selectAllRef}
                    onToggleAll={() => {
                      setScopedCorrectionOffer(null);
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        visibleIds.forEach((id) => allVisibleSelected ? next.delete(id) : next.add(id));
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
                  />
                </div>
                {sourceOpen && page && (
                  <aside className="flex w-[42%] min-w-[26rem] flex-col border-l p-3 max-lg:absolute max-lg:inset-0 max-lg:z-30 max-lg:w-full max-lg:min-w-0 max-lg:bg-background">
                    <div className="mb-2 flex shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap">
                      <h3 className="text-sm font-medium">Source</h3>
                      <span className="text-xs text-muted-foreground">Highlighted text supports the selected field.</span>
                      <PageControls pageNumber={page.pageNumber} pageCount={parsed.reconstructedPages.length} onChange={setPageNumber} />
                      <span className="text-xs text-muted-foreground">{Math.round(page.coverage * 1000) / 10}% text coverage</span>
                      <Button className="ml-auto" size="xs" variant="ghost" onClick={() => setSourceOpen(false)}>Close</Button>
                    </div>
                    <PdfSourcePreview page={page} previewDataUrl={pagePreviewDataUrl} regions={pageRegions} columns={parsed.guidance.columns} highlightedSourceIds={highlightedSourceIds} selectedRowId={selectedSourceRowId} calibration={false} showPageMetadata={false} zoom={pdfZoom} onZoomChange={setPdfZoom} onSelectRow={setSelectedSourceRowId} onToggleRegion={NOOP} onColumnChange={NOOP} />
                  </aside>
                )}
              </div>
            )}

            {mode === "adjust" && page && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-muted/10 px-4 py-1.5 text-xs whitespace-nowrap">
                  <label htmlFor="pdf-detection-profile" className="font-medium">Statement layout</label>
                  <select
                    id="pdf-detection-profile"
                    value={selectedProfileId ?? ""}
                    disabled={isParsing}
                    onChange={(event) => selectProfile(event.target.value)}
                    className="h-8 min-w-64 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="">Automatic</option>
                    {[...profilesByBank.entries()]
                      .sort(([left], [right]) => left.localeCompare(right))
                      .map(([bankName, bankProfiles]) => (
                      <optgroup key={bankName} label={bankName}>
                        {[...bankProfiles].sort((left, right) => left.envelope.profile.name.localeCompare(right.envelope.profile.name)).map((profile) => (
                          <option key={profile.recordId} value={profile.recordId}>
                            {profile.envelope.profile.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {selectedProfile && !selectedIsAccountProfile && onAssignProfile && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={isParsing}
                      onClick={() => void assignSelectedProfile()}
                    >
                      Use for this account
                    </Button>
                  )}
                  <span className="text-muted-foreground" title={selectedProfile
                    ? `${selectedProfile.bankName} · ${selectedProfile.envelope.profile.name}${appliedProfileVersion ? ` v${appliedProfileVersion}` : ""}${selectedIsAccountProfile ? " · assigned to this account" : " · this statement only"}`
                    : "Automatic detection applies to this statement only"}>
                    {selectedProfile
                      ? `${selectedProfile.bankName}${selectedIsAccountProfile ? " · assigned" : " · statement only"}`
                      : "Statement only"}
                  </span>
                  {detectionIssues.length > 0 && (
                    <button type="button" className="inline-flex max-w-72 items-center gap-1 text-amber-700 dark:text-amber-300" title={detectionIssues.join("\n")} onClick={() => setMode("diagnostics")}>
                      <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="truncate">{detectionIssues[0]}</span>
                      {detectionIssues.length > 1 && <span className="shrink-0">+{detectionIssues.length - 1}</span>}
                    </button>
                  )}
                  {onAssignProfile && onRemoveAccountAssignment && onRenameBank && onRenameProfile && onDeleteProfile && (
                    <Button
                      className="ml-auto"
                      size="xs"
                      variant="ghost"
                      disabled={isParsing}
                      onClick={() => setManageProfilesOpen(true)}
                    >
                      <Settings2 className="mr-1 size-3.5" />Manage layouts
                    </Button>
                  )}
                  {onSaveProfile && (
                    <Button
                      className={onAssignProfile ? undefined : "ml-auto"}
                      size="xs"
                      variant="outline"
                      disabled={isParsing || parsed.metrics.rejected > 0 || detectionDirty}
                      title={parsed.metrics.rejected > 0
                        ? "Resolve rejected transactions before saving this layout"
                        : detectionDirty ? "Preview and apply detection changes before saving this layout" : undefined}
                      onClick={() => setSaveProfileOpen(true)}
                    >
                      <Save className="mr-1 size-3.5" />Save layout
                    </Button>
                  )}
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-auto lg:grid-cols-[minmax(0,58fr)_minmax(24rem,42fr)] lg:overflow-hidden">
                <div className="flex min-h-[26rem] flex-col border-b p-3 lg:min-h-0 lg:border-r lg:border-b-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <PageControls pageNumber={page.pageNumber} pageCount={parsed.reconstructedPages.length} onChange={setPageNumber} />
                    <Button size="xs" variant={drawingRegion ? "default" : "outline"} onClick={() => setDrawingRegion((current) => !current)}>
                      <SquareDashedMousePointer aria-hidden="true" className="mr-1 size-3.5" />
                      {drawingRegion ? "Drag on the page" : "Select transaction area"}
                    </Button>
                    {selectedSourceRowId && !parsed.blocks.some((block) => block.rowIds.includes(selectedSourceRowId)) && (
                      <Button size="xs" variant="outline" onClick={() => structuralCorrection({ kind: "mark-row", rowId: selectedSourceRowId, pageNumber: page.pageNumber })}>
                        <ListPlus aria-hidden="true" className="mr-1 size-3.5" />
                        Mark selected row as transaction
                      </Button>
                    )}
                    {ignoredPageBlocks.map((block, index) => (
                      <Button key={block.id} size="xs" variant="outline" onClick={() => structuralCorrection({ kind: "restore-block", blockId: block.id })}>
                        Restore ignored row {index + 1}
                      </Button>
                    ))}
                    <span className="ml-auto text-xs text-muted-foreground">{Math.round(page.coverage * 1000) / 10}% text coverage</span>
                  </div>
                  <PdfSourcePreview
                    page={page}
                    previewDataUrl={pagePreviewDataUrl}
                    regions={draftGuidance.regions.filter((region) => region.pageNumber === page.pageNumber)}
                    columns={showColumnMappings ? draftGuidance.columns : []}
                    highlightedSourceIds={highlightedSourceIds}
                    selectedRowId={selectedSourceRowId}
                    calibration
                    showPageMetadata={false}
                    drawRegion={drawingRegion}
                    zoom={pdfZoom}
                    onZoomChange={setPdfZoom}
                    columnMappingsVisible={showColumnMappings}
                    onToggleColumnMappings={() => setShowColumnMappings((current) => !current)}
                    focusColumnRequest={columnFocusRequest}
                    onSelectRow={setSelectedSourceRowId}
                    onToggleRegion={(regionId) => updateDraft({ regions: draftGuidance.regions.map((region) => region.id === regionId ? { ...region, included: !region.included, kind: !region.included ? "transactions" : region.kind } : region) })}
                    onColumnChange={(columnId, edge, value) => updateColumn(columnId, edge === "start" ? { xStart: Math.min(value, draftGuidance.columns.find((column) => column.id === columnId)?.xEnd ?? value) } : { xEnd: Math.max(value, draftGuidance.columns.find((column) => column.id === columnId)?.xStart ?? value) })}
                    onDrawRegion={(box) => {
                      const rowIds = page.rows.filter((row) => boxesOverlap(box, row)).map((row) => row.id);
                      const region: PdfRegion = {
                        id: generateId(),
                        pageNumber: page.pageNumber,
                        ...box,
                        kind: "transactions",
                        included: true,
                        confidence: 1,
                        rowIds,
                        reasons: ["manually selected transaction region"],
                      };
                      updateDraft({ regions: [...draftGuidance.regions.filter((entry) => entry.pageNumber !== page.pageNumber || !entry.included), region] });
                      setDrawingRegion(false);
                    }}
                  />
                </div>
                <div className="flex min-h-0 flex-col">
                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    <DetectionControls guidance={draftGuidance} accountType={parsed.accountType} onChange={updateDraft} />
                    <div className="mt-4 flex items-center justify-between">
                      <h3 className="text-sm font-medium">Column mapping</h3>
                      <Button size="xs" variant="outline" onClick={addColumn}>Map another column</Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Tell Actual Bench what each statement column contains. Select a mapping to find it in the PDF, or drag its boundaries to correct it.</p>
                    <div className="mt-2 space-y-2">
                      {draftGuidance.columns.map((column, columnIndex) => (
                        <div
                          key={column.id}
                          className="grid grid-cols-[0.25rem_minmax(10rem,1fr)_minmax(0,0.8fr)_auto] items-center gap-2 rounded-md border px-2 py-1"
                          onPointerDownCapture={() => focusMappedColumn(column)}
                          onFocusCapture={() => focusMappedColumn(column)}
                        >
                          <span aria-hidden="true" className="h-7 w-1 rounded-full" style={{ backgroundColor: pdfColumnColor(columnIndex).border }} />
                          <select aria-label={`Role for mapped column ${columnIndex + 1}`} value={column.role} onChange={(event) => updateColumn(column.id, { role: event.target.value as PdfColumnRole })} className="h-8 w-full rounded border bg-background px-2 text-xs font-medium">
                            {COLUMN_ROLE_GROUPS.map((group) => (
                              <optgroup key={group.label} label={group.label}>
                                {group.roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          <p className="min-w-0 truncate text-[10px] text-muted-foreground" title={(draftColumnExamples.get(column.id) ?? []).join(" · ")}>Examples: {(draftColumnExamples.get(column.id) ?? []).join(" · ") || "No matching value read yet"}</p>
                          <div className="flex items-center">
                            <Button size="icon-sm" variant="ghost" aria-label={`Move ${column.role} column left`} disabled={columnIndex === 0} onClick={() => moveColumn(column.id, -1)}><ChevronLeft className="size-3.5" /></Button>
                            <Button size="icon-sm" variant="ghost" aria-label={`Move ${column.role} column right`} disabled={columnIndex === draftGuidance.columns.length - 1} onClick={() => moveColumn(column.id, 1)}><ChevronRight className="size-3.5" /></Button>
                            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${column.role} column`} onClick={() => updateDraft({ columns: draftGuidance.columns.filter((entry) => entry.id !== column.id) })}><Trash2 className="size-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 border-t bg-muted/20 px-4 py-3 text-xs">
                    {preview && previewDiff && (
                      <DetectionChangePreview diff={previewDiff} />
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <Button size="xs" variant="ghost" disabled={isParsing} onClick={resetDetection}><ListRestart className="mr-1 size-3" />Reset detection</Button>
                      <Button size="xs" variant="outline" disabled={isParsing} onClick={previewDetection}>{isParsing ? "Re-running…" : "Preview updated transactions"}</Button>
                      <Button size="xs" disabled={isParsing || !preview} onClick={applyDetection}>Apply changes and review</Button>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}

            {mode === "diagnostics" && (
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <div className="mx-auto max-w-5xl space-y-3">
                  <section className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-medium">Parsing summary</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">What Actual Bench used to read this statement.</p>
                      </div>
                      <Button size="xs" variant="outline" onClick={() => setMode(detectionIssues.length ? "adjust" : "review")}>Back to {detectionIssues.length ? "detection" : "transactions"}</Button>
                    </div>
                    <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                      <Metric label="Pages read" value={`${parsed.metrics.transactionPages} of ${parsed.metrics.pages}`} />
                      <Metric label="Transactions" value={String(parsed.metrics.transactions)} />
                      <Metric label="Ready" value={String(parsed.metrics.accepted)} tone="positive" />
                      <Metric label="Needs review" value={String(parsed.metrics.review + parsed.metrics.rejected)} tone={parsed.metrics.review + parsed.metrics.rejected ? "warning" : "normal"} />
                      <Metric label="Account type" value={accountTypeLabel(parsed.accountType)} />
                    </dl>
                    {(parsed.warnings.length > 0 || detectionIssues.length > 0) && (
                      <ul className="mt-3 space-y-1 border-t pt-2 text-xs">
                        {[...new Set([...detectionIssues, ...parsed.warnings])].map((warning) => (
                          <li key={warning} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{warning}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Layout versions and validation</summary>
                    <p className="mt-1 text-xs text-muted-foreground">Saved layouts contain geometry and roles, not customer names, account numbers, or transaction text.</p>
                    <div className="mt-3 space-y-2">
                      {profileMatches.map(({ option, profile, current, match }) => (
                        <div key={`${option.recordId}-${profile.id}`} className="rounded border p-2 text-xs">
                          <div className="flex items-center gap-2"><span className="font-medium">{option.bankName} · {profile.name} v{profile.profileVersion}{current ? " (current)" : ""}</span><span className="text-muted-foreground">{match?.outcome} · {Math.round((match?.score ?? 0) * 100)}%</span><Button className="ml-auto" size="xs" variant="outline" disabled={match?.outcome === "conflicting"} onClick={() => applyProfile(option, profile)}>Apply and validate</Button></div>
                          <p className="mt-1 text-muted-foreground">{match?.reasons.join("; ")}</p>
                        </div>
                      ))}
                      {profiles.length === 0 && <p className="text-sm text-muted-foreground">No saved statement layouts.</p>}
                    </div>
                  </details>
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Technical diagnostics</summary>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">Contains stage names, counts, and page numbers only. Statement text and source IDs are not copied.</p>
                      <Button className="ml-auto" size="xs" variant="outline" onClick={copyDiagnostics}><Copy aria-hidden="true" className="mr-1 size-3" />Copy diagnostics</Button>
                    </div>
                    <ol className="mt-3 space-y-1 font-mono text-[11px]">
                      {parsed.diagnostics.map((event, index) => <li key={`${event.stage}-${event.code}-${index}`}>{event.stage}: {event.code} {JSON.stringify(event.metrics ?? {})}</li>)}
                    </ol>
                  </details>
                </div>
              </div>
            )}

            {saveProfileOpen && (
              <PdfProfileSaveDialog
                open
                onOpenChange={setSaveProfileOpen}
                banks={[...profilesByBank.keys()]}
                initialBankName={selectedProfile?.bankName ?? ""}
                initialProfileName={selectedProfile?.envelope.profile.name ?? ""}
                accountName={accountName}
                isSaving={isSavingProfile}
                onSave={async ({ bankName, profileName, assignToAccount }) => {
                  if (!onSaveProfile) return;
                  try {
                    const saved = await onSaveProfile({ bankName, profileName, assignToAccount, result: parsed });
                    if (saved) {
                      setSelectedProfileId(saved.profileId);
                      setAppliedProfileVersion(saved.profileVersion);
                    }
                    setSaveProfileOpen(false);
                    toast.success("Statement layout saved", {
                      description: `${bankName} · ${profileName}`,
                    });
                  } catch (error) {
                    setParserError(error instanceof Error ? error.message : "The statement layout could not be saved.");
                  }
                }}
              />
            )}
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
              <Button className="shrink-0" size="xs" variant="outline" disabled={selectedHasRejected || selectedReviewIds.length === 0} onClick={() => structuralCorrection({ kind: "accept-transaction", transactionIds: selectedReviewIds })}>Mark {selectedReviewIds.length} reviewed</Button>
              <Button className="shrink-0" size="xs" variant="outline" onClick={() => structuralCorrection({ kind: "set-direction", transactionIds: [...selectedIds], direction: "debit" })}>Money out</Button>
              <Button className="shrink-0" size="xs" variant="outline" onClick={() => structuralCorrection({ kind: "set-direction", transactionIds: [...selectedIds], direction: "credit" })}>Money in</Button>
              <Button className="shrink-0" size="xs" variant="outline" disabled={[...selectedIds].some((id) => rows.find((row) => row.id === id)?.direction === "unknown")} onClick={() => structuralCorrections([...selectedIds].flatMap((id) => { const row = rows.find((entry) => entry.id === id); return row && row.direction !== "unknown" ? [{ kind: "set-direction" as const, transactionIds: [id], direction: row.direction === "debit" ? "credit" as const : "debit" as const }] : []; }))}>Reverse</Button>
              <Button className="shrink-0" size="xs" variant="outline" disabled={selectedIds.size < 2} onClick={() => structuralCorrection({ kind: "merge-blocks", blockIds: [...selectedIds] })}><GitMerge className="mr-1 size-3" />Merge rows</Button>
              <Button className="shrink-0" size="xs" variant="outline" onClick={() => structuralCorrections([...selectedIds].map((blockId) => ({ kind: "ignore-block", blockId })))}><Trash2 className="mr-1 size-3" />Ignore</Button>
              <Button className="shrink-0" size="xs" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
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
              {blockingCount > 0 ? <span className="text-destructive">Resolve {blockingCount} rejected {blockingCount === 1 ? "transaction" : "transactions"}.</span>
                : reviewCount > 0 ? <span className="text-amber-700 dark:text-amber-300">Check and mark {reviewCount} {reviewCount === 1 ? "transaction" : "transactions"} reviewed.</span>
                  : <span className="text-muted-foreground">All transactions are ready.</span>}
            </div>
          )}
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" disabled={isParsing} onClick={() => onOpenChange(false)}>Cancel</Button>
            {!parsed.likelyScanned && <Button disabled={isParsing || rows.length === 0 || blockingCount > 0 || reviewCount > 0} onClick={() => onImport(rows, parsed)}>Use {rows.length} {rows.length === 1 ? "transaction" : "transactions"}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initialModeForResult(
  result: PdfStatementParseResult | null,
  profileNeedsReview = false
): WorkbenchMode {
  if (profileNeedsReview || !result || result.transactions.length === 0) return "adjust";
  return result.metrics.rejected / result.transactions.length > 0.5 ? "adjust" : "review";
}

function initialReviewFilter(result: PdfStatementParseResult | null): ReviewCategory {
  return result && result.metrics.review + result.metrics.rejected > 0 ? "needs-review" : "all";
}

function detectionIssuesFor(
  result: PdfStatementParseResult | null,
  guidance: PdfParserGuidance | null,
  profileNotice: string | null
) {
  if (!result || !guidance) return ["No detection result is available."];
  const issues: string[] = [];
  if (profileNotice) issues.push(profileNotice);
  if (!guidance.regions.some((region) => region.included && region.kind === "transactions")) {
    issues.push("Select at least one transaction area.");
  }
  if (!guidance.columns.some((column) => ["transaction-date", "posting-date", "value-date"].includes(column.role))) {
    issues.push("Map the statement date column.");
  }
  if (!guidance.columns.some((column) => ["amount", "debit", "credit"].includes(column.role))) {
    issues.push("Map the account amount, money-out, or money-in column.");
  }
  if (result.transactions.length > 0 && result.metrics.rejected / result.transactions.length > 0.5) {
    issues.push("Most detected transactions have unresolved required fields.");
  }
  return [...new Set(issues)];
}

function PdfProfileSaveDialog({
  open,
  onOpenChange,
  banks,
  initialBankName,
  initialProfileName,
  accountName,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: string[];
  initialBankName: string;
  initialProfileName: string;
  accountName: string;
  isSaving: boolean;
  onSave: (input: { bankName: string; profileName: string; assignToAccount: boolean }) => Promise<void>;
}) {
  const [bankName, setBankName] = useState(initialBankName);
  const [profileName, setProfileName] = useState(initialProfileName);
  const [assignToAccount, setAssignToAccount] = useState(true);

  const valid = Boolean(bankName.trim() && profileName.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save statement layout</DialogTitle>
          <DialogDescription>
            Layouts are shared across budgets and accounts. They store detection settings only, not statement data.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Bank</span>
            <input
              list="pdf-detection-bank-names"
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              placeholder="For example, HSBC Bank"
              className="h-9 rounded-md border bg-background px-3"
              autoFocus
            />
            <datalist id="pdf-detection-bank-names">
              {banks.map((bank) => <option key={bank} value={bank} />)}
            </datalist>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Layout name</span>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="For example, Credit card"
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={assignToAccount}
              onCheckedChange={(checked) => setAssignToAccount(checked === true)}
            />
            Use this layout for {accountName}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={isSaving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || isSaving} onClick={() => void onSave({
            bankName: bankName.trim(),
            profileName: profileName.trim(),
            assignToAccount,
          })}>{isSaving ? "Saving…" : "Save layout"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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

const SummaryBar = memo(function SummaryBar({ result, totals }: { result: PdfStatementParseResult; totals: { credits: number; debits: number } }) {
  const dates = result.transactions.map((row) => row.importDate).filter((date): date is string => Boolean(date)).sort();
  return (
    <section aria-label="PDF parse summary" className="ml-2 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap border-l pl-3 text-[11px]">
      <div className="flex items-center gap-3">
        <Metric label="Transactions" value={String(result.transactions.length)} />
        <Metric label="Import dates" value={dates.length ? `${dates[0]}${dates.length > 1 ? ` to ${dates.at(-1)}` : ""}` : "Unresolved"} />
      </div>
      <SummaryDivider />
      <div className="flex items-center gap-3">
        <Metric label="Money in" value={`+${formatMinorUnits(totals.credits)}`} tone="positive" />
        <Metric label="Money out" value={formatMinorUnits(-totals.debits)} tone="negative" />
        <Metric label="Net change" value={formatSignedMinorUnits(totals.credits - totals.debits)} tone={totals.credits - totals.debits > 0 ? "positive" : totals.credits - totals.debits < 0 ? "negative" : "normal"} />
      </div>
      <SummaryDivider />
      <Metric label="Needs review" value={String(result.metrics.review + result.metrics.rejected)} tone={result.metrics.review + result.metrics.rejected ? "warning" : "normal"} />
      <SummaryDivider />
      <span className="text-muted-foreground">{accountTypeLabel(result.accountType)} · {result.metrics.transactionPages} of {result.metrics.pages} pages used</span>
    </section>
  );
});

function SummaryDivider() {
  return <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />;
}

function Metric({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "positive" | "negative" | "warning" }) {
  return <div className="flex items-baseline gap-1 whitespace-nowrap"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className={cn("font-semibold tabular-nums", tone === "positive" && "text-emerald-700 dark:text-emerald-400", tone === "negative" && "text-red-600 dark:text-red-400", tone === "warning" && "text-amber-700 dark:text-amber-300")}>{value}</dd></div>;
}

function PreviewComparisonMetric({
  label,
  before,
  after,
  tone = "normal",
}: {
  label: string;
  before: string;
  after?: string;
  tone?: "normal" | "info" | "positive" | "negative" | "warning";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
      <span className={cn(
        "mr-auto whitespace-nowrap font-medium",
        tone === "info" && "text-sky-700 dark:text-sky-300",
        tone === "positive" && "text-emerald-700 dark:text-emerald-300",
        tone === "negative" && "text-rose-700 dark:text-rose-300",
        tone === "warning" && "text-amber-700 dark:text-amber-300"
      )}>{label}</span>
      {after === undefined ? (
        <strong className="tabular-nums">{before}</strong>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 tabular-nums" title={`Current ${before}; preview ${after}`}>
          <span className="text-muted-foreground"><span className="sr-only">Current </span>{before}</span>
          <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          <strong><span className="sr-only">Preview </span>{after}</strong>
        </span>
      )}
    </div>
  );
}

function DetectionChangePreview({ diff }: { diff: ReturnType<typeof resultDiff> }) {
  return (
    <section aria-label="Detection change preview" className="mb-2 overflow-hidden rounded-md bg-background/70 text-[11px]">
      <div className="flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide text-foreground">Preview impact</span>
        <span>Current <ArrowRight aria-hidden="true" className="mx-1 inline size-3" /> Preview</span>
      </div>
      <div aria-label="Detection count comparison" className="grid grid-cols-3 divide-x divide-border/60 bg-muted/25">
        <PreviewComparisonMetric label="Rows changed" before={String(diff.changed)} />
        <PreviewComparisonMetric label="Transactions" before={String(diff.before)} after={String(diff.after)} tone="info" />
        <PreviewComparisonMetric label="Needs review" before={String(diff.beforeReview)} after={String(diff.afterReview)} tone="warning" />
      </div>
      <div aria-label="Detection amount comparison" className="grid grid-cols-2 divide-x divide-border/60 bg-muted/10">
        <PreviewComparisonMetric label="Money in" before={formatSignedMinorUnits(diff.beforeCredits)} after={formatSignedMinorUnits(diff.afterCredits)} tone="positive" />
        <PreviewComparisonMetric label="Money out" before={formatMinorUnits(-diff.beforeDebits)} after={formatMinorUnits(-diff.afterDebits)} tone="negative" />
      </div>
    </section>
  );
}

const ReviewToolbar = memo(function ReviewToolbar({ rows, filter, setFilter, search, setSearch }: { rows: PdfTransactionProposal[]; filter: ReviewCategory; setFilter: (filter: ReviewCategory) => void; search: string; setSearch: (value: string) => void }) {
  const reviewCategories: [ReviewCategory, string][] = [
    ["structure", "Structure"],
    ["dates", "Dates"],
    ["amounts", "Amounts & direction"],
    ["reconciliation", "Reconciliation"],
    ["duplicates", "Duplicates"],
  ];
  const count = (category: ReviewCategory) => rows.filter((row) => matchesCategory(row, category)).length;
  const needsReviewCount = count("needs-review");
  const visibleReviewCategories = reviewCategories.map(([value, label]) => ({ value, label, count: count(value) })).filter((category) => category.count > 0);
  const manualCount = count("manual");
  const issueFilterActive = filter === "needs-review" || visibleReviewCategories.some((category) => category.value === filter);
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b px-4 py-1.5">
      <div className="flex shrink-0 items-center gap-1" aria-label="Review filters">
        <ReviewFilterButton label="All" count={count("all")} active={filter === "all"} onClick={() => setFilter("all")} />
        <ReviewFilterButton label="Needs review" count={needsReviewCount} active={filter === "needs-review"} onClick={() => setFilter("needs-review")} />
        <ReviewFilterButton label="Ready" count={count("ready")} active={filter === "ready"} onClick={() => setFilter("ready")} />
        {issueFilterActive && visibleReviewCategories.length > 0 && (
          <div role="group" aria-label="Needs review filters" className="flex items-center gap-1">
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
            {visibleReviewCategories.map((category) => (
              <ReviewFilterButton key={category.value} label={category.label} count={category.count} active={filter === category.value} onClick={() => setFilter(category.value)} />
            ))}
          </div>
        )}
        {manualCount > 0 && <ReviewFilterButton label="Manual changes" count={manualCount} active={filter === "manual"} onClick={() => setFilter("manual")} />}
      </div>
      <label className="relative ml-auto min-w-48 flex-1 sm:max-w-72">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Search parsed transactions</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs" />
      </label>
    </div>
  );
});

function ReviewFilterButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-muted"
      )}
    >
      {label} <span className="tabular-nums">{count}</span>
    </button>
  );
}

type TransactionField = "transactionDate" | "postedDate" | "valueDate" | "importDate" | "description" | "reference" | "amount" | "currency";

type TransactionTableProps = {
  rows: PdfTransactionProposal[];
  result: PdfStatementParseResult;
  selectedIds: Set<string>;
  allVisibleSelected: boolean;
  selectAllRef: React.RefObject<HTMLInputElement | null>;
  onToggleAll: () => void;
  onToggle: (id: string, checked: boolean) => void;
  onDirection: (row: PdfTransactionProposal, direction: "debit" | "credit") => void;
  onField: (row: PdfTransactionProposal, field: TransactionField, value: string | null) => void;
  onSource: (row: PdfTransactionProposal, field: keyof PdfTransactionProposal["confidence"]) => void;
  onAccept: (row: PdfTransactionProposal) => void;
  onIgnore: (row: PdfTransactionProposal) => void;
  onSplit: (row: PdfTransactionProposal) => void;
};

function TransactionTable({ rows, result, selectedIds, allVisibleSelected, selectAllRef, onToggleAll, onToggle, onDirection, onField, onSource, onAccept, onIgnore, onSplit }: TransactionTableProps) {
  const showPosting = result.guidance.columns.some((column) => column.role === "posting-date") || rows.some((row) => row.postedDate);
  const showValue = result.guidance.columns.some((column) => column.role === "value-date") || rows.some((row) => row.valueDate);
  const showBalance = result.guidance.columns.some((column) => column.role === "balance") && rows.some((row) => row.balance);
  const blocksById = useMemo(() => new Map(result.blocks.map((block) => [block.id, block])), [result.blocks]);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[1060px] table-fixed text-xs">
        <caption className="sr-only">Transactions extracted from the PDF statement</caption>
        <colgroup>
          <col className="w-9" /><col className="w-16" /><col className="w-32" />
          {showPosting && <col className="w-32" />}
          {showValue && <col className="w-32" />}
          <col /><col className="w-40" /><col className="w-24" />
          {showBalance && <col className="w-24" />}
          <col className="w-44" />
        </colgroup>
        <thead className="sticky top-0 z-20 bg-muted text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
          <tr className="[&>th]:bg-muted [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
            <th><input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} onChange={onToggleAll} aria-label={allVisibleSelected ? "Deselect all visible PDF rows" : "Select all visible PDF rows"} /></th>
            <th>Status</th>
            <DateHeader label="Transaction date" selected={result.guidance.importDate === "transaction"} />
            {showPosting && <DateHeader label="Posting date" selected={result.guidance.importDate === "posting"} />}
            {showValue && <DateHeader label="Value date" selected={result.guidance.importDate === "value"} />}
            <th className="text-left">Description</th>
            <th className="text-right">Amount <span className="block text-[10px] font-normal">Click sign to reverse</span></th>
            <th>Currency</th>
            {showBalance && <th className="text-right">Balance</th>}
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              row={row}
              block={blocksById.get(row.id)}
              selected={selectedIds.has(row.id)}
              showPosting={showPosting}
              showValue={showValue}
              showBalance={showBalance}
              onToggle={onToggle}
              onDirection={onDirection}
              onField={onField}
              onSource={onSource}
              onAccept={onAccept}
              onIgnore={onIgnore}
              onSplit={onSplit}
            />
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No transactions match this view.</p>}
    </div>
  );
}

type TransactionRowProps = Pick<TransactionTableProps, "onToggle" | "onDirection" | "onField" | "onSource" | "onAccept" | "onIgnore" | "onSplit"> & {
  row: PdfTransactionProposal;
  block: PdfStatementParseResult["blocks"][number] | undefined;
  selected: boolean;
  showPosting: boolean;
  showValue: boolean;
  showBalance: boolean;
};

const TransactionRow = memo(function TransactionRow({ row, block, selected, showPosting, showValue, showBalance, onToggle, onDirection, onField, onSource, onAccept, onIgnore, onSplit }: TransactionRowProps) {
  const details = financialDetails(row);
  return (
    <tr className={cn("border-b", selected && "bg-accent/60", !selected && row.status === "rejected" && "bg-destructive/5", !selected && row.status === "review" && "bg-amber-500/5")}>
      <td className="px-2 py-0.5 text-center"><Checkbox checked={selected} onCheckedChange={(value) => onToggle(row.id, value === true)} aria-label={`Select PDF row ${row.sourceRowNumber}`} /></td>
      <td className="px-1 text-center"><TransactionStatus status={row.status} reasons={row.issueCodes} /></td>
      <EditableDate row={row} field="transactionDate" value={row.transactionDate} confidence="transactionDate" onField={onField} onSource={onSource} />
      {showPosting && <EditableDate row={row} field="postedDate" value={row.postedDate} confidence="postingDate" onField={onField} onSource={onSource} />}
      {showValue && <EditableDate row={row} field="valueDate" value={row.valueDate} confidence="valueDate" onField={onField} onSource={onSource} />}
      <td className="p-0.5"><div className="flex"><input key={`${row.id}-description-${row.description}`} aria-label={`Description for PDF row ${row.sourceRowNumber}`} defaultValue={row.description} onBlur={(event) => event.target.value !== row.description && onField(row, "description", event.target.value)} className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 focus:border-input focus:bg-background" /><button type="button" title="Show description in statement" className="px-1 text-muted-foreground hover:text-foreground" aria-label={`Show description in statement for PDF row ${row.sourceRowNumber}`} onClick={() => onSource(row, "description")}><Eye className="size-3.5" /></button></div>{details && <p className="truncate px-1 text-[10px] text-muted-foreground" title={details}>{details}</p>}</td>
      <td className="p-0.5"><div className="flex h-7 overflow-hidden rounded border border-transparent focus-within:border-input focus-within:bg-background"><button type="button" onClick={() => onDirection(row, row.direction === "debit" ? "credit" : "debit")} aria-label={row.direction === "debit" ? `Change row ${row.sourceRowNumber} to money in` : `Change row ${row.sourceRowNumber} to money out`} className={cn("w-7 border-r font-semibold", row.direction === "debit" ? "text-red-600" : row.direction === "credit" ? "text-emerald-700" : "text-amber-700")}>{row.direction === "debit" ? "−" : row.direction === "credit" ? "+" : "?"}</button><input key={`${row.id}-amount-${row.amount}`} aria-label={`Amount for PDF row ${row.sourceRowNumber}`} defaultValue={row.amount.replace(/^[+-]/, "")} onBlur={(event) => event.target.value !== row.amount.replace(/^[+-]/, "") && onField(row, "amount", `${row.direction === "debit" ? "-" : ""}${event.target.value}`)} className="min-w-0 flex-1 bg-transparent px-2 text-right tabular-nums outline-none" /><button type="button" title="Show amount in statement" className="px-1 text-muted-foreground hover:text-foreground" aria-label={`Show amount in statement for PDF row ${row.sourceRowNumber}`} onClick={() => onSource(row, "accountAmount")}><Eye className="size-3.5" /></button></div></td>
      <td className="p-0.5"><div className="flex"><input key={`${row.id}-currency-${row.currency ?? ""}`} aria-label={`Currency for PDF row ${row.sourceRowNumber}`} defaultValue={row.currency ?? ""} maxLength={3} onBlur={(event) => event.target.value.toUpperCase() !== (row.currency ?? "") && onField(row, "currency", event.target.value.toUpperCase() || null)} className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-center uppercase focus:border-input focus:bg-background" /><button type="button" title="Show currency in statement" className="px-1 text-muted-foreground hover:text-foreground" aria-label={`Show currency in statement for PDF row ${row.sourceRowNumber}`} onClick={() => onSource(row, "currency")}><Eye className="size-3.5" /></button></div></td>
      {showBalance && <td className="px-2 text-right tabular-nums text-muted-foreground">{row.balance ? formatGroupedDecimal(row.balance) : "-"}</td>}
      <td className="p-0.5"><div className="flex justify-end gap-1">{row.status === "review" && <Button size="xs" variant="outline" onClick={() => onAccept(row)}>Mark reviewed</Button>}{block && block.rowIds.length > 1 && <Button size="icon-sm" variant="ghost" aria-label={`Split PDF row ${row.sourceRowNumber}`} onClick={() => onSplit(row)}><Split className="size-3.5" /></Button>}<Button size="icon-sm" variant="ghost" aria-label={`Ignore PDF row ${row.sourceRowNumber}`} onClick={() => onIgnore(row)}><Trash2 className="size-3.5" /></Button></div></td>
    </tr>
  );
}, (previous, next) => previous.row === next.row
  && previous.block === next.block
  && previous.selected === next.selected
  && previous.showPosting === next.showPosting
  && previous.showValue === next.showValue
  && previous.showBalance === next.showBalance);

function EditableDate({ row, field, value, confidence, onField, onSource }: { row: PdfTransactionProposal; field: "transactionDate" | "postedDate" | "valueDate"; value: string | null; confidence: keyof PdfTransactionProposal["confidence"]; onField: (row: PdfTransactionProposal, field: "transactionDate" | "postedDate" | "valueDate" | "importDate", value: string | null) => void; onSource: (row: PdfTransactionProposal, field: keyof PdfTransactionProposal["confidence"]) => void }) {
  const label = field === "transactionDate" ? "Transaction" : field === "postedDate" ? "Posting" : "Value";
  return <td className="p-0.5"><div className="flex"><input key={`${row.id}-${field}-${value ?? ""}`} aria-label={`${label} date for PDF row ${row.sourceRowNumber}`} type="date" defaultValue={value ?? ""} onBlur={(event) => { const next = event.target.value || null; if (next !== value) onField(row, field, next); }} className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 tabular-nums focus:border-input focus:bg-background" /><button type="button" title={`Show ${label.toLowerCase()} date in statement`} className="px-1 text-muted-foreground hover:text-foreground" aria-label={`Show ${field} in statement for PDF row ${row.sourceRowNumber}`} onClick={() => onSource(row, confidence)}><Eye className="size-3.5" /></button></div></td>;
}

function TransactionStatus({ status, reasons }: { status: PdfTransactionProposal["status"]; reasons: PdfConfidenceReason[] }) {
  const label = status === "accepted" ? "Ready" : status === "rejected" ? "Fix" : "Review";
  const title = status === "accepted" ? "Transaction is ready" : reasonText(reasons);
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        status === "accepted" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "review" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        status === "rejected" && "bg-destructive/10 text-destructive"
      )}
    >
      {status === "accepted" ? <CheckCircle2 aria-hidden="true" className="size-3" /> : <AlertTriangle aria-hidden="true" className="size-3" />}
      {label}
    </span>
  );
}

function DateHeader({ label, selected }: { label: string; selected: boolean }) { return <th className="text-left"><span className="inline-flex items-center gap-1">{selected && <CalendarCheck className="size-3.5 text-foreground" />}{label}</span></th>; }

function DetectionControls({ guidance, accountType, onChange }: { guidance: PdfParserGuidance; accountType: PdfAccountType; onChange: (patch: Partial<PdfParserGuidance>) => void }) {
  const [open, setOpen] = useState(true);
  const importDateLabel = guidance.importDate === "transaction" ? "Transaction date" : guidance.importDate === "posting" ? "Posting date" : "Value date";
  return (
    <details className="rounded-md border px-3 py-2" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">
        <span>Statement interpretation</span>
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">{accountTypeLabel(accountType)} · {guidance.currency ?? "currency automatic"} · import {importDateLabel.toLowerCase()}</span>
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">Use these controls when the automatic date, number, account, or amount interpretation is wrong.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Control label="Account type"><select value={guidance.accountType} onChange={(event) => onChange({ accountType: event.target.value as PdfParserGuidance["accountType"] })} className="h-8 rounded border bg-background px-2"><option value="auto">Auto-detect ({accountTypeLabel(accountType)})</option>{["checking", "savings", "credit-card", "prepaid", "multi-currency", "business-cash", "loan", "investment"].map((value) => <option key={value} value={value}>{accountTypeLabel(value as PdfAccountType)}</option>)}</select></Control>
        <Control label="Statement currency"><input value={guidance.currency ?? ""} maxLength={3} placeholder="Detect or enter ISO code" onChange={(event) => onChange({ currency: event.target.value.toUpperCase() || null })} className="h-8 rounded border bg-background px-2 uppercase" /></Control>
        <Control label="Use as import date"><select value={guidance.importDate} onChange={(event) => onChange({ importDate: event.target.value as PdfImportDate })} className="h-8 rounded border bg-background px-2"><option value="transaction">Transaction date</option><option value="posting">Posting date</option><option value="value">Value date</option></select></Control>
        <Control label="Amount direction"><select value={guidance.unsignedDirection} onChange={(event) => onChange({ unsignedDirection: event.target.value as PdfParserGuidance["unsignedDirection"] })} className="h-8 rounded border bg-background px-2"><option value="review">Use signs or DR/CR; review unmarked</option><option value="debit">CR = money in; unmarked = money out</option><option value="credit">DR = money out; unmarked = money in</option></select></Control>
        <Control label="Statement starts"><input type="date" value={guidance.statementPeriod.start ?? ""} onChange={(event) => onChange({ statementPeriod: { ...guidance.statementPeriod, start: event.target.value || null } })} className="h-8 rounded border bg-background px-2" /></Control>
        <Control label="Statement ends"><input type="date" value={guidance.statementPeriod.end ?? ""} onChange={(event) => onChange({ statementPeriod: { ...guidance.statementPeriod, end: event.target.value || null } })} className="h-8 rounded border bg-background px-2" /></Control>
        <Control label="Date format"><select value={guidance.dateFormat} onChange={(event) => onChange({ dateFormat: event.target.value as PdfDateFormatOption })} className="h-8 rounded border bg-background px-2">{DATE_FORMATS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Control>
        <Control label="Number format"><select value={guidance.numberFormat} onChange={(event) => onChange({ numberFormat: event.target.value as PdfNumberFormat })} className="h-8 rounded border bg-background px-2">{NUMBER_FORMATS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Control>
      </div>
    </details>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) { return <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">{label}{children}</label>; }

function PageControls({ pageNumber, pageCount, onChange }: { pageNumber: number; pageCount: number; onChange: (page: number) => void }) { return <div className="flex items-center gap-1"><Button size="icon-sm" variant="outline" aria-label="Previous PDF page" disabled={pageNumber <= 1} onClick={() => onChange(pageNumber - 1)}><ChevronLeft className="size-3.5" /></Button><span className="min-w-20 text-center text-xs">Page {pageNumber} of {pageCount}</span><Button size="icon-sm" variant="outline" aria-label="Next PDF page" disabled={pageNumber >= pageCount} onClick={() => onChange(pageNumber + 1)}><ChevronRight className="size-3.5" /></Button></div>; }

function matchesCategory(row: PdfTransactionProposal, category: ReviewCategory) {
  if (category === "all") return true;
  if (category === "needs-review") return row.status !== "accepted";
  if (category === "ready") return row.status === "accepted";
  if (category === "manual") return row.issueCodes.includes("ROW_MANUALLY_CHANGED");
  if (row.status === "accepted") return false;
  if (category === "structure") return row.issueCodes.some((reason) => (reason.startsWith("ROW_") && reason !== "ROW_MANUALLY_CHANGED") || reason === "PAGE_IMAGE_ONLY");
  if (category === "dates") return row.issueCodes.some((reason) => reason.startsWith("DATE_"));
  if (category === "amounts") return row.issueCodes.some((reason) => reason.startsWith("AMOUNT_") || reason.startsWith("DIRECTION_") || reason.startsWith("CURRENCY_"));
  if (category === "reconciliation") return row.issueCodes.some((reason) => reason.startsWith("BALANCE_"));
  if (category === "duplicates") return row.issueCodes.includes("POSSIBLE_DUPLICATE");
  return false;
}

function isActionableReason(reason: PdfConfidenceReason) {
  return ![
    "AMOUNT_FROM_MAPPED_COLUMN",
    "DIRECTION_FROM_DEBIT_COLUMN",
    "DIRECTION_FROM_CREDIT_COLUMN",
    "DIRECTION_FROM_MARKER",
    "DIRECTION_FROM_SIGN",
    "DIRECTION_FROM_BALANCE",
    "DIRECTION_FROM_SECTION",
    "DIRECTION_EXPLICIT_POLICY",
    "BALANCE_RECONCILED",
    "ROW_MANUALLY_CHANGED",
  ].includes(reason);
}

function reasonText(reasons: PdfConfidenceReason[]) { return reasons.map((reason) => ({ DATE_AMBIGUOUS_ORDER: "Date order is ambiguous", DATE_YEAR_INFERRED_FROM_PERIOD: "Year was inferred from the statement period", DATE_INHERITED_FROM_PREVIOUS_ROW: "Date was inherited from the previous statement row", DATE_OUTSIDE_STATEMENT_PERIOD: "Date is outside the statement period", DATE_INVALID: "Date could not be read", AMOUNT_MULTIPLE_CANDIDATES: "More than one amount could apply", AMOUNT_DEBIT_CREDIT_CONFLICT: "Both money-out and money-in columns contain values", AMOUNT_FROM_MAPPED_COLUMN: "Amount came from the mapped column", AMOUNT_FORMAT_AMBIGUOUS: "Number format is ambiguous", AMOUNT_MISSING: "Amount is missing", AMOUNT_ZERO: "Amount must not be zero", CURRENCY_AMBIGUOUS: "Currency is not confirmed", CURRENCY_MINOR_UNIT_MISMATCH: "Amount precision does not match the currency", ACTUAL_PRECISION_UNSUPPORTED: "Actual cannot import this amount without losing decimal precision", DIRECTION_FROM_DEBIT_COLUMN: "Direction came from the money-out column", DIRECTION_FROM_CREDIT_COLUMN: "Direction came from the money-in column", DIRECTION_FROM_MARKER: "Direction came from a DR/CR marker", DIRECTION_FROM_SIGN: "Direction came from the printed sign", DIRECTION_FROM_BALANCE: "Direction came from the balance change", DIRECTION_FROM_SECTION: "Direction came from the statement section", DIRECTION_EXPLICIT_POLICY: "Direction follows your unsigned-amount policy", DIRECTION_UNRESOLVED: "Money in or money out is unresolved", DIRECTION_EVIDENCE_CONFLICT: "Printed direction evidence conflicts", BALANCE_RECONCILED: "Amount reconciles to the running balance", BALANCE_MISMATCH: "Amount does not reconcile to the running balance", ROW_CONTINUATION_UNCERTAIN: "Transaction grouping needs confirmation", ROW_IN_NON_TRANSACTION_SECTION: "Row may be outside the transaction table", ROW_MANUALLY_CHANGED: "Manually changed", PROFILE_LAYOUT_DRIFT: "Saved layout no longer aligns", PAGE_IMAGE_ONLY: "Page has no usable text", POSSIBLE_DUPLICATE: "Possible duplicate", STATEMENT_SUMMARY_MISMATCH: "Parsed totals do not match the statement summary", CROSS_PAGE_SEQUENCE_CHANGED: "Date order changes across pages", ACCOUNT_TYPE_SPECIALIZED: "This account type needs specialized review", DESCRIPTION_MISSING: "Description is missing" } satisfies Record<PdfConfidenceReason, string>)[reason]).join("; "); }

function transactionTotals(rows: PdfTransactionProposal[]) { return rows.reduce((total, row) => { const units = minorUnits(row.amount); if (units > 0) total.credits += units; if (units < 0) total.debits += Math.abs(units); return total; }, { credits: 0, debits: 0 }); }
function formatSignedMinorUnits(value: number) { return `${value > 0 ? "+" : ""}${formatMinorUnits(value)}`; }
function minorUnits(value: string) { const match = value.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/); if (!match) return 0; return Number(`${match[1]}${match[2]}${(match[3] ?? "").padEnd(2, "0")}`); }
function formatGroupedDecimal(value: string) { const match = value.match(/^([+-]?)(\d+)(\.\d+)?$/); return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}` : value; }
function formatTableAmount(value: string) { return formatGroupedDecimal(value.replace(/^[+-]/, "")); }
function normalizeTableAmountInput(value: string) { const sign = value.startsWith("-") ? "-" : ""; const unsigned = value.replace(/^[+-]/, "").trim(); return /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(unsigned) ? `${sign}${unsigned.replaceAll(",", "")}` : value; }
function accountTypeLabel(type: PdfAccountType) { return ({ "credit-card": "Credit card", checking: "Checking / current", savings: "Savings", prepaid: "Prepaid card / wallet", "multi-currency": "Multi-currency account", "business-cash": "Business cash account", loan: "Loan / line of credit", investment: "Investment statement", unknown: "Account type not identified" } satisfies Record<PdfAccountType, string>)[type]; }
function pageForSourceIds(result: PdfStatementParseResult | null, sourceIds: string[], fallback: number) {
  if (!result || sourceIds.length === 0) return fallback;
  const ids = new Set(sourceIds);
  const matches = result.reconstructedPages.map((page) => ({
    pageNumber: page.pageNumber,
    matches: page.tokens.filter((token) => ids.has(token.id)).length,
  })).filter((page) => page.matches > 0).sort((left, right) => right.matches - left.matches || left.pageNumber - right.pageNumber);
  return matches[0]?.pageNumber ?? fallback;
}
function financialDetails(row: PdfTransactionProposal) { const values = [row.originalAmount ? `Original ${formatExactMoney(row.originalAmount)}` : null, row.exchangeRate ? `Rate ${row.exchangeRate}` : null, row.fees.length ? `Fees ${row.fees.map(formatExactMoney).join(" + ")}` : null, row.vat.length ? `VAT ${row.vat.map(formatExactMoney).join(" + ")}` : null].filter(Boolean); return values.join(" · "); }
function formatExactMoney(value: NonNullable<PdfTransactionProposal["exactAmount"]>) { const coefficient = BigInt(value.coefficient); const magnitude = (coefficient < BigInt(0) ? -coefficient : coefficient).toString().padStart(value.scale + 1, "0"); const decimal = value.scale ? `${magnitude.slice(0, -value.scale)}.${magnitude.slice(-value.scale)}` : magnitude; return `${value.currency ? `${value.currency} ` : ""}${decimal}`; }
function resultDiff(before: PdfStatementParseResult, after: PdfStatementParseResult) { const beforeRows = new Map(before.transactions.map((row) => [row.id, row])); const afterRows = new Map(after.transactions.map((row) => [row.id, row])); const ids = new Set([...beforeRows.keys(), ...afterRows.keys()]); const changed = [...ids].filter((id) => { const left = beforeRows.get(id); const right = afterRows.get(id); return !left || !right || left.transactionDate !== right.transactionDate || left.postedDate !== right.postedDate || left.valueDate !== right.valueDate || left.description !== right.description || left.amount !== right.amount || left.currency !== right.currency || left.status !== right.status; }).length; const beforeTotals = transactionTotals(before.transactions); const afterTotals = transactionTotals(after.transactions); return { before: before.transactions.length, after: after.transactions.length, changed, beforeReview: before.metrics.review + before.metrics.rejected, afterReview: after.metrics.review + after.metrics.rejected, beforeCredits: beforeTotals.credits, afterCredits: afterTotals.credits, beforeDebits: beforeTotals.debits, afterDebits: afterTotals.debits }; }
function newColumnBounds(columns: PdfColumn[], pageNumber: number, pageWidth: number) {
  const edgePadding = Math.max(6, pageWidth * 0.01);
  const gap = Math.max(8, pageWidth * 0.012);
  const preferredWidth = Math.min(72, Math.max(50, pageWidth * 0.1));
  const minimumWidth = Math.min(40, preferredWidth);
  const intervals = columns
    .filter((column) => column.pageNumber === null || column.pageNumber === pageNumber)
    .map((column) => {
      const scale = column.referencePageWidth && column.referencePageWidth > 0 ? pageWidth / column.referencePageWidth : 1;
      return { start: Math.max(edgePadding, column.xStart * scale), end: Math.min(pageWidth - edgePadding, column.xEnd * scale) };
    })
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start)
    .reduce<{ start: number; end: number }[]>((merged, interval) => {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ ...interval });
      return merged;
    }, []);

  if (intervals.length === 0) {
    const center = pageWidth / 2;
    return { xStart: center - preferredWidth / 2, xEnd: center + preferredWidth / 2 };
  }

  const lastEnd = intervals.at(-1)!.end;
  const trailingStart = lastEnd + gap;
  const trailingEnd = Math.min(pageWidth - edgePadding, trailingStart + preferredWidth);
  if (trailingEnd - trailingStart >= minimumWidth) return { xStart: trailingStart, xEnd: trailingEnd };

  const openSpaces = [
    { start: edgePadding, end: intervals[0].start },
    ...intervals.slice(0, -1).map((interval, index) => ({ start: interval.end, end: intervals[index + 1].start })),
  ]
    .map((space) => ({ start: space.start + gap, end: space.end - gap }))
    .filter((space) => space.end - space.start >= minimumWidth)
    .sort((left, right) => (right.end - right.start) - (left.end - left.start));
  const available = openSpaces[0];
  if (available) return { xStart: available.start, xEnd: Math.min(available.end, available.start + preferredWidth) };

  const center = pageWidth / 2;
  return { xStart: Math.max(edgePadding, center - preferredWidth / 2), xEnd: Math.min(pageWidth - edgePadding, center + preferredWidth / 2) };
}
function boxesOverlap(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }) { return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) > 0 && Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)) > 0; }
