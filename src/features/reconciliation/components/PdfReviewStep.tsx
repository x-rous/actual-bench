"use client";

import { memo } from "react";
import { Download, Redo2, Search, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import type { SortDirection } from "@/components/ui/sortable-header";
import type { PdfStatementParseResult, PdfTransactionProposal } from "@/lib/reconciliation/statement/pdf";
import { matchesCategory, type PdfReviewCategory, type PdfSortColumn, type PdfSortState } from "../lib/pdfReviewTable";
import { PdfTransactionTable, type PdfTransactionField } from "./PdfTransactionTable";

/**
 * Step two: the transactions themselves, with the statement page beside them
 * when the reader asks where a value came from.
 */
export function PdfReviewStep({
  rows,
  tableRows,
  result,
  filter,
  setFilter,
  search,
  setSearch,
  sort,
  onSort,
  selectedIds,
  allVisibleSelected,
  someVisibleSelected,
  busy,
  exportCount,
  onExport,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onToggleAll,
  onToggle,
  onDirection,
  onField,
  onSource,
  onAccept,
  onIgnore,
  onSplit,
  sourcePanel,
}: {
  rows: PdfTransactionProposal[];
  tableRows: PdfTransactionProposal[];
  result: PdfStatementParseResult;
  filter: PdfReviewCategory;
  setFilter: (filter: PdfReviewCategory) => void;
  search: string;
  setSearch: (value: string) => void;
  sort: PdfSortState;
  onSort: (key: PdfSortColumn, direction: SortDirection) => void;
  selectedIds: Set<string>;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  busy: boolean;
  exportCount: number;
  onExport: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleAll: () => void;
  onToggle: (id: string, checked: boolean) => void;
  onDirection: (row: PdfTransactionProposal, direction: "debit" | "credit") => void;
  onField: (row: PdfTransactionProposal, field: PdfTransactionField, value: string | null) => void;
  onSource: (row: PdfTransactionProposal, field: keyof PdfTransactionProposal["confidence"]) => void;
  onAccept: (row: PdfTransactionProposal) => void;
  onIgnore: (row: PdfTransactionProposal) => void;
  onSplit: (row: PdfTransactionProposal) => void;
  sourcePanel: React.ReactNode;
}) {
  const filtered = filter !== "all" || search.trim().length > 0;
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PdfReviewToolbar
          rows={rows}
          filter={filter}
          setFilter={setFilter}
          search={search}
          setSearch={setSearch}
          exportCount={exportCount}
          onExport={onExport}
          shownCount={tableRows.length}
          busy={busy}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
        />
        <PdfTransactionTable
          rows={tableRows}
          result={result}
          sort={sort}
          onSort={onSort}
          selectedIds={selectedIds}
          allVisibleSelected={allVisibleSelected}
          someVisibleSelected={someVisibleSelected}
          busy={busy}
          emptyAction={filtered
            ? { label: "Show all transactions", onClick: () => { setFilter("all"); setSearch(""); } }
            : null}
          onToggleAll={onToggleAll}
          onToggle={onToggle}
          onDirection={onDirection}
          onField={onField}
          onSource={onSource}
          onAccept={onAccept}
          onIgnore={onIgnore}
          onSplit={onSplit}
        />
      </div>
      {sourcePanel}
    </div>
  );
}

const REVIEW_CATEGORIES: [PdfReviewCategory, string][] = [
  ["structure", "Structure"],
  ["dates", "Dates"],
  ["amounts", "Amounts & direction"],
  ["reconciliation", "Reconciliation"],
  ["duplicates", "Duplicates"],
];

const PdfReviewToolbar = memo(function PdfReviewToolbar({
  rows,
  filter,
  setFilter,
  search,
  setSearch,
  onExport,
  exportCount,
  shownCount,
  busy,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  rows: PdfTransactionProposal[];
  filter: PdfReviewCategory;
  setFilter: (filter: PdfReviewCategory) => void;
  search: string;
  setSearch: (value: string) => void;
  onExport: () => void;
  exportCount: number;
  shownCount: number;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const count = (category: PdfReviewCategory) => rows.filter((row) => matchesCategory(row, category)).length;
  const issueCategories = REVIEW_CATEGORIES
    .map(([value, label]) => ({ value, label, count: count(value) }))
    .filter((category) => category.count > 0);
  const manualCount = count("manual");
  const issueFilterActive = filter === "needs-review" || issueCategories.some((category) => category.value === filter);

  // The filters wrap onto another line rather than scrolling sideways. A
  // scrollbar over a set of filters hides some of them behind a gesture,
  // which is the opposite of what a filter strip is for: they are meant to be
  // read at a glance to see what this statement's problems are.
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-4 py-1.5">
      <div role="group" aria-label="Review filters" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        <PillGroup
          className="shrink-0"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: count("all") },
            { value: "needs-review", label: "Needs review", count: count("needs-review") },
            { value: "ready", label: "Ready", count: count("ready") },
          ]}
        />
        {issueFilterActive && issueCategories.length > 0 && (
          <div role="group" aria-label="Needs review filters" className="shrink-0">
            <PillGroup value={filter} onChange={setFilter} options={issueCategories} />
          </div>
        )}
        {manualCount > 0 && (
          <PillGroup
            className="shrink-0"
            value={filter}
            onChange={setFilter}
            options={[{ value: "manual", label: "Manual changes", count: manualCount }]}
          />
        )}
      </div>
      {/* Searching, exporting and undoing stay together on the first line,
          whatever the filters do. */}
      <div className="flex shrink-0 items-center gap-2">
      <span className="text-[11px] text-muted-foreground tabular-nums" aria-live="polite">
        Showing {shownCount} of {rows.length}
      </span>
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-1.5 size-3.5 text-muted-foreground" />
        <span className="sr-only">Search parsed transactions</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search…"
          title="Searches the description, reference, amount, and import date"
          className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear the transaction search"
            onClick={() => setSearch("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </label>
      <Button
        size="xs"
        variant="outline"
        className="shrink-0"
        disabled={exportCount === 0}
        title={`Export the ${exportCount} ${exportCount === 1 ? "transaction" : "transactions"} shown, as they are now`}
        onClick={onExport}
      >
        <Download aria-hidden="true" className="mr-1 size-3.5" />Export
      </Button>
      {/* Beside the table they act on. Undo reverses a correction made to
          these rows, which is not a thing the statement's own header does. */}
      <Button
        size="icon-sm"
        variant="outline"
        className="shrink-0"
        aria-label="Undo PDF correction"
        title="Undo the last correction"
        disabled={busy || !canUndo}
        onClick={onUndo}
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        className="shrink-0"
        aria-label="Redo PDF correction"
        title="Redo the correction just undone"
        disabled={busy || !canRedo}
        onClick={onRedo}
      >
        <Redo2 className="size-3.5" />
      </Button>
      </div>
    </div>
  );
});
