"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSearchableCombobox } from "@/components/ui/combobox";
import { PillGroup } from "@/components/ui/pill-group";
import { FINDING_CODE_LABELS } from "../lib/findingMessages";
import type { FindingCode, Severity } from "../types";

/**
 * What the list is showing.
 *
 * Severity and state in one control, because they were two controls doing one
 * job: a tab strip splitting "needs attention" from "suggestions" sat directly
 * above pills splitting errors from warnings from info. The same choice, asked
 * twice, in two rows — which is what forced the toolbar onto a second line.
 *
 * `info` reads as **Suggestions** here. "Info" names the severity constant; it
 * tells a reader nothing about what to do with the finding.
 */
export type ScopeFilter = Severity | "all" | "dismissed";

type Props = {
  scope: ScopeFilter;
  onScopeChange: (scope: ScopeFilter) => void;
  counts: { all: number; error: number; warning: number; info: number; dismissed: number };
  ruleCount: number;
  search: string;
  codeFilter: Set<FindingCode>;
  availableCodes: FindingCode[];
  onSearchChange: (value: string) => void;
  onCodeChange: (codes: FindingCode[]) => void;
  onClear: () => void;
};

export function DiagnosticsFilterBar({
  scope,
  onScopeChange,
  counts,
  ruleCount,
  search,
  codeFilter,
  availableCodes,
  onSearchChange,
  onCodeChange,
  onClear,
}: Props) {
  const anyActive = search.trim().length > 0 || scope !== "all" || codeFilter.size > 0;

  // Human labels, not constants. `RULE_IMPOSSIBLE_CONDITIONS` is what the code
  // calls it; "Contradictory conditions" is what a reader is looking for. The
  // combobox is also the app's own filter control — this bar used the only
  // hand-rolled dropdown filter in the product.
  const codeOptions = availableCodes.map((code) => ({
    id: code,
    name: FINDING_CODE_LABELS[code] ?? code,
  }));

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-2">
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search rules…"
          aria-label="Search findings by rule"
          className="h-7 w-52 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <PillGroup
        options={[
          { value: "all" as const, label: `All ${counts.all}` },
          { value: "error" as const, label: `Errors ${counts.error}` },
          { value: "warning" as const, label: `Warnings ${counts.warning}` },
          { value: "info" as const, label: `Suggestions ${counts.info}` },
          { value: "dismissed" as const, label: `Dismissed ${counts.dismissed}` },
        ]}
        value={scope}
        onChange={onScopeChange}
      />

      {/* Fixed width, because the combobox's own root is `flex-1` and would
          otherwise eat whatever the pills leave behind. Height matched to the
          filter pills beside it — the shared control is built for a form row,
          which is taller than a toolbar wants. */}
      <div className="flex w-72 shrink-0">
        <MultiSearchableCombobox
          options={codeOptions}
          values={[...codeFilter]}
          onChange={(values) => onCodeChange(values as FindingCode[])}
          placeholder="All checks"
          triggerClassName="min-h-0 h-6 flex-nowrap overflow-hidden rounded py-0 text-xs"
        />
      </div>

      {anyActive && (
        <Button variant="ghost" size="xs" onClick={onClear} aria-label="Clear all filters">
          <X className="h-3 w-3" />
          Clear filters
        </Button>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        {ruleCount} rule{ruleCount !== 1 ? "s" : ""} analysed
      </span>
    </div>
  );
}
