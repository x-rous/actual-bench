"use client";

import { PillGroup } from "@/components/ui/pill-group";
import type { ConfidenceBand } from "../lib/confidence";
import { SearchInput } from "@/components/ui/search-input";

export type CleanupTab = "suggestions" | "unused" | "rule-gaps" | "dismissed";

const CLEANUP_TABS: CleanupTab[] = ["suggestions", "rule-gaps", "unused", "dismissed"];

/** Guards the tab read out of the URL, which anyone can type anything into. */
export function isCleanupTab(value: string | null): value is CleanupTab {
  return value !== null && (CLEANUP_TABS as string[]).includes(value);
}
export type BandFilter = "all" | ConfidenceBand;

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
    high: number;
    strong: number;
    review: number;
    hidden: number;
  };
};

/** Search and workflow navigation stay visible while each list scrolls. */
export function CleanupFilterBar({
  tab,
  onTabChange,
  band,
  onBandChange,
  search,
  onSearchChange,
  counts,
}: Props) {
  const bandFilters: { value: BandFilter; label: string }[] = [
    { value: "all", label: "All " + counts.suggestions },
    { value: "high", label: "High " + counts.high },
    { value: "strong", label: "Likely " + counts.strong },
    { value: "review", label: "Needs review " + counts.review },
    { value: "hidden", label: "Low " + counts.hidden },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-2">
      <SearchInput
        value={search}
        onValueChange={onSearchChange}
        placeholder="Search payees…"
        aria-label="Search payees"
      />

      <PillGroup
        options={[
          { value: "suggestions" as const, label: "Duplicate payees " + counts.suggestions },
          { value: "rule-gaps" as const, label: "Payees needing rules " + counts.ruleGaps },
          { value: "unused" as const, label: "Unused payees " + counts.unused },
          { value: "dismissed" as const, label: "Dismissed " + counts.dismissed },
        ]}
        value={tab}
        onChange={onTabChange}
      />

      {tab === "suggestions" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Confidence
          </span>
          <PillGroup options={bandFilters} value={band} onChange={onBandChange} />
        </div>
      ) : null}
    </div>
  );
}
