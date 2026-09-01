"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { useRuleDiagnostics } from "../hooks/useRuleDiagnostics";
import { useRuleDiagnosticsDismissals } from "../hooks/useRuleDiagnosticsDismissals";
import { applyDismissals, collectGarbage, type DismissalSplit } from "../lib/dismissals";
import type { Finding, FindingCode } from "../types";
import { DiagnosticSummaryCards } from "./DiagnosticSummaryCards";
import {
  DiagnosticsFilterBar,
  type SeverityFilterValue,
} from "./DiagnosticsFilterBar";
import { DiagnosticsTable } from "./DiagnosticsTable";

function summarize(findings: Finding[]) {
  const summary = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const f of findings) summary[f.severity] += 1;
  return summary;
}

function findingMatchesSearch(finding: Finding, query: string): boolean {
  if (query.length === 0) return true;
  for (const r of finding.affected) {
    if (r.summary.toLowerCase().includes(query)) return true;
  }
  if (finding.counterpart && finding.counterpart.summary.toLowerCase().includes(query)) {
    return true;
  }
  return false;
}

function applyFilters(
  findings: Finding[],
  search: string,
  severityFilter: SeverityFilterValue,
  codeFilter: Set<FindingCode>
): Finding[] {
  const trimmedSearch = search.trim().toLowerCase();
  if (
    trimmedSearch.length === 0 &&
    severityFilter === "all" &&
    codeFilter.size === 0
  ) {
    return findings;
  }
  return findings.filter((f) => {
    if (severityFilter !== "all" && f.severity !== severityFilter) return false;
    if (codeFilter.size > 0 && !codeFilter.has(f.code)) return false;
    if (!findingMatchesSearch(f, trimmedSearch)) return false;
    return true;
  });
}

function uniqueCodes(findings: Finding[]): FindingCode[] {
  const seen = new Set<FindingCode>();
  for (const f of findings) seen.add(f.code);
  return [...seen].sort();
}

/**
 * The findings the user has judged, and the way back.
 *
 * Rendered in both the populated and the empty state: dismissing the last
 * finding is exactly when someone is most likely to want one back, and hiding
 * the list there would make dismissal a one-way door.
 *
 * Deliberately plain — PR-050 replaces it with a proper Dismissed tab.
 */
function DismissedPanel({
  dismissed,
  expanded,
  onToggle,
  onRestore,
}: {
  dismissed: DismissalSplit["dismissed"];
  expanded: boolean;
  onToggle: () => void;
  onRestore: (id: string) => void;
}) {
  if (dismissed.length === 0) return null;
  const count = dismissed.length;
  return (
    <div className="border-t border-border/50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40"
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "Show"} {count} dismissed finding{count !== 1 ? "s" : ""}
      </button>
      {expanded && (
        <ul className="flex flex-col">
          {dismissed.map(({ finding, record }) => (
            <li
              key={record.id}
              className="flex flex-wrap items-center gap-2 border-t border-border/40 px-4 py-2 text-xs"
            >
              <span className="text-muted-foreground">{finding.title}</span>
              <span className="truncate text-muted-foreground/70">
                {finding.affected.map((r) => r.summary).join(" · ")}
              </span>
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto"
                onClick={() => onRestore(record.id)}
                aria-label={`Restore: ${finding.title}`}
              >
                <Undo2 className="h-3 w-3" />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RuleDiagnosticsView() {
  const router = useRouter();
  const { report, running, error, stale, refresh, rules } = useRuleDiagnostics();
  const {
    dismissals,
    dismiss,
    restore,
    collectGarbage: collect,
  } = useRuleDiagnosticsDismissals({ enabled: report !== null });

  const [search, setSearch] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilterValue>("all");
  const [codeFilter, setCodeFilter] = useState<Set<FindingCode>>(new Set());

  const rulesById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);

  const split = useMemo(
    () => applyDismissals(report?.findings ?? [], dismissals, rulesById),
    [report, dismissals, rulesById]
  );

  // Drop the records that can never match again — every participant gone by
  // both id and signature, which is what merging a family away leaves behind.
  // Guarded by the report so it never runs against an unloaded rule set, and
  // once per report so a failed request does not retry in a loop.
  const collectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!report || dismissals.length === 0) return;
    if (collectedFor.current === report.runAt) return;
    collectedFor.current = report.runAt;
    const stale = collectGarbage(dismissals, rules);
    if (stale.length > 0) collect(stale);
  }, [report, dismissals, rules, collect]);

  const allFindings = split.visible;
  const visibleFindings = useMemo(
    () => applyFilters(allFindings, search, severityFilter, codeFilter),
    [allFindings, search, severityFilter, codeFilter]
  );
  const visibleSummary = useMemo(() => summarize(visibleFindings), [visibleFindings]);
  const availableCodes = useMemo(() => uniqueCodes(allFindings), [allFindings]);

  const totalReportFindings = allFindings.length;
  const isFiltered =
    search.trim().length > 0 || severityFilter !== "all" || codeFilter.size > 0;
  const count = report
    ? !isFiltered
      ? `${totalReportFindings} finding${totalReportFindings !== 1 ? "s" : ""}`
      : `${visibleSummary.total} of ${totalReportFindings} finding${totalReportFindings !== 1 ? "s" : ""}`
    : undefined;
  const isEmptyReport = report !== null && !running && !error && totalReportFindings === 0;
  const dismissedCount = split.dismissed.length;

  const toggleCode = (code: FindingCode) => {
    setCodeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setSeverityFilter("all");
    setCodeFilter(new Set());
  };

  const actions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/rules")}
        aria-label="Back to rules"
        title="Back to rules"
      >
        <ArrowLeft />
        Back to Rules
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={refresh}
        disabled={running}
        aria-label="Refresh rule diagnostics"
      >
        <RefreshCw className={running ? "animate-spin" : undefined} />
        Refresh
      </Button>
    </>
  );

  return (
    <PageLayout
      title="Rule Diagnostics"
      count={count}
      actions={actions}
      isLoading={running && report === null}
      isError={!!error && report === null}
      error={error ? new Error(error) : undefined}
      onRetry={refresh}
      scrollManaged
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {stale && (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-400"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Results are out of date - the working set has changed since this report was generated.
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={refresh}
              className="ml-auto h-6"
              aria-label="Refresh to get current results"
            >
              Refresh
            </Button>
          </div>
        )}

        {isEmptyReport ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <span className="text-base font-medium text-foreground">No issues found</span>
            <span>
              {dismissedCount > 0
                ? `Your rule set looks clean. ${dismissedCount} finding${dismissedCount !== 1 ? "s" : ""} you dismissed ${dismissedCount !== 1 ? "are" : "is"} hidden.`
                : "Your rule set looks clean."}
            </span>
            {dismissedCount > 0 && (
              <div className="w-full max-w-2xl">
                <DismissedPanel
                  dismissed={split.dismissed}
                  expanded={showDismissed}
                  onToggle={() => setShowDismissed((v) => !v)}
                  onRestore={restore}
                />
              </div>
            )}
          </div>
        ) : (
          report && (
            <>
              <DiagnosticsFilterBar
                search={search}
                severityFilter={severityFilter}
                codeFilter={codeFilter}
                availableCodes={availableCodes}
                onSearchChange={setSearch}
                onSeverityChange={setSeverityFilter}
                onCodeToggle={toggleCode}
                onClear={clearFilters}
              />
              <div className="px-4 py-3">
                <DiagnosticSummaryCards summary={visibleSummary} />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <DiagnosticsTable
                  findings={visibleFindings}
                  onDismiss={(finding) => dismiss(finding, rulesById)}
                />
                <DismissedPanel
                  dismissed={split.dismissed}
                  expanded={showDismissed}
                  onToggle={() => setShowDismissed((v) => !v)}
                  onRestore={restore}
                />
              </div>
            </>
          )
        )}
      </div>
    </PageLayout>
  );
}
