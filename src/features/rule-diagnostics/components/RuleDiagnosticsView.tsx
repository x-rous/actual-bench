"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { useRuleDiagnostics } from "../hooks/useRuleDiagnostics";
import type { Finding, FindingCode, Severity } from "../types";
import { DiagnosticSummaryCards } from "./DiagnosticSummaryCards";
import { DiagnosticsFilterBar } from "./DiagnosticsFilterBar";
import { DiagnosticsTable } from "./DiagnosticsTable";

function summarize(findings: Finding[]) {
  const summary = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const f of findings) summary[f.severity] += 1;
  return summary;
}

function applyFilters(
  findings: Finding[],
  severityFilter: Set<Severity>,
  codeFilter: Set<FindingCode>
): Finding[] {
  if (severityFilter.size === 0 && codeFilter.size === 0) return findings;
  return findings.filter((f) => {
    if (severityFilter.size > 0 && !severityFilter.has(f.severity)) return false;
    if (codeFilter.size > 0 && !codeFilter.has(f.code)) return false;
    return true;
  });
}

function uniqueCodes(findings: Finding[]): FindingCode[] {
  const seen = new Set<FindingCode>();
  for (const f of findings) seen.add(f.code);
  return [...seen].sort();
}

export function RuleDiagnosticsView() {
  const { report, running, error, stale, refresh } = useRuleDiagnostics();

  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set());
  const [codeFilter, setCodeFilter] = useState<Set<FindingCode>>(new Set());

  const allFindings = useMemo(() => report?.findings ?? [], [report]);
  const visibleFindings = useMemo(
    () => applyFilters(allFindings, severityFilter, codeFilter),
    [allFindings, severityFilter, codeFilter]
  );
  const visibleSummary = useMemo(() => summarize(visibleFindings), [visibleFindings]);
  const availableCodes = useMemo(() => uniqueCodes(allFindings), [allFindings]);

  const totalReportFindings = report?.summary.total ?? 0;
  const count = report
    ? severityFilter.size === 0 && codeFilter.size === 0
      ? `${totalReportFindings} finding${totalReportFindings !== 1 ? "s" : ""}`
      : `${visibleSummary.total} of ${totalReportFindings} finding${totalReportFindings !== 1 ? "s" : ""}`
    : undefined;
  const isEmptyReport = report !== null && !running && !error && totalReportFindings === 0;

  const toggleSeverity = (sev: Severity) => {
    setSeverityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  };

  const toggleCode = (code: FindingCode) => {
    setCodeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const clearFilters = () => {
    setSeverityFilter(new Set());
    setCodeFilter(new Set());
  };

  const actions = (
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
              Results are out of date — the working set has changed since this report was generated.
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
            <span>Your rule set looks clean.</span>
          </div>
        ) : (
          report && (
            <>
              <DiagnosticsFilterBar
                severityFilter={severityFilter}
                codeFilter={codeFilter}
                availableCodes={availableCodes}
                onSeverityToggle={toggleSeverity}
                onCodeToggle={toggleCode}
                onClear={clearFilters}
              />
              <div className="px-4 py-3">
                <DiagnosticSummaryCards summary={visibleSummary} />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <DiagnosticsTable findings={visibleFindings} />
              </div>
            </>
          )
        )}
      </div>
    </PageLayout>
  );
}
