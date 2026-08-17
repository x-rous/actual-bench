"use client";

import { Search, X } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import type { ConfidenceBand } from "../lib/confidence";

export type CleanupTab = "suggestions" | "unused" | "rule-gaps" | "dismissed";
export type BandFilter = "all" | ConfidenceBand;

const BAND_FILTERS: { value: BandFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "strong", label: "Likely" },
  { value: "review", label: "Needs review" },
  { value: "hidden", label: "Low" },
];

type Props = {
  tab: CleanupTab;
  onTabChange: (tab: CleanupTab) => void;
  band: BandFilter;
  onBandChange: (band: BandFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  counts: {
    suggestions: number;
    unused: number;
    ruleGaps: number;
    dismissed: number;
  };
};

/**
 * Search and filters in one row (F-096 follow-up).
 *
 * Deliberately the same shape as Rule Diagnostics' filter bar: same position,
 * same search affordance, same pill groups. Two tools that do the same kind of
 * job should not need to be learned twice.
 */
export function CleanupFilterBar({
  tab,
  onTabChange,
  band,
  onBandChange,
  search,
  onSearchChange,
  counts,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-2">
      <div className="relative flex items-center">
        <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search payees…"
          aria-label="Search payees"
          className="h-7 w-56 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {search ? (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <PillGroup
        options={[
          { value: "suggestions" as const, label: `Suggestions ${counts.suggestions}` },
          { value: "unused" as const, label: `Unused ${counts.unused}` },
          // Third, not last: Dismissed is the archive and belongs at the end.
          { value: "rule-gaps" as const, label: `Needs a rule ${counts.ruleGaps}` },
          { value: "dismissed" as const, label: `Dismissed ${counts.dismissed}` },
        ]}
        value={tab}
        onChange={onTabChange}
      />

      {tab === "suggestions" ? (
        <>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Confidence
          </span>
          <PillGroup options={BAND_FILTERS} value={band} onChange={onBandChange} />
        </>
      ) : null}
    </div>
  );
}
