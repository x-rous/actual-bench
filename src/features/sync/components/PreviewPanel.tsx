"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, ListChecks, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  filterCount,
  formatAmount,
  groupLabel,
  matchesPreviewFilter,
  PREVIEW_FILTERS,
  reviewQueueCount,
  splitPositions,
  tileCounts,
  type PreviewFilter,
  type PreviewRow,
} from "../lib/previewRows";
import type { ApplyRunResult } from "@/lib/sync/applyOrchestrator";
import type { DryRunError, DryRunSummary } from "@/lib/sync/previewOrchestrator";

type PreviewPanelProps = {
  summary: DryRunSummary | null;
  previewError: DryRunError | null;
  rows: PreviewRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAllSafeNew: () => void;
  onClearSelection: () => void;
  onApply: () => void;
  applying: boolean;
  applyResult: ApplyRunResult | null;
  /** ISO timestamp of when this run was generated, for the freshness cue. */
  previewedAt: string | null;
  /** Viewing a past/applied run: no selection or apply. */
  readOnly: boolean;
};

/** A preview reflects a point-in-time source snapshot; warn once it's this old. */
const STALE_AFTER_MS = 120_000;

function formatAge(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const TILE_BORDER: Record<string, string> = {
  new: "border-green-500/30", warn: "border-amber-400/30", bad: "border-destructive/40",
};

const COLUMN_COUNT = 10;

export function PreviewPanel(props: PreviewPanelProps) {
  const { summary, previewError, rows, selectedIds } = props;
  const [filter, setFilter] = useState<PreviewFilter>("all");

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

  const tiles = tileCounts(rows);
  const visible = rows.filter((r) => matchesPreviewFilter(r, filter));
  const selectedCount = rows.filter((r) => selectedIds.has(r.id)).length;
  const splits = splitPositions(rows);
  const reviewCount = reviewQueueCount(rows);

  return (
    <div className="flex flex-col gap-3.5">
      {props.applying && (
        <div className="flex items-center gap-2 rounded-md border border-blue-400/40 bg-blue-50/70 px-3.5 py-2.5 text-sm dark:bg-blue-950/20">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          <span>Syncing selected changes to the target budget… this can take a while on large budgets.</span>
        </div>
      )}
      {!props.applying && props.applyResult && <ApplyResultBanner result={props.applyResult} />}

      {/* Four grouped tiles — click to filter the table */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile value={tiles.new} label="New - ready to sync" tone="new" active={filter === "new"} onClick={() => setFilter("new")} />
        <Tile value={tiles.needsReview} label="Needs review" tone="warn" active={filter === "needs_review"} onClick={() => setFilter("needs_review")} />
        <Tile value={tiles.alreadySynced} label="Already synced" active={filter === "already_synced"} onClick={() => setFilter("already_synced")} />
        <Tile value={tiles.blocked} label="Blocked" tone="bad" active={filter === "blocked"} onClick={() => setFilter("blocked")} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {summary.sourceItemsScanned} items scanned · {summary.generatedTransactionsExcluded} sync-generated excluded · {summary.sourceItemsFilteredOut} filtered out
        <PreviewFreshness previewedAt={props.previewedAt} readOnly={props.readOnly} />
      </p>

      {reviewCount > 0 && (
        <button
          type="button"
          aria-pressed={filter === "review_queue"}
          onClick={() => setFilter(filter === "review_queue" ? "all" : "review_queue")}
          className={cn(
            "flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/60 px-3 py-2 text-left text-sm transition-colors hover:bg-amber-100/60 dark:bg-amber-950/20 dark:hover:bg-amber-950/40",
            filter === "review_queue" && "ring-2 ring-ring"
          )}
        >
          <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong className="font-semibold">Review queue · {reviewCount}</strong>
            <span className="block text-xs text-muted-foreground">
              Automated sync can&apos;t apply these safely (duplicates, source changed or missing, blocked). Review and handle them yourself.
            </span>
          </span>
        </button>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Target budget rules can adjust a created transaction&apos;s payee, category or notes.
        {!props.readOnly && " Items that need review are skipped unless you select them."}
      </p>

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-border">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <strong className="text-[13px]">Planned changes</strong>
          <span className="text-xs tabular-nums text-muted-foreground">{visible.length} shown</span>
          <div className="flex flex-wrap gap-1">
            {PREVIEW_FILTERS.map((f) => {
              const count = filterCount(rows, f.key);
              const disabled = count === 0 && f.key !== "all";
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  disabled={disabled}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs",
                    filter === f.key
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                    disabled && "cursor-not-allowed opacity-40 hover:bg-background"
                  )}
                >
                  {f.label}
                  {f.key !== "all" && <span className="tabular-nums"> {count}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          {props.readOnly ? (
            <span className="text-xs text-muted-foreground">Read-only - viewing a past run</span>
          ) : (
            <>
              {selectedCount > 0 && (
                <Button size="sm" variant="ghost" onClick={props.onClearSelection} disabled={props.applying}>Clear</Button>
              )}
              <Button size="sm" variant="outline" onClick={props.onSelectAllSafeNew} disabled={props.applying}>Select all safe new</Button>
              <Button size="sm" onClick={props.onApply} disabled={selectedCount === 0 || props.applying}>
                {props.applying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
                  </>
                ) : (
                  <>
                    Sync selected{selectedCount > 0 && <span className="tabular-nums"> · {selectedCount}</span>}
                  </>
                )}
              </Button>
            </>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th className="w-8" />
                <th>Status</th>
                <th>Date</th>
                <th>Payee</th>
                <th>Category</th>
                <th>Notes</th>
                <th className="text-right">Source</th>
                <th className="text-right">Target</th>
                <th>Target payee</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const pos = splits.get(row.id);
                const details = row.message ?? row.flags.join(", ");
                return (
                  <tr
                    key={row.id}
                    data-testid="preview-row"
                    className={cn("border-t border-border/60 [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1.5", !row.selectable && "text-muted-foreground")}
                  >
                    <td>
                      <input type="checkbox" aria-label={`Select ${row.sourceItemKey}`} disabled={!row.selectable || props.readOnly} checked={selectedIds.has(row.id)} onChange={() => props.onToggle(row.id)} />
                    </td>
                    <td>
                      <Badge variant={badgeVariant(row.group)} className="text-[10px]">{groupLabel(row.group)}</Badge>
                      {row.isSplit && <span className="ml-1 text-[10px] text-muted-foreground">split{pos ? ` ${pos.index}/${pos.total}` : ""}</span>}
                    </td>
                    <td className="tabular-nums">{row.source.date}</td>
                    <td><span className="block max-w-[10rem] truncate" title={row.source.payeeName ?? undefined}>{row.source.payeeName ?? "-"}</span></td>
                    <td><span className="block max-w-[9rem] truncate" title={row.source.categoryName ?? undefined}>{row.source.categoryName ?? "-"}</span></td>
                    <td><span className="block max-w-[12rem] truncate" title={row.source.notes ?? undefined}>{row.source.notes ?? "-"}</span></td>
                    <td className="text-right tabular-nums">{formatAmount(row.source.amount)}</td>
                    <td className="text-right tabular-nums">{formatAmount(row.target.amount)}</td>
                    <td><span className="block max-w-[10rem] truncate" title={row.target.payeeName ?? undefined}>{row.target.payeeName ?? "-"}</span></td>
                    <td className="text-[11px] text-muted-foreground"><span className="block max-w-[12rem] truncate" title={details || undefined}>{details || "-"}</span></td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={COLUMN_COUNT} className="px-3 py-6 text-center text-sm text-muted-foreground">No items in this group.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PreviewFreshness({ previewedAt, readOnly }: { previewedAt: string | null; readOnly: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!previewedAt) return null;
  const ts = new Date(previewedAt).getTime();
  if (Number.isNaN(ts)) return null;

  const age = Math.max(0, now - ts);
  const stale = !readOnly && age >= STALE_AFTER_MS;
  const label = formatAge(age);

  return (
    <span className={cn(stale && "font-medium text-amber-600 dark:text-amber-400")}>
      {" · "}
      {readOnly ? `Run from ${label}` : `Previewed ${label}`}
      {stale && " — source may have changed, re-run Sync Preview"}
    </span>
  );
}

function Tile({ value, label, tone, active, onClick }: { value: number; label: string; tone?: "new" | "warn" | "bad"; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
        tone ? TILE_BORDER[tone] : "border-border",
        active && "ring-2 ring-ring"
      )}
    >
      <div className={cn("text-xl font-bold tabular-nums", tone === "new" && "text-green-600 dark:text-green-400", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "bad" && "text-destructive")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

function badgeVariant(group: PreviewRow["group"]): "status-active" | "status-warning" | "secondary" {
  if (group === "new") return "status-active";
  if (group === "duplicate" || group === "source_changed" || group === "marker_match" || group === "blocked") return "status-warning";
  return "secondary";
}

function ApplyResultBanner({ result }: { result: ApplyRunResult }) {
  const tone = result.status === "applied" ? "border-green-500/30 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
    : result.status === "partial" ? "border-amber-400/30 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  const Icon = result.status === "failed" ? XCircle : CheckCircle2;
  const unresolved = result.items.filter((i) => i.outcome === "failed").length;
  const headline =
    result.status === "applied" ? "Synced." : result.status === "partial" ? "Partially synced." : "Sync failed.";
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3.5 py-2.5 text-sm", tone)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p><strong className="font-semibold">{headline}</strong> {result.counts.applied} created · {result.counts.repaired} re-linked to an existing transaction · {result.counts.failed} failed.</p>
        {result.counts.appliedWithWarnings > 0 && <p className="text-xs opacity-90">{result.counts.appliedWithWarnings} were adjusted by target-budget rules. Synced items now show as “Already synced” on the next preview.</p>}
        {unresolved > 0 && <p className="text-xs opacity-90">{unresolved} could not be confirmed - a transaction may have been created but was not linked.</p>}
      </div>
    </div>
  );
}
