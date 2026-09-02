"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ListChecks, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { useRuleDiagnostics } from "../hooks/useRuleDiagnostics";
import { useRuleDiagnosticsDismissals } from "../hooks/useRuleDiagnosticsDismissals";
import { applyDismissals, collectGarbage } from "../lib/dismissals";
import type { Finding, FindingCode } from "../types";
import { DiagnosticsFilterBar, type ScopeFilter } from "./DiagnosticsFilterBar";
import { DiagnosticsTable } from "./DiagnosticsTable";

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
  codeFilter: Set<FindingCode>
): Finding[] {
  const trimmedSearch = search.trim().toLowerCase();
  if (trimmedSearch.length === 0 && codeFilter.size === 0) {
    return findings;
  }
  return findings.filter((f) => {
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
  const [scope, setScope] = useState<ScopeFilter>("all");
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

  const dismissedFindings = useMemo(
    () => split.dismissed.map((d) => d.finding),
    [split.dismissed]
  );
  const recordByFinding = useMemo(
    () => new Map(split.dismissed.map((d) => [d.finding, d.record])),
    [split.dismissed]
  );

  const scopeCounts = useMemo(() => {
    const counts = {
      all: split.visible.length,
      error: 0,
      warning: 0,
      info: 0,
      dismissed: split.dismissed.length,
    };
    for (const f of split.visible) counts[f.severity] += 1;
    return counts;
  }, [split]);

  const inScope = useMemo(() => {
    if (scope === "dismissed") return dismissedFindings;
    if (scope === "all") return split.visible;
    return split.visible.filter((f) => f.severity === scope);
  }, [scope, split.visible, dismissedFindings]);

  const visibleFindings = useMemo(
    () => applyFilters(inScope, search, codeFilter),
    [inScope, search, codeFilter]
  );
  const availableCodes = useMemo(
    () => uniqueCodes([...split.visible, ...dismissedFindings]),
    [split.visible, dismissedFindings]
  );

  const scopeTotal = inScope.length;
  const isFiltered = search.trim().length > 0 || codeFilter.size > 0;
  const count = report
    ? !isFiltered
      ? `${scopeTotal} finding${scopeTotal !== 1 ? "s" : ""}`
      : `${visibleFindings.length} of ${scopeTotal} finding${scopeTotal !== 1 ? "s" : ""}`
    : undefined;
  // "Clean" means the report found nothing at all. Never on the Dismissed
  // scope: someone who navigated there wants to see what they put away, and the
  // empty state would swallow the only route back to it.
  const isEmptyReport =
    report !== null &&
    !running &&
    !error &&
    scope !== "dismissed" &&
    split.visible.length === 0;
  const dismissedCount = split.dismissed.length;

  const clearFilters = () => {
    setSearch("");
    setScope("all");
    setCodeFilter(new Set());
  };

  const actions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/rules")}
        aria-label="Go to rules"
        title="Go to rules"
      >
        {/* Not "Back": this page has its own sidebar entry, so half the people
            reading it never came from Rules and have nowhere to go back to. */}
        <ListChecks />
        Go to Rules
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
              <Button variant="ghost" size="xs" onClick={() => setScope("dismissed")}>
                Review {dismissedCount} dismissed finding{dismissedCount !== 1 ? "s" : ""}
              </Button>
            )}
          </div>
        ) : (
          report && (
            <>
              <DiagnosticsFilterBar
                scope={scope}
                onScopeChange={setScope}
                counts={scopeCounts}
                ruleCount={report.ruleCount}
                search={search}
                codeFilter={codeFilter}
                availableCodes={availableCodes}
                onSearchChange={setSearch}
                onCodeChange={(codes) => setCodeFilter(new Set(codes))}
                onClear={clearFilters}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                <DiagnosticsTable
                  findings={visibleFindings}
                  rulesById={rulesById}
                  // Withheld while the report is stale: the finding describes
                  // the rules as they were when it ran, but the signatures would
                  // be taken from the rules as they are now — recording a
                  // decision about evidence the user never saw. The banner above
                  // already asks for a refresh; this makes it a precondition.
                  onDismiss={
                    scope === "dismissed" || stale
                      ? undefined
                      : (finding) => dismiss(finding, rulesById)
                  }
                  onRestore={
                    scope === "dismissed"
                      ? (finding) => {
                          const record = recordByFinding.get(finding);
                          if (record) restore(record.id);
                        }
                      : undefined
                  }
                />
              </div>
            </>
          )
        )}
      </div>
    </PageLayout>
  );
}
