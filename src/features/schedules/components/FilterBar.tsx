"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";

export type StatusFilter = "all" | "active" | "completed";
export type AutoAddFilter = "all" | "auto" | "manual";
export type FrequencyFilter = "all" | "once" | "daily" | "weekly" | "monthly" | "yearly";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "active",    label: "Active" },
  { value: "completed", label: "Completed" },
];

const AUTO_ADD_OPTIONS: { value: AutoAddFilter; label: string }[] = [
  { value: "all",    label: "All" },
  { value: "auto",   label: "Auto Add" },
  { value: "manual", label: "Manual" },
];

const FREQUENCY_OPTIONS: { value: FrequencyFilter; label: string }[] = [
  { value: "all",     label: "All" },
  { value: "once",    label: "Once" },
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly",  label: "Yearly" },
];

export type EntityOption = { value: string; label: string };

type Props = {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  autoAddFilter: AutoAddFilter;
  onAutoAddFilterChange: (v: AutoAddFilter) => void;
  frequencyFilter: FrequencyFilter;
  onFrequencyFilterChange: (v: FrequencyFilter) => void;
  payeeFilter: string;
  onPayeeFilterChange: (v: string) => void;
  payeeOptions: EntityOption[];
  accountFilter: string;
  onAccountFilterChange: (v: string) => void;
  accountOptions: EntityOption[];
  filteredCount: number;
  totalCount: number;
  selectedCount: number;
  onBulkDelete: () => void;
  onDeselect: () => void;
};

const selectCls =
  "h-6 rounded border border-border bg-background px-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring";

export function FilterBar({
  search, onSearchChange,
  statusFilter, onStatusFilterChange,
  autoAddFilter, onAutoAddFilterChange,
  frequencyFilter, onFrequencyFilterChange,
  payeeFilter, onPayeeFilterChange, payeeOptions,
  accountFilter, onAccountFilterChange, accountOptions,
  filteredCount, totalCount,
  selectedCount, onBulkDelete, onDeselect,
}: Props) {
  if (selectedCount > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-primary/5 px-2 py-1.5">
        <span className="text-xs font-medium text-primary">{selectedCount} selected</span>
        <Button size="xs" variant="destructive" onClick={onBulkDelete}>Delete</Button>
        <button onClick={onDeselect} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
          Clear selection
        </button>
      </div>
    );
  }

  const hasFilters =
    search || statusFilter !== "all" || autoAddFilter !== "all" ||
    frequencyFilter !== "all" || payeeFilter !== "" || accountFilter !== "";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
      {/* Search */}
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          aria-label="Search schedules"
          className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button aria-label="Clear search" onClick={() => onSearchChange("")} className="absolute right-1.5 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <PillGroup options={STATUS_OPTIONS}    value={statusFilter}    onChange={onStatusFilterChange} />
      <PillGroup options={AUTO_ADD_OPTIONS}  value={autoAddFilter}   onChange={onAutoAddFilterChange} />
      <PillGroup options={FREQUENCY_OPTIONS} value={frequencyFilter} onChange={onFrequencyFilterChange} />

      {/* Payee filter */}
      {payeeOptions.length > 0 && (
        <select
          className={selectCls}
          value={payeeFilter}
          onChange={(e) => onPayeeFilterChange(e.target.value)}
          aria-label="Filter by payee"
        >
          <option value="">All Payees</option>
          {payeeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {/* Account filter */}
      {accountOptions.length > 0 && (
        <select
          className={selectCls}
          value={accountFilter}
          onChange={(e) => onAccountFilterChange(e.target.value)}
          aria-label="Filter by account"
        >
          <option value="">All Accounts</option>
          {accountOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {hasFilters && (
        <button
          onClick={() => {
            onSearchChange("");
            onStatusFilterChange("all");
            onAutoAddFilterChange("all");
            onFrequencyFilterChange("all");
            onPayeeFilterChange("");
            onAccountFilterChange("");
          }}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Clear
        </button>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        {filteredCount === totalCount ? `${totalCount} rows` : `${filteredCount} of ${totalCount}`}
      </span>
    </div>
  );
}
