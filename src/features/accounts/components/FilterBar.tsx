"use client";

import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import { NEW_GROUP, NO_GROUP } from "../lib/accountGroups";

export type StatusFilter = "all" | "open" | "closed";
export type BudgetFilter = "all" | "on" | "off";
export type RulesFilter = "all" | "with_rules" | "no_rules";

/** Group filter value for "any group"; NO_GROUP and group ids are the other values. */
export const ALL_GROUPS = "all";

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

export const BUDGET_OPTIONS: { value: BudgetFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "on", label: "On Budget" },
  { value: "off", label: "Off Budget" },
];

export const RULES_OPTIONS: { value: RulesFilter; label: string }[] = [
  { value: "all",        label: "All" },
  { value: "with_rules", label: "Has Rules" },
  { value: "no_rules",   label: "No Rules" },
];

export function FilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  budgetFilter,
  onBudgetChange,
  rulesFilter,
  onRulesFilterChange,
  groupFilter,
  onGroupFilterChange,
  groupFilterOptions,
  groupAssignOptions,
  onBulkAssignGroup,
  filteredCount,
  totalCount,
  selectedCount,
  onBulkClose,
  onBulkReopen,
  onBulkDelete,
  onDeselect,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  budgetFilter: BudgetFilter;
  onBudgetChange: (v: BudgetFilter) => void;
  rulesFilter: RulesFilter;
  onRulesFilterChange: (v: RulesFilter) => void;
  /** Group filter and bulk assign are shown only when these options are provided (server has groups). */
  groupFilter: string;
  onGroupFilterChange: (v: string) => void;
  groupFilterOptions?: SelectOption[];
  groupAssignOptions?: SelectOption[];
  /** `groupId` is a group id, NO_GROUP-resolved `null`, or NEW_GROUP to open the new-group dialog. */
  onBulkAssignGroup: (groupId: string | null | typeof NEW_GROUP) => void;
  filteredCount: number;
  totalCount: number;
  selectedCount: number;
  onBulkClose: () => void;
  onBulkReopen: () => void;
  onBulkDelete: () => void;
  onDeselect: () => void;
}) {
  const hasFilters =
    search || statusFilter !== "all" || budgetFilter !== "all" || rulesFilter !== "all" || groupFilter !== ALL_GROUPS;

  if (selectedCount > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-primary/5 px-2 py-1.5">
        <span className="text-xs font-medium text-primary">{selectedCount} selected</span>
        <Button size="xs" variant="outline" onClick={onBulkClose}>
          Close All
        </Button>
        <Button size="xs" variant="outline" onClick={onBulkReopen}>
          Reopen All
        </Button>
        {groupAssignOptions && (
          <div className="w-40">
            <Select
              size="sm"
              value=""
              placeholder="Move to group…"
              aria-label="Move selected accounts to a group"
              options={groupAssignOptions}
              onValueChange={(next) => {
                if (next === NEW_GROUP) onBulkAssignGroup(NEW_GROUP);
                else onBulkAssignGroup(next === "" || next === NO_GROUP ? null : next);
              }}
            />
          </div>
        )}
        <Button size="xs" variant="destructive" onClick={onBulkDelete}>
          Delete
        </Button>
        <button
          onClick={onDeselect}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          Clear selection
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
      <SearchInput
        value={search}
        onValueChange={onSearchChange}
        aria-label="Search accounts"
      />

      <PillGroup options={STATUS_OPTIONS} value={statusFilter} onChange={onStatusChange} />
      <PillGroup options={BUDGET_OPTIONS} value={budgetFilter} onChange={onBudgetChange} />
      <PillGroup options={RULES_OPTIONS} value={rulesFilter} onChange={onRulesFilterChange} />
      {groupFilterOptions && (
        <div className="w-40">
          <Select
            size="sm"
            value={groupFilter}
            aria-label="Filter by account group"
            options={groupFilterOptions}
            onValueChange={onGroupFilterChange}
          />
        </div>
      )}

      {hasFilters && (
        <button
          onClick={() => {
            onSearchChange("");
            onStatusChange("all");
            onBudgetChange("all");
            onRulesFilterChange("all");
            onGroupFilterChange(ALL_GROUPS);
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
