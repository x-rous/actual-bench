"use client";

import { useState, useMemo } from "react";
import { useHighlight } from "@/hooks/useHighlight";
import { useTableSelection } from "@/hooks/useTableSelection";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import { Pencil, Trash2, RotateCcw, Copy, ExternalLink, AlertTriangle, Repeat2, CalendarDays, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { buildScheduleDeleteWarning, buildScheduleBulkDeleteWarning } from "@/lib/usageWarnings";
import { UsageInspectorDrawer } from "@/features/usage-inspector/components/UsageInspectorDrawer";
import { recurSummary, frequencyLabel } from "../lib/recurSummary";
import { FilterBar } from "./FilterBar";
import type { StatusFilter, AutoAddFilter, FrequencyFilter, EntityOption } from "./FilterBar";
import type { StagedEntity } from "@/types/staged";
import type { Schedule, ScheduleAmountRange } from "@/types/entities";

// ─── Delete intent ────────────────────────────────────────────────────────────

type DeleteIntent = {
  /** Server-side IDs for $oneof tx-count query. Empty when all selected are isNew. */
  ids: string[];
  title: string;
  onConfirm: () => void;
  // Single delete
  entityLabel?: string;
  ruleId?: string;
  postsTransaction?: boolean;
  // Bulk delete
  bulkCount?: number;
};

// ─── Amount display helper ────────────────────────────────────────────────────

function formatAmount(
  amount: number | ScheduleAmountRange | undefined,
  amountOp: Schedule["amountOp"]
): string {
  if (amount === undefined || amountOp === undefined) return "";
  if (typeof amount === "number") {
    const display = (amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amountOp === "isapprox" ? `~${display}` : display;
  }
  const range = amount as ScheduleAmountRange;
  const n1 = (range.num1 / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n2 = (range.num2 / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n1} – ${n2}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(nextDate: string | undefined, completed: boolean): boolean {
  if (!nextDate || completed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = nextDate.split("-").map(Number);
  const due = new Date(year, (month ?? 1) - 1, day ?? 1);
  return due < today;
}

// ─── SchedulesTable ───────────────────────────────────────────────────────────

type Props = {
  onEdit: (id: string) => void;
  onEditAsRule: (ruleId: string) => void;
};

export function SchedulesTable({ onEdit, onEditAsRule }: Props) {
  const staged          = useStagedStore((s) => s.schedules);
  const stagedPayees    = useStagedStore((s) => s.payees);
  const stagedAccounts  = useStagedStore((s) => s.accounts);
  const stageNew        = useStagedStore((s) => s.stageNew);
  const stageDelete     = useStagedStore((s) => s.stageDelete);
  const revertEntity    = useStagedStore((s) => s.revertEntity);
  const clearSaveError  = useStagedStore((s) => s.clearSaveError);
  const pushUndo        = useStagedStore((s) => s.pushUndo);

  const highlightedId = useHighlight();

  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const { data: txCounts, isLoading: txLoading } = useTransactionCountsForIds(
    "schedule",
    deleteIntent?.ids ?? [],
    { enabled: !!deleteIntent && (deleteIntent.ids.length > 0) }
  );

  // ── Confirm dialog state (computed from intent + live tx counts) ─────────────
  const txTotal = deleteIntent?.ids.length
    ? (txCounts ? [...txCounts.values()].reduce((a, b) => a + b, 0) : undefined)
    : 0;

  const confirmState: ConfirmState | null = deleteIntent
    ? {
        title: deleteIntent.title,
        message:
          deleteIntent.bulkCount !== undefined
            ? buildScheduleBulkDeleteWarning(
                deleteIntent.bulkCount,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              )
            : buildScheduleDeleteWarning(
                deleteIntent.entityLabel ?? "",
                deleteIntent.ruleId,
                deleteIntent.postsTransaction ?? false,
                txTotal,
                txLoading && deleteIntent.ids.length > 0
              ),
        onConfirm: deleteIntent.onConfirm,
      }
    : null;

  const [search, setSearch]                       = useState("");
  const [statusFilter, setStatusFilter]           = useState<StatusFilter>("active");
  const [autoAddFilter, setAutoAddFilter]         = useState<AutoAddFilter>("all");
  const [frequencyFilter, setFrequencyFilter]     = useState<FrequencyFilter>("all");
  const [payeeFilter, setPayeeFilter]             = useState("");
  const [accountFilter, setAccountFilter]         = useState("");

  const { selectedIds, toggleSelect, toggleSelectAll: _toggleSelectAll, clearSelection } =
    useTableSelection();

  // ── Payee / account filter options (from all non-deleted schedules) ──────────
  const { payeeOptions, accountOptions } = useMemo<{
    payeeOptions: EntityOption[];
    accountOptions: EntityOption[];
  }>(() => {
    const payeeMap = new Map<string, string>();
    const accountMap = new Map<string, string>();
    for (const s of Object.values(staged)) {
      if (s.isDeleted) continue;
      if (s.entity.payeeId) {
        const name = stagedPayees[s.entity.payeeId]?.entity.name;
        if (name) payeeMap.set(s.entity.payeeId, name);
      }
      if (s.entity.accountId) {
        const name = stagedAccounts[s.entity.accountId]?.entity.name;
        if (name) accountMap.set(s.entity.accountId, name);
      }
    }
    const sortByLabel = (a: EntityOption, b: EntityOption) => a.label.localeCompare(b.label);
    return {
      payeeOptions:   [...payeeMap.entries()].map(([value, label]) => ({ value, label })).sort(sortByLabel),
      accountOptions: [...accountMap.entries()].map(([value, label]) => ({ value, label })).sort(sortByLabel),
    };
  }, [staged, stagedPayees, stagedAccounts]);

  // ── Derived rows ─────────────────────────────────────────────────────────────
  const rows = useMemo<StagedEntity<Schedule>[]>(() => {
    const q = search.trim().toLowerCase();
    return Object.values(staged).filter((s) => {
      if (s.isDeleted) return false;
      if (statusFilter === "active"    && s.entity.completed) return false;
      if (statusFilter === "completed" && !s.entity.completed) return false;
      if (autoAddFilter === "auto"   && !s.entity.postsTransaction) return false;
      if (autoAddFilter === "manual" &&  s.entity.postsTransaction) return false;
      if (frequencyFilter !== "all") {
        const freq = frequencyLabel(s.entity.date).toLowerCase();
        if (freq !== frequencyFilter) return false;
      }
      if (payeeFilter   && s.entity.payeeId   !== payeeFilter)   return false;
      if (accountFilter && s.entity.accountId !== accountFilter) return false;
      if (q) {
        const name     = (s.entity.name ?? "").toLowerCase();
        const payee    = (stagedPayees[s.entity.payeeId ?? ""]?.entity.name ?? "").toLowerCase();
        const account  = (stagedAccounts[s.entity.accountId ?? ""]?.entity.name ?? "").toLowerCase();
        const summary  = recurSummary(s.entity.date).toLowerCase();
        if (!name.includes(q) && !payee.includes(q) && !account.includes(q) && !summary.includes(q)) return false;
      }
      return true;
    });
  }, [staged, search, statusFilter, autoAddFilter, frequencyFilter, payeeFilter, accountFilter, stagedPayees, stagedAccounts]);

  const totalCount   = Object.values(staged).filter((s) => !s.isDeleted).length;
  const selectableIds = useMemo(() => new Set(rows.map((s) => s.entity.id)), [rows]);
  const allSelected   = rows.length > 0 && rows.every((s) => selectedIds.has(s.entity.id));
  const someSelected  = rows.some((s) => selectedIds.has(s.entity.id));
  const activeSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => selectableIds.has(id)),
    [selectedIds, selectableIds]
  );

  function toggleSelectAll() { _toggleSelectAll(selectableIds, allSelected); }

  function handleDelete(id: string) {
    const s = staged[id];
    if (!s) return;
    const entity = s.entity;
    setDeleteIntent({
      ids: s.isNew ? [] : [entity.id],
      title: "Delete schedule?",
      entityLabel: entity.name ?? "Unnamed",
      ruleId: entity.ruleId,
      postsTransaction: entity.postsTransaction ?? false,
      onConfirm: () => { pushUndo(); stageDelete("schedules", id); },
    });
  }

  function handleDuplicate(s: Schedule) {
    pushUndo();
    stageNew("schedules", {
      ...structuredClone(s),
      id: generateId(),
      // Strip server-only fields from the duplicate
      ruleId: undefined,
      nextDate: undefined,
      completed: false,
    });
  }

  function handleBulkDelete() {
    const count = activeSelectedIds.length;
    const serverIds = activeSelectedIds.filter((id) => !staged[id]?.isNew);
    setDeleteIntent({
      ids: serverIds,
      title: `Delete ${count} schedule${count === 1 ? "" : "s"}?`,
      bulkCount: count,
      onConfirm: () => {
        pushUndo();
        for (const id of activeSelectedIds) stageDelete("schedules", id);
        clearSelection();
      },
    });
  }

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FilterBar
        search={search}              onSearchChange={setSearch}
        statusFilter={statusFilter}  onStatusFilterChange={setStatusFilter}
        autoAddFilter={autoAddFilter} onAutoAddFilterChange={setAutoAddFilter}
        frequencyFilter={frequencyFilter} onFrequencyFilterChange={setFrequencyFilter}
        payeeFilter={payeeFilter}    onPayeeFilterChange={setPayeeFilter}  payeeOptions={payeeOptions}
        accountFilter={accountFilter} onAccountFilterChange={setAccountFilter} accountOptions={accountOptions}
        filteredCount={rows.length}  totalCount={totalCount}
        selectedCount={activeSelectedIds.length}
        onBulkDelete={handleBulkDelete}
        onDeselect={clearSelection}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <span>No schedules found.</span>
            {(search || statusFilter !== "active" || autoAddFilter !== "all" || frequencyFilter !== "all" || payeeFilter || accountFilter) && (
              <button
                className="text-xs underline hover:text-foreground"
                onClick={() => { setSearch(""); setStatusFilter("active"); setAutoAddFilter("all"); setFrequencyFilter("all"); setPayeeFilter(""); setAccountFilter(""); }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleSelectAll}
                    aria-label="Select all schedules"
                    className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="w-32 px-3 py-2 text-left font-medium">Next Date</th>
                <th className="w-20 px-3 py-2 text-center font-medium">Repeating</th>
                <th className="w-36 px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Repeats</th>
                <th className="w-36 px-3 py-2 text-left font-medium">Payee</th>
                <th className="w-36 px-3 py-2 text-left font-medium">Account</th>
                <th className="w-20 px-3 py-2 text-center font-medium">Auto Add</th>
                <th className="w-24 px-3 py-2 text-center font-medium">Status</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const { entity, isNew, isUpdated, isDeleted, saveError } = s;
                const payeeName   = stagedPayees[entity.payeeId ?? ""]?.entity.name ?? "";
                const accountName = stagedAccounts[entity.accountId ?? ""]?.entity.name ?? "";
                const isRowSelected = selectedIds.has(entity.id);

                return (
                  <tr
                    key={entity.id}
                    data-row-id={entity.id}
                    className={cn(
                      "group cursor-pointer border-b border-border border-l-2 border-l-transparent hover:bg-muted/20 transition-colors align-top",
                      highlightedId === entity.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
                      highlightedId !== entity.id && isRowSelected && "bg-primary/10",
                      highlightedId !== entity.id && !isRowSelected && saveError && "bg-destructive/5 border-l-destructive",
                      highlightedId !== entity.id && !isRowSelected && !saveError && isNew && "bg-green-50/40 dark:bg-green-950/10 border-l-green-500",
                      highlightedId !== entity.id && !isRowSelected && !saveError && !isNew && isUpdated && "bg-amber-50/40 dark:bg-amber-950/10 border-l-amber-400",
                    )}
                    onClick={() => onEdit(entity.id)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isRowSelected}
                        onChange={() => toggleSelect(entity.id)}
                        aria-label={`Select schedule ${entity.name ?? entity.id}`}
                        className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                      />
                    </td>

                    {/* Name */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {isNew && <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />}
                        {!isNew && isUpdated && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
                        {saveError && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" aria-label={saveError} />}
                        <span className={cn("font-medium", !entity.name && "italic text-muted-foreground")}>
                          {entity.name || "Unnamed"}
                        </span>
                      </div>
                      {saveError && <p className="mt-0.5 text-[11px] text-destructive">{saveError}</p>}
                    </td>

                    {/* Next Date */}
                    <td className={cn(
                      "px-3 py-2",
                      isOverdue(entity.nextDate, entity.completed ?? false)
                        ? "text-amber-600 dark:text-amber-400 font-medium"
                        : "text-muted-foreground"
                    )}>
                      {formatDate(entity.nextDate)}
                    </td>

                    {/* Repeating */}
                    <td className="px-3 py-2 text-center">
                      {typeof entity.date !== "string"
                        ? <Badge variant="status-active" className="gap-1 text-[10px] font-normal"><Repeat2 className="h-3 w-3" />Recurring</Badge>
                        : <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground"><CalendarDays className="h-3 w-3" />Once</Badge>}
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {entity.amount !== undefined
                        ? formatAmount(entity.amount, entity.amountOp)
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* Repeats */}
                    <td className="px-3 py-2 text-muted-foreground">
                      {recurSummary(entity.date) || <span className="italic text-muted-foreground/40">—</span>}
                    </td>

                    {/* Payee */}
                    <td className="px-3 py-2 text-muted-foreground">
                      {payeeName || <span className="italic text-muted-foreground/40">—</span>}
                    </td>

                    {/* Account */}
                    <td className="px-3 py-2 text-muted-foreground">
                      {accountName || <span className="italic text-muted-foreground/40">—</span>}
                    </td>

                    {/* Auto Add */}
                    <td className="px-3 py-2 text-center">
                      {entity.postsTransaction
                        ? <Badge variant="status-active" className="text-[10px] font-normal">Auto</Badge>
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2 text-center">
                      <Badge variant={entity.completed ? "status-inactive" : "status-active"} className="text-[10px] font-normal">
                        {entity.completed ? "Completed" : "Active"}
                      </Badge>
                    </td>

                    {/* Row actions */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon-xs" title="Edit" aria-label="Edit" onClick={() => onEdit(entity.id)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-xs" title="Duplicate" aria-label="Duplicate" onClick={() => handleDuplicate(entity)}>
                          <Copy />
                        </Button>
                        {entity.ruleId && (
                          <Button variant="ghost" size="icon-xs" title="Edit as Rule" aria-label="Edit as Rule" onClick={() => onEditAsRule(entity.ruleId!)}>
                            <ExternalLink />
                          </Button>
                        )}
                        {(isNew || isUpdated) && !isDeleted && (
                          <Button variant="ghost" size="icon-xs" title="Revert" aria-label="Revert" onClick={() => revertEntity("schedules", entity.id)}>
                            <RotateCcw />
                          </Button>
                        )}
                        {saveError && (
                          <Button variant="ghost" size="icon-xs" title="Clear error" aria-label="Clear error" onClick={() => clearSaveError("schedules", entity.id)}>
                            <RotateCcw />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-xs" title="Inspect usage" aria-label="Inspect usage"
                          onClick={() => setInspectId(entity.id)}>
                          <Info />
                        </Button>
                        <Button
                          variant="ghost" size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          title="Delete" aria-label="Delete"
                          onClick={() => handleDelete(entity.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>

    <ConfirmDialog
      open={!!deleteIntent}
      onOpenChange={(open) => { if (!open) setDeleteIntent(null); }}
      state={confirmState}
    />

    <UsageInspectorDrawer
      entityId={inspectId}
      entityType="schedule"
      open={!!inspectId}
      onOpenChange={(open) => { if (!open) setInspectId(null); }}
    />
    </>
  );
}
