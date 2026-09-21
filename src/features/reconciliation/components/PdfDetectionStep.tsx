"use client";

import { ArrowRight, ListPlus, ListRestart, SquareDashedMousePointer, TriangleAlert, Undo2 } from "lucide-react";
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
            <PdfDetectionIssueList label="What needs attention" issues={issues} onResolve={onResolveIssue} />
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

export function PdfDetectionChangePreview({ diff }: { diff: PdfResultDiff }) {
  const edits = [
    diff.added ? `${diff.added} added` : null,
    diff.removed ? `${diff.removed} removed` : null,
    diff.amounts ? `${diff.amounts} ${diff.amounts === 1 ? "amount" : "amounts"}` : null,
    diff.dates ? `${diff.dates} ${diff.dates === 1 ? "date" : "dates"}` : null,
    diff.descriptions ? `${diff.descriptions} ${diff.descriptions === 1 ? "description" : "descriptions"}` : null,
  ].filter(Boolean) as string[];
  const newlyUnreadable = diff.afterRejected - diff.beforeRejected;

  return (
    <section aria-label="Detection change preview" className="mb-2 overflow-hidden rounded-md border bg-background/70">
      <p className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        If you apply these changes
      </p>

      <div className="divide-y text-[11px]">
        <PreviewRow
          label="Transactions"
          before={String(diff.before)}
          after={String(diff.after)}
          delta={diff.after - diff.before}
        />
        <PreviewRow
          label="Ready to import"
          before={String(diff.beforeReady)}
          after={String(diff.afterReady)}
          delta={diff.afterReady - diff.beforeReady}
        />
        <PreviewRow
          label="Net change"
          before={signed(diff.beforeNet)}
          after={signed(diff.afterNet)}
          delta={diff.afterNet - diff.beforeNet}
          deltaLabel={diff.afterNet === diff.beforeNet ? "unchanged" : signed(diff.afterNet - diff.beforeNet)}
          emphasis
        />
      </div>

      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {edits.length ? `Row changes: ${edits.join(" · ")}` : "No row would change."}
      </p>

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

/**
 * One measurement, read left to right: what it is now, what it becomes, and by
 * how much. The delta carries the colour because it is the part that answers
 * "is this change what I wanted".
 */
function PreviewRow({
  label,
  before,
  after,
  delta,
  deltaLabel,
  emphasis = false,
}: {
  label: string;
  before: string;
  after: string;
  delta: number;
  deltaLabel?: string;
  emphasis?: boolean;
}) {
  const unchanged = delta === 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 px-3 py-1.5">
      <span className={cn("truncate", emphasis ? "font-medium" : "text-muted-foreground")}>{label}</span>
      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span className="text-muted-foreground line-through decoration-muted-foreground/40">{before}</span>
        <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <strong className={cn(emphasis && "text-sm")}>{after}</strong>
        <span
          className={cn(
            "min-w-10 text-right text-[10px]",
            unchanged && "text-muted-foreground",
            !unchanged && delta > 0 && "text-emerald-700 dark:text-emerald-300",
            !unchanged && delta < 0 && "text-rose-700 dark:text-rose-300"
          )}
        >
          {deltaLabel ?? (unchanged ? "same" : `${delta > 0 ? "+" : ""}${delta}`)}
        </span>
      </span>
    </div>
  );
}
