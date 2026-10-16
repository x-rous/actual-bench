"use client";

import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { AccountPicker, PayeePicker } from "@/components/ui/entity-picker";
import type { Account, AccountGroup, Payee } from "@/types/entities";
import { SearchInput } from "@/components/ui/search-input";

export type StatusFilter = "active" | "all" | "missed" | "completed";
export type AutoAddFilter = "all" | "auto" | "manual";
export type FrequencyFilter = "all" | "once" | "daily" | "weekly" | "monthly" | "yearly";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active",    label: "Active" },
  { value: "all",       label: "All" },
  { value: "missed",    label: "Missed" },
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
  /** The payees and accounts some schedule uses: a filter only offers what can match. */
  payees: Payee[];
  accountFilter: string;
  onAccountFilterChange: (v: string) => void;
  accounts: Account[];
  accountGroups: AccountGroup[];
  filteredCount: number;
  totalCount: number;
  selectedCount: number;
  onBulkDelete: () => void;
  onDeselect: () => void;
};

export function FilterBar({
  search, onSearchChange,
  statusFilter, onStatusFilterChange,
  autoAddFilter, onAutoAddFilterChange,
  frequencyFilter, onFrequencyFilterChange,
  payeeFilter, onPayeeFilterChange, payees,
  accountFilter, onAccountFilterChange, accounts, accountGroups,
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
    search || statusFilter !== "active" || autoAddFilter !== "all" ||
    frequencyFilter !== "all" || payeeFilter !== "" || accountFilter !== "";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
      {/* Search */}
      <SearchInput
        value={search}
        onValueChange={onSearchChange}
        aria-label="Search schedules"
      />

      <PillGroup options={STATUS_OPTIONS}    value={statusFilter}    onChange={onStatusFilterChange} />
      <PillGroup options={AUTO_ADD_OPTIONS}  value={autoAddFilter}   onChange={onAutoAddFilterChange} />
      <PillGroup options={FREQUENCY_OPTIONS} value={frequencyFilter} onChange={onFrequencyFilterChange} />

      {/* Payee filter */}
      {payees.length > 0 && (
        <div className="w-44">
          <PayeePicker
            size="sm"
            className="h-6"
            payees={payees}
            value={payeeFilter}
            onChange={onPayeeFilterChange}
            ariaLabel="Filter by payee"
            placeholder="All payees"
            allowNone
            noneLabel="All payees"
          />
        </div>
      )}

      {/* Account filter */}
      {accounts.length > 0 && (
        <div className="w-44">
          <AccountPicker
            size="sm"
            className="h-6"
            accounts={accounts}
            groups={accountGroups}
            value={accountFilter}
            onChange={onAccountFilterChange}
            ariaLabel="Filter by account"
            placeholder="All accounts"
            allowNone
            noneLabel="All accounts"
          />
        </div>
      )}

      {hasFilters && (
        <button
          onClick={() => {
            onSearchChange("");
            onStatusFilterChange("active");
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
