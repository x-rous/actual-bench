"use client";

import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { FindingCode, Severity } from "../types";

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "error", label: "Errors" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "Info" },
];

type Props = {
  severityFilter: Set<Severity>;
  codeFilter: Set<FindingCode>;
  availableCodes: FindingCode[];
  onSeverityToggle: (severity: Severity) => void;
  onCodeToggle: (code: FindingCode) => void;
  onClear: () => void;
};

export function DiagnosticsFilterBar({
  severityFilter,
  codeFilter,
  availableCodes,
  onSeverityToggle,
  onCodeToggle,
  onClear,
}: Props) {
  const anyActive = severityFilter.size > 0 || codeFilter.size > 0;
  const codeButtonLabel =
    codeFilter.size === 0
      ? "All codes"
      : codeFilter.size === 1
        ? [...codeFilter][0]
        : `${codeFilter.size} codes`;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Severity</span>
      <div className="flex gap-px rounded border border-border bg-muted/40 p-px">
        {SEVERITY_OPTIONS.map((opt) => {
          const isActive = severityFilter.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSeverityToggle(opt.value)}
              aria-pressed={isActive}
              aria-label={`Toggle ${opt.label.toLowerCase()} filter`}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                isActive
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

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
