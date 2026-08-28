"use client";

import { Search, X } from "lucide-react";
import { MultiPillGroup } from "@/components/ui/pill-group";
import { runStatusLabel } from "../lib/presentation";
import type { RunHistory } from "../lib/automationsApi";
import type { AutomationRunStatus } from "@/lib/app-db/types";

/**
 * Narrowing the run history (RD-079).
 *
 * Deliberately the same bar as the automations list: search, pills, selects,
 * a count, a way out. Two screens in one feature asking the same question -
 * which of these rows do I mean - should not answer it with two different
 * controls.
 *
 * Outcome allows more than one at a time, because "failed or partial" is one
 * thought, not two searches.
 */

const STATUS_OPTIONS: { value: AutomationRunStatus; label: string }[] = [
  { value: "failed", label: runStatusLabel("failed") },
  { value: "partial", label: runStatusLabel("partial") },
  { value: "succeeded", label: runStatusLabel("succeeded") },
  { value: "no_changes", label: runStatusLabel("no_changes") },
  { value: "running", label: runStatusLabel("running") },
  { value: "cancelled", label: runStatusLabel("cancelled") },
];

export function RunHistoryFilterBar({
  search,
  onSearchChange,
  statuses,
  onStatusesChange,
  automationId,
  onAutomationChange,
  type,
  onTypeChange,
  options,
  filteredCount,
  totalCount,
  capped,
  actions,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  statuses: AutomationRunStatus[];
  onStatusesChange: (value: AutomationRunStatus[]) => void;
  automationId: string;
  onAutomationChange: (value: string) => void;
  type: string;
  onTypeChange: (value: string) => void;
  options: Pick<RunHistory, "automations" | "jobTypes"> | undefined;
  filteredCount: number;
  totalCount: number;
  /** The server returned as many runs as it will: say so once, in the count. */
  capped: boolean;
  /** Page-level controls, right-aligned - rather than a row of their own. */
  actions?: React.ReactNode;
}) {
  const filtering =
    search.trim() !== "" || statuses.length > 0 || automationId !== "" || type !== "";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-1.5">
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 size-3.5 text-muted-foreground" aria-hidden />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search runs…"
          aria-label="Search runs"
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

      <MultiPillGroup options={STATUS_OPTIONS} values={statuses} onChange={onStatusesChange} />

      {(options?.automations.length ?? 0) > 1 && (
        <select
          className="h-6 rounded border border-border bg-background px-1.5 text-xs"
          value={automationId}
          onChange={(event) => onAutomationChange(event.target.value)}
          aria-label="Filter by automation"
        >
          <option value="">Any automation</option>
          {options?.automations.map((automation) => (
            <option key={automation.id} value={automation.id}>
              {automation.name}
            </option>
          ))}
        </select>
      )}

      {(options?.jobTypes.length ?? 0) > 1 && (
        <select
          className="h-6 rounded border border-border bg-background px-1.5 text-xs"
          value={type}
          onChange={(event) => onTypeChange(event.target.value)}
          aria-label="Filter by kind"
        >
          <option value="">Any kind</option>
          {options?.jobTypes.map((jobType) => (
            <option key={jobType.type} value={jobType.type}>
              {jobType.label}
            </option>
          ))}
        </select>
      )}

      {/* One statement about how many, including the cap. Saying "200" and then
          "newest 200 shown" beside it is the same fact twice. */}
      <span className="text-xs text-muted-foreground">
        {search.trim() ? `${filteredCount} of ` : ""}
        {capped ? `newest ${totalCount}` : totalCount} {totalCount === 1 ? "run" : "runs"}
      </span>

      {filtering && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            onSearchChange("");
            onStatusesChange([]);
            onAutomationChange("");
            onTypeChange("");
          }}
        >
          Clear
        </button>
      )}

      {actions && (
        <>
          <span className="flex-1" />
          {actions}
        </>
      )}
    </div>
  );
}
