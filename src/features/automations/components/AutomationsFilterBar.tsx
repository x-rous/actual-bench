"use client";

import { Search, X } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import type { AutomationJobTypeSummary, AutomationListItem } from "../lib/automationsApi";

/**
 * Narrowing the list of automations (RD-079).
 *
 * Same shape as the filter bars on the entity pages - search, pills, a count -
 * because this is the same task: find the row you mean among rows that all look
 * alike. Status leads, because the question people arrive with is "what is
 * broken", and it is the one filter worth a single click.
 */

export type AutomationStatusFilter = "all" | "ok" | "warning" | "failing" | "paused";

const STATUS_OPTIONS: { value: AutomationStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failing", label: "Failing" },
  { value: "warning", label: "Attention" },
  { value: "paused", label: "Paused" },
  { value: "ok", label: "Healthy" },
];

export function AutomationsFilterBar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  type,
  onTypeChange,
  jobTypes,
  filteredCount,
  totalCount,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  status: AutomationStatusFilter;
  onStatusChange: (value: AutomationStatusFilter) => void;
  type: string;
  onTypeChange: (value: string) => void;
  jobTypes: AutomationJobTypeSummary[];
  filteredCount: number;
  totalCount: number;
}) {
  const filtering = search.trim() !== "" || status !== "all" || type !== "";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-1.5">
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 size-3.5 text-muted-foreground" aria-hidden />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search automations…"
          aria-label="Search automations"
          className="h-6 w-52 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>

      <PillGroup options={STATUS_OPTIONS} value={status} onChange={onStatusChange} />

      {jobTypes.length > 1 && (
        <select
          className="h-6 rounded border border-border bg-background px-1.5 text-xs"
          value={type}
          onChange={(event) => onTypeChange(event.target.value)}
          aria-label="Filter by kind"
        >
          <option value="">Any kind</option>
          {jobTypes.map((jobType) => (
            <option key={jobType.type} value={jobType.type}>
              {jobType.label}
            </option>
          ))}
        </select>
      )}

      <span className="text-xs text-muted-foreground">
        {filtering ? `${filteredCount} of ${totalCount}` : `${totalCount}`}
      </span>

      {filtering && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            onSearchChange("");
            onStatusChange("all");
            onTypeChange("");
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

/** Rows matching the current filters, in the order they were given. */
export function filterAutomations(
  automations: AutomationListItem[],
  filters: { search: string; status: AutomationStatusFilter; type: string }
): AutomationListItem[] {
  const needle = filters.search.trim().toLowerCase();

  return automations.filter((automation) => {
    if (filters.status !== "all" && automation.status !== filters.status) return false;
    if (filters.type && automation.type !== filters.type) return false;
    if (!needle) return true;

    // Searched over what is on the row: someone types what they can see.
    return [automation.name, automation.typeLabel, automation.scheduleLabel, automation.statusSummary]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLowerCase().includes(needle));
  });
}
