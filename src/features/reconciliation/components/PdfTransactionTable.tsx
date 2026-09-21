"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Check, CheckCircle2, ChevronDown, Eye, OctagonAlert, Split, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SortableHeader, type SortDirection } from "@/components/ui/sortable-header";
import { cn } from "@/lib/utils";
import type { PdfStatementParseResult, PdfTransactionProposal } from "@/lib/reconciliation/statement/pdf";
import { groupRowReasons, PDF_REASON_TEXT, reasonText, type PdfRowReasons } from "../lib/pdfReasonText";
import {
  financialDetails,
  formatDateInput,
  formatGroupedDecimal,
  parseDateInput,
  type PdfSortColumn,
  type PdfSortState,
} from "../lib/pdfReviewTable";

export type PdfTransactionField =
  | "transactionDate"
  | "postedDate"
  | "valueDate"
  | "importDate"
  | "description"
  | "reference"
  | "amount"
  | "currency";

type PdfTransactionTableProps = {
  rows: PdfTransactionProposal[];
  result: PdfStatementParseResult;
  sort: PdfSortState;
  onSort: (key: PdfSortColumn, direction: SortDirection) => void;
  selectedIds: Set<string>;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  busy: boolean;
  emptyAction: { label: string; onClick: () => void } | null;
  onToggleAll: () => void;
  onToggle: (id: string, checked: boolean) => void;
  onDirection: (row: PdfTransactionProposal, direction: "debit" | "credit") => void;
  onField: (row: PdfTransactionProposal, field: PdfTransactionField, value: string | null) => void;
  onSource: (row: PdfTransactionProposal, field: keyof PdfTransactionProposal["confidence"]) => void;
  onAccept: (row: PdfTransactionProposal) => void;
  onIgnore: (row: PdfTransactionProposal) => void;
  onSplit: (row: PdfTransactionProposal) => void;
};

export function PdfTransactionTable({
  rows,
  result,
  sort,
  onSort,
  selectedIds,
  allVisibleSelected,
  someVisibleSelected,
  busy,
  emptyAction,
  onToggleAll,
  onToggle,
  onDirection,
  onField,
  onSource,
  onAccept,
  onIgnore,
  onSplit,
}: PdfTransactionTableProps) {
  const showPosting = result.guidance.columns.some((column) => column.role === "posting-date")
    || rows.some((row) => row.postedDate);
  const showValue = result.guidance.columns.some((column) => column.role === "value-date")
    || rows.some((row) => row.valueDate);
  const showBalance = result.guidance.columns.some((column) => column.role === "balance")
    && rows.some((row) => row.balance);
  const blocksById = useMemo(() => new Map(result.blocks.map((block) => [block.id, block])), [result.blocks]);
  const headerClass = "h-9 bg-muted px-2 py-2 text-[11px] font-medium";
  const gridRef = useRef<HTMLDivElement>(null);
  // Where the caret should be once the rows come back. An edit re-reads the
  // whole statement, so the row that was being typed in is a new element by
  // the time the keystroke has been acted on.
  const pendingFocus = useRef<{ index: number; field: string } | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const cell = gridRef.current?.querySelector<HTMLElement>(
      `[data-pdf-row-index="${target.index}"] [data-pdf-cell="${target.field}"]`
    );
    cell?.focus();
  });

  /**
   * Enter moves down the column, the way a grid does, so a statement can be
   * corrected without returning to the mouse between rows. Ctrl or Cmd with it
   * marks the row reviewed first - a plain letter cannot be a shortcut here
   * because every cell is a field someone may be typing into.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    const field = target.dataset.pdfCell;
    const index = Number(target.closest<HTMLElement>("[data-pdf-row-index]")?.dataset.pdfRowIndex);
    if (!field || !Number.isInteger(index)) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const row = rows[index];
      if (row?.status === "review") onAccept(row);
    }
    const next = Math.min(index + 1, rows.length - 1);
    pendingFocus.current = { index: next, field };
    // Blur first so an edit in this cell is committed before the move, and so
    // the caret lands even when nothing re-renders.
    target.blur();
    gridRef.current?.querySelector<HTMLElement>(
      `[data-pdf-row-index="${next}"] [data-pdf-cell="${field}"]`
    )?.focus();
  }
  const importDateMarker = <CalendarCheck aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />;

  return (
    <div ref={gridRef} className="min-h-0 flex-1 overflow-auto" onKeyDown={handleKeyDown}>
      <table className="w-full min-w-[1060px] table-fixed text-xs">
        <caption className="sr-only">Transactions extracted from the PDF statement</caption>
        <colgroup>
          <col className="w-9" /><col className="w-[5.5rem]" /><col className="w-28" />
          {showPosting && <col className="w-28" />}
          {showValue && <col className="w-28" />}
          <col /><col className="w-40" />
          {showBalance && <col className="w-24" />}
          <col className="w-44" />
        </colgroup>
        <thead className="sticky top-0 z-20 bg-muted text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
          <tr>
            <th className={cn(headerClass, "text-center")}>
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected && !allVisibleSelected}
                onCheckedChange={onToggleAll}
                aria-label={allVisibleSelected ? "Deselect all visible PDF rows" : "Select all visible PDF rows"}
              />
            </th>
            <SortableHeader className={cn(headerClass, "pl-1 pr-2")} label="Status" sortKey="status" sort={sort} onSort={onSort} />
            <SortableHeader
              className={headerClass}
              label="Trans. date"
              sortKey="transactionDate"
              sort={sort}
              onSort={onSort}
              leading={result.guidance.importDate === "transaction" ? importDateMarker : undefined}
              note={result.guidance.importDate === "transaction" ? "used as the import date" : undefined}
            />
            {showPosting && (
              <SortableHeader
                className={headerClass}
                label="Post. date"
                sortKey="postedDate"
                sort={sort}
                onSort={onSort}
                leading={result.guidance.importDate === "posting" ? importDateMarker : undefined}
                note={result.guidance.importDate === "posting" ? "used as the import date" : undefined}
              />
            )}
            {showValue && (
              <SortableHeader
                className={headerClass}
                label="Value date"
                sortKey="valueDate"
                sort={sort}
                onSort={onSort}
                leading={result.guidance.importDate === "value" ? importDateMarker : undefined}
                note={result.guidance.importDate === "value" ? "used as the import date" : undefined}
              />
            )}
            <SortableHeader className={headerClass} label="Description" sortKey="description" sort={sort} onSort={onSort} />
            {/*
              The currency belongs to the statement, not to each row: Actual
              holds one currency per budget file, and nothing carrying a code
              crosses the import boundary. Saying it once over the column is
              what the per-row field was really for.
            */}
            <SortableHeader
              className={headerClass}
              label={result.guidance.currency ? `Amount (${result.guidance.currency})` : "Amount"}
              sortKey="amount"
              align="right"
              sort={sort}
              onSort={onSort}
            />
            {showBalance && (
              <SortableHeader className={headerClass} label="Balance" sortKey="balance" align="right" sort={sort} onSort={onSort} />
            )}
            <th className={headerClass}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <PdfTransactionRow
              key={row.id}
              row={row}
              rowIndex={rowIndex}
              block={blocksById.get(row.id)}
              selected={selectedIds.has(row.id)}
              busy={busy}
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
      {rows.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No transactions match this view.</p>
          {emptyAction && (
            <Button className="mt-2" size="xs" variant="outline" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

type PdfTransactionRowProps = Pick<
  PdfTransactionTableProps,
  "onToggle" | "onDirection" | "onField" | "onSource" | "onAccept" | "onIgnore" | "onSplit"
> & {
  row: PdfTransactionProposal;
  rowIndex: number;
  block: PdfStatementParseResult["blocks"][number] | undefined;
  selected: boolean;
  busy: boolean;
  showPosting: boolean;
  showValue: boolean;
  showBalance: boolean;
};

const PdfTransactionRow = memo(function PdfTransactionRow({
  row,
  rowIndex,
  block,
  selected,
  busy,
  showPosting,
  showValue,
  showBalance,
  onToggle,
  onDirection,
  onField,
  onSource,
  onAccept,
  onIgnore,
  onSplit,
}: PdfTransactionRowProps) {
  const details = financialDetails(row);
  // The most serious reason stays on screen, because the work here is reading
  // three hundred rows at once: the same sentence repeated down the column is
  // what tells you one setting fixes all of them. Everything else is behind
  // the status, which is in the same place on every row.
  const reasons = groupRowReasons(row);
  const hasNotes = reasons.blocking.length + reasons.attention.length + reasons.evidence.length > 0;
  const waitingOn = row.status === "accepted" ? null : reasons.primary;
  const cellInput = "h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 focus:border-input focus:bg-background disabled:opacity-60";

  return (
    <tr
      data-pdf-row-index={rowIndex}
      className={cn(
        // A row is as tall as its description, which may carry a note. Aligning
        // every cell to the top keeps the checkbox, the status and the row
        // actions on the line they belong to instead of floating in the middle.
        "group/row border-b [&>td]:align-top",
        selected && "bg-accent/60",
        !selected && row.status === "rejected" && "bg-destructive/5",
        !selected && row.status === "review" && "bg-amber-500/5"
      )}
    >
      <td className="px-2 pt-2 text-center">
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onToggle(row.id, value === true)}
          aria-label={`Select PDF row ${row.sourceRowNumber}`}
        />
      </td>
      <td className="pl-1 pr-2 pt-1.5 text-left">
        {hasNotes ? (
          <PdfRowNotes
            reasons={reasons}
            label={`${statusLabel(row.status)}: show the notes on PDF row ${row.sourceRowNumber}`}
            trigger={<PdfTransactionStatus status={row.status} reasons={row.issueCodes} hasNotes />}
          />
        ) : (
          <PdfTransactionStatus status={row.status} reasons={row.issueCodes} />
        )}
      </td>
      <PdfEditableDate row={row} field="transactionDate" value={row.transactionDate} confidence="transactionDate" busy={busy} onField={onField} onSource={onSource} />
      {showPosting && <PdfEditableDate row={row} field="postedDate" value={row.postedDate} confidence="postingDate" busy={busy} onField={onField} onSource={onSource} />}
      {showValue && <PdfEditableDate row={row} field="valueDate" value={row.valueDate} confidence="valueDate" busy={busy} onField={onField} onSource={onSource} />}
      <td className="p-0.5">
        <div className="flex">
          <input
            key={`${row.id}-description-${row.description}`}
            aria-label={`Description for PDF row ${row.sourceRowNumber}`}
            data-pdf-cell="description"
            defaultValue={row.description}
            disabled={busy}
            onBlur={(event) => event.target.value !== row.description && onField(row, "description", event.target.value)}
            className={cellInput}
          />
          <PdfSourceButton
            label={`Show description in statement for PDF row ${row.sourceRowNumber}`}
            title="Show description in statement"
            onClick={() => onSource(row, "description")}
          />
        </div>
        {(details || waitingOn) && (
          <p className="flex items-center gap-1 px-1 text-[10px]">
            {details && <span className="truncate text-muted-foreground" title={details}>{details}</span>}
            {details && waitingOn && <span aria-hidden="true" className="text-muted-foreground">·</span>}
            {waitingOn && (
              <span
                className={cn("truncate", reasons.blocking.length ? "text-destructive" : "text-amber-700 dark:text-amber-300")}
                title={waitingOn}
              >
                {waitingOn}
              </span>
            )}
          </p>
        )}
      </td>
      <td className="p-0.5">
        <div className="flex h-7 overflow-hidden rounded border border-transparent focus-within:border-input focus-within:bg-background">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDirection(row, row.direction === "debit" ? "credit" : "debit")}
            aria-label={row.direction === "debit"
              ? `Change row ${row.sourceRowNumber} to money in`
              : `Change row ${row.sourceRowNumber} to money out`}
            className={cn(
              "w-7 border-r font-semibold disabled:opacity-60",
              row.direction === "debit" ? "text-red-600" : row.direction === "credit" ? "text-emerald-700" : "text-amber-700"
            )}
          >
            {row.direction === "debit" ? "−" : row.direction === "credit" ? "+" : "?"}
          </button>
          <input
            key={`${row.id}-amount-${row.amount}`}
            aria-label={`Amount for PDF row ${row.sourceRowNumber}`}
            data-pdf-cell="amount"
            defaultValue={row.amount.replace(/^[+-]/, "")}
            disabled={busy}
            onBlur={(event) => event.target.value !== row.amount.replace(/^[+-]/, "")
              && onField(row, "amount", `${row.direction === "debit" ? "-" : ""}${event.target.value}`)}
            className="min-w-0 flex-1 bg-transparent px-2 text-right tabular-nums outline-none disabled:opacity-60"
          />
          <PdfSourceButton
            label={`Show amount in statement for PDF row ${row.sourceRowNumber}`}
            title="Show amount in statement"
            onClick={() => onSource(row, "accountAmount")}
          />
        </div>
      </td>
      {showBalance && (
        <td className="px-2 pt-2 text-right tabular-nums text-muted-foreground">
          {row.balance ? formatGroupedDecimal(row.balance) : "-"}
        </td>
      )}
      <td className="p-0.5 pt-1">
        <div className="flex items-start justify-end gap-1">
          {row.status === "review" && (
            <Button
              size="xs"
              variant="outline"
              className="pl-1.5"
              disabled={busy}
              aria-label={`Mark PDF row ${row.sourceRowNumber} reviewed`}
              title="Mark reviewed (Ctrl+Enter from a cell in this row)"
              onClick={() => onAccept(row)}
            >
              <Check aria-hidden="true" className="mr-0.5 size-3" />Reviewed
            </Button>
          )}
          {/*
            Housekeeping, shown on the row the reader is actually on: keeping
            two icon buttons lit on every row of a 300-row table makes the
            table look like a control panel. Focus reveals them too, so they
            stay reachable from the keyboard.
          */}
          <div className="flex w-14 shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
            {block && block.rowIds.length > 1 && (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Split PDF row ${row.sourceRowNumber}`}
                title="Split this row into separate transactions"
                onClick={() => onSplit(row)}
              >
                <Split className="size-3.5" />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label={`Ignore PDF row ${row.sourceRowNumber}`}
              title="Leave this row out of the import"
              onClick={() => onIgnore(row)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}, (previous, next) => previous.row === next.row
  && previous.rowIndex === next.rowIndex
  && previous.block === next.block
  && previous.selected === next.selected
  && previous.busy === next.busy
  && previous.showPosting === next.showPosting
  && previous.showValue === next.showValue
  && previous.showBalance === next.showBalance);

function PdfSourceButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      onClick={onClick}
      className="px-1 text-muted-foreground hover:text-foreground"
    >
      <Eye className="size-3.5" />
    </button>
  );
}

function PdfEditableDate({
  row,
  field,
  value,
  confidence,
  busy,
  onField,
  onSource,
}: {
  row: PdfTransactionProposal;
  field: "transactionDate" | "postedDate" | "valueDate";
  value: string | null;
  confidence: keyof PdfTransactionProposal["confidence"];
  busy: boolean;
  onField: (row: PdfTransactionProposal, field: PdfTransactionField, value: string | null) => void;
  onSource: (row: PdfTransactionProposal, field: keyof PdfTransactionProposal["confidence"]) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const label = field === "transactionDate" ? "Transaction" : field === "postedDate" ? "Posting" : "Value";

  /**
   * Shown and typed as `21/09/2026`, stored as the date it means.
   *
   * A native date input made this a segmented mask in the browser's locale:
   * no pasting, no typing a year without stepping through it, and a date
   * shown back in whatever order that machine prefers. One written format
   * across the workbench costs less to read than a picker saves.
   *
   * A value it cannot read is kept on screen and marked, rather than thrown
   * away or written to the row as a guess.
   */
  function commit(input: HTMLInputElement) {
    const text = input.value.trim();
    if (text === formatDateInput(value)) {
      setInvalid(false);
      return;
    }
    if (!text) {
      setInvalid(false);
      onField(row, field, null);
      return;
    }
    const parsed = parseDateInput(text);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    // The same date written differently still tidies up on screen.
    if (parsed === value) input.value = formatDateInput(parsed);
    else onField(row, field, parsed);
  }

  return (
    <td className="p-0.5">
      <div className="flex">
        <input
          key={`${row.id}-${field}-${value ?? ""}`}
          aria-label={`${label} date for PDF row ${row.sourceRowNumber}`}
          aria-invalid={invalid || undefined}
          data-pdf-cell={field}
          defaultValue={formatDateInput(value)}
          disabled={busy}
          placeholder="dd/mm/yyyy"
          title={invalid ? "This date could not be read. Write it as 21/09/2026." : undefined}
          onBlur={(event) => commit(event.target)}
          className={cn(
            "h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 tabular-nums focus:border-input focus:bg-background disabled:opacity-60",
            invalid && "border-destructive text-destructive"
          )}
        />
        <PdfSourceButton
          label={`Show ${field} in statement for PDF row ${row.sourceRowNumber}`}
          title={`Show ${label.toLowerCase()} date in statement`}
          onClick={() => onSource(row, confidence)}
        />
      </div>
    </td>
  );
}

/**
 * The row's notes, opened from its status.
 *
 * A popover rather than a tooltip: it answers a click as well as a hover, so
 * it works on a touch screen and from the keyboard, its text can be selected,
 * and it is the layer the rest of the app uses inside a dialog - stacked above
 * it rather than level with it, which is what left the tooltip invisible.
 *
 * Hover opens it too, after long enough not to fire while someone is scanning
 * the table. That is also how most people will find it at all: the chevron on
 * the badge says there is something to open, and a paused pointer proves it.
 */
function PdfRowNotes({
  reasons,
  label,
  trigger,
  className,
}: {
  reasons: PdfRowReasons;
  label: string;
  trigger: React.ReactNode;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={400}
        closeDelay={120}
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className
            )}
          />
        }
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-72 p-2.5 text-[11px] leading-relaxed">
        <PdfRowReasonList reasons={reasons} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Every note on the row, in two groups: what it is waiting on, and how it was
 * read. The second is useful when deciding whether to accept the first, and
 * misleading when mixed into it.
 */
function PdfRowReasonList({ reasons }: { reasons: PdfRowReasons }) {
  const problems = [...reasons.blocking, ...reasons.attention];
  return (
    <div className="space-y-1.5">
      {problems.length > 0 && (
        <div>
          <p className="font-medium">Needs attention</p>
          <ul className="mt-0.5 space-y-0.5">
            {problems.map((reason) => <li key={reason}>{PDF_REASON_TEXT[reason]}</li>)}
          </ul>
        </div>
      )}
      {reasons.evidence.length > 0 && (
        <div>
          <p className="font-medium">How this was read</p>
          <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
            {reasons.evidence.map((reason) => <li key={reason}>{PDF_REASON_TEXT[reason]}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Three states, three shapes: a row that is ready, a row that wants a look,
 * and a row that cannot be imported as it stands. Colour says the same thing
 * again for those who see it, but the glyph carries it on its own.
 */
function statusLabel(status: PdfTransactionProposal["status"]) {
  return status === "accepted" ? "Ready" : status === "rejected" ? "Fix" : "Review";
}

export function PdfTransactionStatus({
  status,
  reasons,
  hasNotes = false,
}: {
  status: PdfTransactionProposal["status"];
  reasons: PdfTransactionProposal["issueCodes"];
  /** Whether it opens the row's notes, which it has to look like it does. */
  hasNotes?: boolean;
}) {
  return (
    <Badge
      variant={status === "accepted" ? "status-active" : status === "review" ? "status-warning" : "status-error"}
      className={cn("gap-1 px-1.5 text-[10px]", hasNotes && "pr-1 group-hover/row:brightness-95")}
      // Without the popover there is nowhere else for the reasons to be said.
      title={hasNotes ? undefined : status === "accepted" ? "Transaction is ready" : reasonText(reasons)}
    >
      {status === "accepted"
        ? <CheckCircle2 aria-hidden="true" />
        : status === "review"
          ? <TriangleAlert aria-hidden="true" />
          : <OctagonAlert aria-hidden="true" />}
      {statusLabel(status)}
      {/* The mark that says this opens something, before anyone touches it. */}
      {hasNotes && <ChevronDown aria-hidden="true" className="-ml-0.5 opacity-70" />}
    </Badge>
  );
}
