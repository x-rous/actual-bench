"use client";

import { ListPlus, ListRestart, SquareDashedMousePointer, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/uuid";
import type {
  PdfColumn,
  PdfColumnRole,
  PdfParserGuidance,
  PdfReconstructedPage,
  PdfRegion,
  PdfStatementParseResult,
} from "@/lib/reconciliation/statement/pdf";
import { formatMinorUnits } from "../lib/format";
import { boxesOverlap, type PdfResultDiff } from "../lib/pdfReviewTable";
import { PdfColumnMappingList } from "./PdfColumnMappingList";
import { PdfDetectionControls } from "./PdfDetectionControls";
import { PdfDetectionIssueList, type PdfDetectionIssue } from "./PdfDetectionIssueList";
import { PdfPageControls } from "./PdfPageControls";
import { PdfPanelNote, PdfPanelSection } from "./PdfPanelSection";
import { PdfSourcePreview } from "./PdfSourcePreview";
import { PdfStatementLayoutPanel } from "./PdfStatementLayoutPanel";

/**
 * Step one: how the statement is being read, with the page itself beside the
 * settings that describe it. Everything here is a draft until it is previewed
 * and applied, so the reader can be wrong about a setting without losing the
 * corrections they have already made.
 */
export function PdfDetectionStep({
  result,
  page,
  previewDataUrl,
  guidance,
  issues,
  warnings,
  busy,
  preview,
  previewDiff,
  drawingRegion,
  showColumnMappings,
  highlightedSourceIds,
  selectedSourceRowId,
  columnFocusRequest,
  controlFocus,
  interpretationOpen,
  zoom,
  columnExamples,
  layoutPanel,
  onZoomChange,
  onPageChange,
  onToggleDrawingRegion,
  onToggleColumnMappings,
  onSelectSourceRow,
  onInterpretationOpenChange,
  onResolveIssue,
  onUpdateDraft,
  onUpdateColumn,
  onAddColumn,
  onSettleColumns,
  onMoveColumn,
  onRemoveColumn,
  onFocusColumn,
  onMarkRow,
  onRestoreBlock,
  onReset,
  onPreview,
  onApply,
}: {
  result: PdfStatementParseResult;
  page: PdfReconstructedPage;
  previewDataUrl: string | null;
  guidance: PdfParserGuidance;
  issues: PdfDetectionIssue[];
  /** The parser's own warnings, which carry no control to focus. */
  warnings: string[];
  busy: boolean;
  preview: PdfStatementParseResult | null;
  previewDiff: PdfResultDiff | null;
  drawingRegion: boolean;
  showColumnMappings: boolean;
  highlightedSourceIds: Set<string>;
  selectedSourceRowId: string | null;
  columnFocusRequest: { columnId: string; requestId: number } | null;
  controlFocus: { id: string; requestId: number } | null;
  interpretationOpen: boolean;
  zoom: number;
  columnExamples: Map<string, string[]>;
  layoutPanel: React.ComponentProps<typeof PdfStatementLayoutPanel>;
  onZoomChange: (zoom: number) => void;
  onPageChange: (page: number) => void;
  onToggleDrawingRegion: () => void;
  onToggleColumnMappings: () => void;
  onSelectSourceRow: (rowId: string) => void;
  onInterpretationOpenChange: (open: boolean) => void;
  onResolveIssue: (issue: PdfDetectionIssue) => void;
  onUpdateDraft: (patch: Partial<PdfParserGuidance>) => void;
  onUpdateColumn: (id: string, patch: Partial<PdfColumn>) => void;
  onAddColumn: (afterId?: string) => void;
  /** Called once a boundary drag or nudge has finished. */
  onSettleColumns: () => void;
  onMoveColumn: (id: string, offset: -1 | 1) => void;
  onRemoveColumn: (id: string) => void;
  onFocusColumn: (column: PdfColumn) => void;
  onMarkRow: (rowId: string) => void;
  onRestoreBlock: (blockId: string) => void;
  onReset: () => void;
  onPreview: () => void;
  onApply: () => void;
}) {
  const ignoredBlocks = result.blocks.filter((block) => block.pageNumber === page.pageNumber && block.excluded);
  const canMarkSelectedRow = Boolean(selectedSourceRowId)
    && !result.blocks.some((block) => block.rowIds.includes(selectedSourceRowId!));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-auto lg:grid-cols-[minmax(0,58fr)_minmax(24rem,42fr)] lg:overflow-hidden">
        <div className="flex min-h-[26rem] flex-col border-b p-3 lg:min-h-0 lg:border-r lg:border-b-0">
          <PdfSourcePreview
            page={page}
            previewDataUrl={previewDataUrl}
            regions={guidance.regions.filter((region) => region.pageNumber === page.pageNumber)}
            columns={showColumnMappings ? guidance.columns : []}
            highlightedSourceIds={highlightedSourceIds}
            selectedRowId={selectedSourceRowId}
            calibration
            showPageMetadata={false}
            drawRegion={drawingRegion}
            zoom={zoom}
            onZoomChange={onZoomChange}
            columnMappingsVisible={showColumnMappings}
            onToggleColumnMappings={onToggleColumnMappings}
            focusColumnRequest={columnFocusRequest}
            onSelectRow={onSelectSourceRow}
            onColumnsSettled={onSettleColumns}
            onColumnMove={(columnId, bounds) => onUpdateColumn(columnId, bounds)}
            toolbarStart={
              <>
                <PdfPageControls
                  pageNumber={page.pageNumber}
                  pageCount={result.reconstructedPages.length}
                  onChange={onPageChange}
                />
                <Button
                  size="xs"
                  variant={drawingRegion ? "default" : "outline"}
                  disabled={busy}
                  onClick={onToggleDrawingRegion}
                >
                  <SquareDashedMousePointer aria-hidden="true" className="mr-1 size-3.5" />
                  {drawingRegion ? "Drag on the page" : "Select transaction area"}
                </Button>
              </>
            }
            toolbarEnd={
              <>
                {canMarkSelectedRow && (
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => onMarkRow(selectedSourceRowId!)}>
                    <ListPlus aria-hidden="true" className="mr-1 size-3.5" />
                    Mark selected row as transaction
                  </Button>
                )}
                <RestoreIgnoredRows blocks={ignoredBlocks} busy={busy} onRestore={onRestoreBlock} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {Math.round(page.coverage * 1000) / 10}% text coverage
                </span>
              </>
            }
            onToggleRegion={(regionId) => onUpdateDraft({
              regions: guidance.regions.map((region) => region.id === regionId
                ? { ...region, included: !region.included, kind: !region.included ? "transactions" : region.kind }
                : region),
            })}
            onColumnChange={(columnId, edge, value) => onUpdateColumn(
              columnId,
              edge === "start"
                ? { xStart: Math.min(value, guidance.columns.find((column) => column.id === columnId)?.xEnd ?? value) }
                : { xEnd: Math.max(value, guidance.columns.find((column) => column.id === columnId)?.xStart ?? value) }
            )}
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
              onUpdateDraft({
                regions: [
                  ...guidance.regions.filter((entry) => entry.pageNumber !== page.pageNumber || !entry.included),
                  region,
                ],
              });
              onToggleDrawingRegion();
            }}
          />
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
            <PdfDetectionIssueList
              label="What needs attention"
              issues={issues}
              extraMessages={warnings}
              onResolve={onResolveIssue}
            />
            <PdfStatementLayoutPanel {...layoutPanel} />
            <PdfDetectionControls
              guidance={guidance}
              accountType={result.accountType}
              focusRequest={controlFocus}
              open={interpretationOpen}
              disabled={busy}
              onOpenChange={onInterpretationOpenChange}
              onChange={onUpdateDraft}
            />

            <PdfPanelSection
              title="Column mapping"
              summary={`${guidance.columns.length} ${guidance.columns.length === 1 ? "column" : "columns"}`}
              action={
                <Button size="xs" variant="outline" disabled={busy} onClick={() => onAddColumn()}>Map another column</Button>
              }
            >
              <PdfPanelNote>
                Assign what each physical column means. Match its color to the PDF, move it left or right, or drag its
                edges to correct the boundary.
              </PdfPanelNote>
              <div>
                <PdfColumnMappingList
                  columns={guidance.columns}
                  examples={columnExamples}
                  disabled={busy}
                  onChangeRole={(id, role: PdfColumnRole) => onUpdateColumn(id, { role })}
                  onMove={onMoveColumn}
                  onInsertAfter={onAddColumn}
                  onRemove={onRemoveColumn}
                  onFocusColumn={onFocusColumn}
                />
              </div>
            </PdfPanelSection>
          </div>

          <div className="shrink-0 border-t bg-muted/20 px-4 py-3 text-xs">
            {preview && previewDiff && <PdfDetectionChangePreview diff={previewDiff} />}
            {/*
              Applying is not a commitment: nothing reaches the budget file
              until the import at the end, and every correction is re-read from
              the document anyway. So previewing is an offer, not a gate - the
              reader who already knows what they changed can apply it.
            */}
            <div className="flex items-center justify-end gap-2">
              <Button size="xs" variant="ghost" disabled={busy} onClick={onReset}>
                <ListRestart className="mr-1 size-3" />Reset detection
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={onPreview}>
                {busy ? "Re-running…" : "Preview updated transactions"}
              </Button>
              <Button size="xs" disabled={busy} onClick={onApply}>Apply changes and review</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One ignored row is a button; several are a list. Ten identical "Restore
 * ignored row N" buttons across the toolbar say nothing that a count does not.
 */
function RestoreIgnoredRows({
  blocks,
  busy,
  onRestore,
}: {
  blocks: PdfStatementParseResult["blocks"];
  busy: boolean;
  onRestore: (blockId: string) => void;
}) {
  if (blocks.length === 0) return null;
  if (blocks.length === 1) {
    return (
      <Button size="xs" variant="outline" disabled={busy} onClick={() => onRestore(blocks[0].id)}>
        <Undo2 aria-hidden="true" className="mr-1 size-3.5" />Restore ignored row 1
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="xs" variant="outline" disabled={busy}>
            <Undo2 aria-hidden="true" className="mr-1 size-3.5" />Restore ignored rows ({blocks.length})
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {blocks.map((block, index) => (
          <DropdownMenuItem key={block.id} onClick={() => onRestore(block.id)}>
            Restore ignored row {index + 1}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * What applying these settings would do, as a small ledger.
 *
 * Each measurement is a column and each state a row, so the figures stack:
 * the change sits directly under the two numbers it came from, right-aligned
 * and tabular, which is the arrangement the eye reads fastest. Read the other
 * way round - a row per measurement, each with its own before, arrow, after
 * and delta - nothing lined up with anything, and "same" and "unchanged" said
 * in words what a zero says in the column it belongs to.
 *
 * Colour is on the change row only: the first two rows are facts, and the
 * third is the one worth reacting to.
 */
export function PdfDetectionChangePreview({ diff }: { diff: PdfResultDiff }) {
  const edits = [
    diff.added ? `${diff.added} added` : null,
    diff.removed ? `${diff.removed} removed` : null,
    diff.amounts ? `${diff.amounts} ${diff.amounts === 1 ? "amount" : "amounts"}` : null,
    diff.currencies ? `${diff.currencies} ${diff.currencies === 1 ? "currency" : "currencies"}` : null,
    diff.dates ? `${diff.dates} ${diff.dates === 1 ? "date" : "dates"}` : null,
    diff.descriptions ? `${diff.descriptions} ${diff.descriptions === 1 ? "description" : "descriptions"}` : null,
  ].filter(Boolean) as string[];
  const newlyUnreadable = diff.afterRejected - diff.beforeRejected;
  const columns = [
    { key: "transactions", label: "Transactions", before: diff.before, after: diff.after, money: false },
    { key: "ready", label: "Ready", before: diff.beforeReady, after: diff.afterReady, money: false },
    { key: "in", label: "In", before: diff.beforeCredits, after: diff.afterCredits, money: true },
    { key: "out", label: "Out", before: -diff.beforeDebits, after: -diff.afterDebits, money: true },
    { key: "net", label: "Net", before: diff.beforeNet, after: diff.afterNet, money: true },
  ];
  const show = (value: number, money: boolean) => (money ? signed(value) : String(value));

  return (
    <section aria-label="Detection change preview" className="mb-2 overflow-hidden rounded-md border bg-background/70">
      {/* What changed shares the heading's line: it is one short phrase, and
          a line of its own under the figures pushed the panel taller for it. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          If you apply these changes
        </p>
        <p className="text-[11px] text-muted-foreground">
          {edits.length ? `Row changes: ${edits.join(" · ")}` : "No row would change."}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] whitespace-nowrap">
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="px-3 py-1 text-left font-normal"><span className="sr-only">Measurement</span></th>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-2 py-1 text-right font-normal">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr>
              <th scope="row" className="px-3 py-0.5 text-left font-normal text-muted-foreground">Now</th>
              {columns.map((column) => (
                <td key={column.key} className="px-2 py-0.5 text-right">{show(column.before, column.money)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="px-3 py-0.5 text-left font-normal text-muted-foreground">After</th>
              {columns.map((column) => (
                <td key={column.key} className="px-2 py-0.5 text-right font-medium">{show(column.after, column.money)}</td>
              ))}
            </tr>
            <tr className="border-t">
              <th scope="row" className="px-3 py-0.5 text-left font-normal text-muted-foreground">Change</th>
              {columns.map((column) => {
                const delta = column.after - column.before;
                return (
                  <td
                    key={column.key}
                    className={cn(
                      "px-2 py-0.5 text-right",
                      delta === 0 && "text-muted-foreground",
                      delta > 0 && "text-emerald-700 dark:text-emerald-300",
                      delta < 0 && "text-rose-700 dark:text-rose-300"
                    )}
                  >
                    {column.money ? signed(delta) : `${delta > 0 ? "+" : ""}${delta}`}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {newlyUnreadable > 0 && (
        <p role="status" className="flex items-start gap-1.5 border-t bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {newlyUnreadable} {newlyUnreadable === 1 ? "transaction" : "transactions"} would lose a required value and block import.
        </p>
      )}
    </section>
  );
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${formatMinorUnits(value)}`;
}
