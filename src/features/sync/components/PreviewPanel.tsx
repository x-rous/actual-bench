"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAmount, groupLabel, type PreviewRow } from "../lib/previewRows";
import type { ApplyRunResult } from "@/lib/sync/applyOrchestrator";
import type { DryRunError, DryRunSummary } from "@/lib/sync/previewOrchestrator";

type PreviewPanelProps = {
  summary: DryRunSummary | null;
  previewError: DryRunError | null;
  rows: PreviewRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAllSafeNew: () => void;
  onApply: () => void;
  applying: boolean;
  applyResult: ApplyRunResult | null;
};

const SUMMARY_FIELDS: { key: keyof DryRunSummary; label: string }[] = [
  { key: "sourceTransactionsScanned", label: "Source scanned" },
  { key: "generatedTransactionsExcluded", label: "Generated excluded" },
  { key: "sourceItemsScanned", label: "Items scanned" },
  { key: "sourceItemsFilteredOut", label: "Filtered out" },
  { key: "createCandidates", label: "New create candidates" },
  { key: "alreadySynced", label: "Already synced" },
  { key: "duplicatesSkipped", label: "Duplicates skipped" },
  { key: "sourceChangedWarnings", label: "Source changed" },
  { key: "targetMarkerMatches", label: "Marker matches" },
  { key: "blocked", label: "Blocked" },
];

export function PreviewPanel(props: PreviewPanelProps) {
  const { summary, previewError, rows, selectedIds } = props;

  if (previewError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium">Preview failed ({previewError.code})</p>
          <p className="text-muted-foreground">{previewError.message}</p>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const selectedCount = rows.filter((r) => selectedIds.has(r.id)).length;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Preview summary</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {SUMMARY_FIELDS.map((f) => (
            <div key={f.key} className="rounded-md border border-border px-3 py-2">
              <div className="text-lg font-semibold tabular-nums">{summary[f.key]}</div>
              <div className="text-[11px] text-muted-foreground">{f.label}</div>
            </div>
          ))}
        </div>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" /> Target budget rules may modify created transactions
        (payee, category, notes, cleared). Uncertain duplicates are skipped for review.
      </p>

      {props.applyResult && <ApplyResultBanner result={props.applyResult} />}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Planned items ({rows.length})</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
            <Button size="sm" variant="outline" onClick={props.onSelectAllSafeNew}>
              Select all safe new
            </Button>
            <Button size="sm" onClick={props.onApply} disabled={selectedCount === 0 || props.applying}>
              {props.applying ? "Applying…" : "Apply selected changes"}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Source date</th>
                <th className="px-2 py-2">Source payee</th>
                <th className="px-2 py-2 text-right">Source amt</th>
                <th className="px-2 py-2 text-right">Target amt</th>
                <th className="px-2 py-2">Target payee</th>
                <th className="px-2 py-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border/60" data-testid="preview-row">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.sourceItemKey}`}
                      disabled={!row.selectable}
                      checked={selectedIds.has(row.id)}
                      onChange={() => props.onToggle(row.id)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={row.group === "new" ? "status-active" : "secondary"} className="text-[10px]">
                      {groupLabel(row.group)}
                    </Badge>
                    {row.isSplit && <span className="ml-1 text-[10px] text-muted-foreground">split</span>}
                  </td>
                  <td className="px-2 py-1.5">{row.source.date}</td>
                  <td className="px-2 py-1.5">{row.source.payeeName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(row.source.amount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(row.target.amount)}</td>
                  <td className="px-2 py-1.5">{row.target.payeeName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{row.flags.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ApplyResultBanner({ result }: { result: ApplyRunResult }) {
  const tone =
    result.status === "applied" ? "border-emerald-500/40 bg-emerald-500/10"
    : result.status === "partial" ? "border-amber-500/40 bg-amber-500/10"
    : "border-destructive/40 bg-destructive/10";
  const Icon = result.status === "applied" ? CheckCircle2 : result.status === "partial" ? AlertTriangle : XCircle;
  const withWarnings = result.counts.appliedWithWarnings;
  const unresolved = result.items.filter((i) => i.outcome === "failed").length;

  return (
    <div className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium capitalize">Apply {result.status}</p>
        <p className="text-muted-foreground">
          {result.counts.applied} applied · {result.counts.repaired} repaired ·{" "}
          {result.counts.skipped} skipped · {result.counts.failed} failed
        </p>
        {withWarnings > 0 && (
          <p className="text-muted-foreground">{withWarnings} applied with target-rule changes.</p>
        )}
        {unresolved > 0 && (
          <p className="text-muted-foreground">
            {unresolved} could not be confirmed by imported_id — a transaction may have been created
            but was not mapped.
          </p>
        )}
      </div>
    </div>
  );
}
