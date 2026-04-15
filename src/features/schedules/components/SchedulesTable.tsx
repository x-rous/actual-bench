"use client";

import { useState, useMemo } from "react";
import { useHighlight } from "@/hooks/useHighlight";
import { useTableSelection } from "@/hooks/useTableSelection";
import { Pencil, Trash2, RotateCcw, Copy, Braces, AlertTriangle, Info, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { recurSummary, frequencyLabel } from "../lib/recurSummary";
import { FilterBar } from "./FilterBar";
import type { ScheduleDeleteIntent } from "./SchedulesTableOverlays";
import type { AutoAddFilter, FrequencyFilter, EntityOption } from "./FilterBar";
import type { StagedEntity } from "@/types/staged";
import type { Schedule, ScheduleAmountRange } from "@/types/entities";

// ─── Amount display helper ────────────────────────────────────────────────────

function formatAmount(
  amount: number | ScheduleAmountRange | null | undefined,
  amountOp: Schedule["amountOp"]
): string {
  if (amountOp === "isbetween" && amount != null && typeof amount === "object" && "num1" in amount && "num2" in amount) {
    const range = amount as ScheduleAmountRange;
    const n1 = (range.num1 / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const n2 = (range.num2 / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n1} – ${n2}`;
  }

  const numericAmount = typeof amount === "number" ? amount : 0;
  const normalizedOp = amountOp === "is" ? "is" : "isapprox";
  const display = (numericAmount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return normalizedOp === "isapprox" ? `≈ ${display}` : display;
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
  onDeleteIntentChange: (intent: ScheduleDeleteIntent | null) => void;
  onInspectIdChange: (id: string | null) => void;
};

export function SchedulesTable({
  onEdit,
  onEditAsRule,
  onDeleteIntentChange,
  onInspectIdChange,
}: Props) {
  const staged          = useStagedStore((s) => s.schedules);
  const stagedPayees    = useStagedStore((s) => s.payees);
  const stagedAccounts  = useStagedStore((s) => s.accounts);
  const stageNew        = useStagedStore((s) => s.stageNew);
  const stageDelete     = useStagedStore((s) => s.stageDelete);
  const revertEntity    = useStagedStore((s) => s.revertEntity);
  const clearSaveError  = useStagedStore((s) => s.clearSaveError);
  const pushUndo        = useStagedStore((s) => s.pushUndo);

  const highlightedId = useHighlight();

  const [search, setSearch]                       = useState("");
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
  }, [staged, search, autoAddFilter, frequencyFilter, payeeFilter, accountFilter, stagedPayees, stagedAccounts]);

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
    onDeleteIntentChange({
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
    onDeleteIntentChange({
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
            {(search || autoAddFilter !== "all" || frequencyFilter !== "all" || payeeFilter || accountFilter) && (
              <button
                className="text-xs underline hover:text-foreground"
                onClick={() => { setSearch(""); setAutoAddFilter("all"); setFrequencyFilter("all"); setPayeeFilter(""); setAccountFilter(""); }}
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
                <th className="w-20 px-3 py-2 text-center font-medium">Recurring</th>
                <th className="w-36 px-3 py-2 text-right font-medium">Amount</th>
                <th className="w-[24rem] px-3 py-2 text-left font-medium">Repeats</th>
                <th className="w-36 px-3 py-2 text-left font-medium">Payee</th>
                <th className="w-36 px-3 py-2 text-left font-medium">Account</th>
                <th className="w-20 px-3 py-2 text-center font-medium">Auto Add</th>
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

                    {/* Recurring */}
                    <td className="px-3 py-2 text-center">
                      {typeof entity.date !== "string" ? (
                        <span
                          className="inline-flex items-center justify-center text-primary"
                          title="Recurring schedule"
                          aria-label="Recurring schedule"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(entity.amount, entity.amountOp)}
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
                      {entity.postsTransaction ? "Auto" : <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* Row actions */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div
                        className={cn(
                          "flex items-center justify-end gap-0.5 transition-opacity",
                          saveError || isDeleted
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        )}
                      >
                        <Button variant="ghost" size="icon-xs" title="Edit schedule" aria-label="Edit schedule" onClick={() => onEdit(entity.id)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-xs" title="Duplicate schedule" aria-label="Duplicate schedule" onClick={() => handleDuplicate(entity)}>
                          <Copy />
                        </Button>
                        {entity.ruleId && (
                          <Button variant="ghost" size="icon-xs" title="Open linked rule" aria-label="Open linked rule" onClick={() => onEditAsRule(entity.ruleId!)}>
                            <Braces />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Inspect usage"
                          aria-label="Inspect usage"
                          onClick={() => onInspectIdChange(entity.id)}
                        >
                          <Info />
                        </Button>
                        {(isNew || isUpdated) && !isDeleted && (
                          <Button variant="ghost" size="icon-xs" title="Revert changes" aria-label="Revert changes" onClick={() => revertEntity("schedules", entity.id)}>
                            <RotateCcw />
                          </Button>
                        )}
                        {saveError && (
                          <Button variant="ghost" size="icon-xs" title="Clear error" aria-label="Clear error" onClick={() => clearSaveError("schedules", entity.id)}>
                            <RefreshCw />
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          title="Delete schedule" aria-label="Delete schedule"
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
    </>
  );
}
