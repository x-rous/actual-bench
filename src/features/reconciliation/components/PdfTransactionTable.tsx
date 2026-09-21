"use client";

import { memo, useMemo } from "react";
import { CalendarCheck, CheckCircle2, Eye, OctagonAlert, Split, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SortableHeader, type SortDirection } from "@/components/ui/sortable-header";
import { cn } from "@/lib/utils";
import type { PdfStatementParseResult, PdfTransactionProposal } from "@/lib/reconciliation/statement/pdf";
import { primaryReasonText, reasonText } from "../lib/pdfReasonText";
import { financialDetails, formatGroupedDecimal, type PdfSortColumn, type PdfSortState } from "../lib/pdfReviewTable";

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
  const headerClass = "bg-muted px-2 py-1 text-[11px] font-medium";
  const importDateMarker = <CalendarCheck aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />;

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
          <tr>
            <th className={cn(headerClass, "text-center")}>
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected && !allVisibleSelected}
                onCheckedChange={onToggleAll}
                aria-label={allVisibleSelected ? "Deselect all visible PDF rows" : "Select all visible PDF rows"}
              />
            </th>
            <SortableHeader className={headerClass} label="Status" sortKey="status" sort={sort} onSort={onSort} />
            <SortableHeader
              className={headerClass}
              label="Transaction date"
              sortKey="transactionDate"
              sort={sort}
              onSort={onSort}
              leading={result.guidance.importDate === "transaction" ? importDateMarker : undefined}
              note={result.guidance.importDate === "transaction" ? "used as the import date" : undefined}
            />
            {showPosting && (
              <SortableHeader
                className={headerClass}
                label="Posting date"
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
            <SortableHeader className={headerClass} label="Amount" sortKey="amount" align="right" sort={sort} onSort={onSort} />
            <SortableHeader className={headerClass} label="Currency" sortKey="currency" align="center" sort={sort} onSort={onSort} />
            {showBalance && (
              <SortableHeader className={headerClass} label="Balance" sortKey="balance" align="right" sort={sort} onSort={onSort} />
            )}
            <th className={headerClass}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PdfTransactionRow
              key={row.id}
              row={row}
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
  block: PdfStatementParseResult["blocks"][number] | undefined;
  selected: boolean;
  busy: boolean;
  showPosting: boolean;
  showValue: boolean;
  showBalance: boolean;
};

const PdfTransactionRow = memo(function PdfTransactionRow({
  row,
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
  // What the row is waiting on, in the table rather than only in a tooltip a
  // keyboard or touch reader never reaches.
  const waitingOn = row.status === "accepted" ? null : primaryReasonText(row.issueCodes);
  const caption = [details, waitingOn].filter(Boolean).join(" · ");
  const cellInput = "h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 focus:border-input focus:bg-background disabled:opacity-60";

  return (
    <tr
      className={cn(
        "group/row border-b",
        selected && "bg-accent/60",
        !selected && row.status === "rejected" && "bg-destructive/5",
        !selected && row.status === "review" && "bg-amber-500/5"
      )}
    >
      <td className="px-2 py-0.5 text-center">
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onToggle(row.id, value === true)}
          aria-label={`Select PDF row ${row.sourceRowNumber}`}
        />
      </td>
      <td className="px-1 text-center"><PdfTransactionStatus status={row.status} reasons={row.issueCodes} /></td>
      <PdfEditableDate row={row} field="transactionDate" value={row.transactionDate} confidence="transactionDate" busy={busy} onField={onField} onSource={onSource} />
      {showPosting && <PdfEditableDate row={row} field="postedDate" value={row.postedDate} confidence="postingDate" busy={busy} onField={onField} onSource={onSource} />}
      {showValue && <PdfEditableDate row={row} field="valueDate" value={row.valueDate} confidence="valueDate" busy={busy} onField={onField} onSource={onSource} />}
      <td className="p-0.5">
        <div className="flex">
          <input
            key={`${row.id}-description-${row.description}`}
            aria-label={`Description for PDF row ${row.sourceRowNumber}`}
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
        {caption && (
          <p
            className={cn("truncate px-1 text-[10px]", waitingOn ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}
            title={caption}
          >
            {caption}
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
      <td className="p-0.5">
        <div className="flex">
          <input
            key={`${row.id}-currency-${row.currency ?? ""}`}
            aria-label={`Currency for PDF row ${row.sourceRowNumber}`}
            defaultValue={row.currency ?? ""}
            maxLength={3}
            disabled={busy}
            onBlur={(event) => event.target.value.toUpperCase() !== (row.currency ?? "")
              && onField(row, "currency", event.target.value.toUpperCase() || null)}
            className={cn(cellInput, "text-center uppercase")}
          />
          <PdfSourceButton
            label={`Show currency in statement for PDF row ${row.sourceRowNumber}`}
            title="Show currency in statement"
            onClick={() => onSource(row, "currency")}
          />
        </div>
      </td>
      {showBalance && (
        <td className="px-2 text-right tabular-nums text-muted-foreground">
          {row.balance ? formatGroupedDecimal(row.balance) : "-"}
        </td>
      )}
      <td className="p-0.5">
        <div className="flex justify-end gap-1">
          {row.status === "review" && (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => onAccept(row)}>Mark reviewed</Button>
          )}
          {/*
            Housekeeping, shown on the row the reader is actually on: keeping
            two icon buttons lit on every row of a 300-row table makes the
            table look like a control panel. Focus reveals them too, so they
            stay reachable from the keyboard.
          */}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
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
  const label = field === "transactionDate" ? "Transaction" : field === "postedDate" ? "Posting" : "Value";
  return (
    <td className="p-0.5">
      <div className="flex">
        <input
          key={`${row.id}-${field}-${value ?? ""}`}
          aria-label={`${label} date for PDF row ${row.sourceRowNumber}`}
          type="date"
          defaultValue={value ?? ""}
          disabled={busy}
          onBlur={(event) => {
            const next = event.target.value || null;
            if (next !== value) onField(row, field, next);
          }}
          className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 tabular-nums focus:border-input focus:bg-background disabled:opacity-60"
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
 * Three states, three shapes: a row that is ready, a row that wants a look,
 * and a row that cannot be imported as it stands. Colour says the same thing
 * again for those who see it, but the glyph carries it on its own.
 */
export function PdfTransactionStatus({
  status,
  reasons,
}: {
  status: PdfTransactionProposal["status"];
  reasons: PdfTransactionProposal["issueCodes"];
}) {
  const label = status === "accepted" ? "Ready" : status === "rejected" ? "Fix" : "Review";
  const title = status === "accepted" ? "Transaction is ready" : reasonText(reasons);
  return (
    <Badge
      variant={status === "accepted" ? "status-active" : status === "review" ? "status-warning" : "status-error"}
      className="gap-1 px-1.5 text-[10px]"
      title={title}
      aria-label={title}
    >
      {status === "accepted"
        ? <CheckCircle2 aria-hidden="true" />
        : status === "review"
          ? <TriangleAlert aria-hidden="true" />
          : <OctagonAlert aria-hidden="true" />}
      {label}
    </Badge>
  );
}
