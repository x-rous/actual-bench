"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PillGroup } from "@/components/ui/pill-group";
import { cn } from "@/lib/utils";
import type { FindingCode, Severity } from "../types";

export type SeverityFilterValue = Severity | "all";

const SEVERITY_OPTIONS: { value: SeverityFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "error", label: "Errors" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "Info" },
];

type Props = {
  search: string;
  severityFilter: SeverityFilterValue;
  codeFilter: Set<FindingCode>;
  availableCodes: FindingCode[];
  onSearchChange: (value: string) => void;
  onSeverityChange: (severity: SeverityFilterValue) => void;
  onCodeToggle: (code: FindingCode) => void;
  onClear: () => void;
};

export function DiagnosticsFilterBar({
  search,
  severityFilter,
  codeFilter,
  availableCodes,
  onSearchChange,
  onSeverityChange,
  onCodeToggle,
  onClear,
}: Props) {
  const anyActive =
    search.trim().length > 0 || severityFilter !== "all" || codeFilter.size > 0;
  const codeButtonLabel =
    codeFilter.size === 0
      ? "All codes"
      : codeFilter.size === 1
        ? [...codeFilter][0]
        : `${codeFilter.size} codes`;

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
          className="h-7 w-56 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
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

      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Severity</span>
      <PillGroup
        options={SEVERITY_OPTIONS}
        value={severityFilter}
        onChange={onSeverityChange}
      />

      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Code</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-7 min-w-[18rem] items-center justify-between gap-1 rounded-[12px] border border-border bg-background px-2.5 text-[0.8rem] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Filter by finding code"
        >
          <span className="truncate font-mono text-[11px]">{codeButtonLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 min-w-[18rem] max-w-[28rem] overflow-y-auto p-1"
        >
          {availableCodes.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">No codes available</div>
          ) : (
            availableCodes.map((code) => {
              const isActive = codeFilter.has(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onCodeToggle(code)}
                  aria-pressed={isActive}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted",
                    isActive && "bg-muted font-medium"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                      isActive ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    )}
                    aria-hidden="true"
                  >
                    {isActive && "✓"}
                  </span>
                  <span className="font-mono text-[11px]">{code}</span>
                </button>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {anyActive && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onClear}
          aria-label="Clear all filters"
          className="ml-auto"
        >
          <X className="h-3 w-3" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
