"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, Info, ListChecks, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  filterCount,
  formatAmount,
  matchesPreviewFilter,
  previewFilters,
  previewTiles,
  reviewQueueCount,
  splitPositions,
  statusLabel,
  targetEntityDisplay,
  type PreviewFilter,
  type PreviewRow,
  type SyncKind,
} from "../lib/previewRows";
import { auditFileName, buildRunAuditCsv } from "../lib/runAudit";
import type { ApplyRunResult } from "@/lib/sync/applyOrchestrator";
import type { DryRunError, DryRunSummary } from "@/lib/sync/previewOrchestrator";

type PreviewPanelProps = {
  kind: SyncKind;
  summary: DryRunSummary | null;
  previewError: DryRunError | null;
  rows: PreviewRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAllSafeNew: () => void;
  /** Add/remove a set of rows from the selection (header "select all shown"). */
  onSelectRows?: (ids: string[], selected: boolean) => void;
  onClearSelection: () => void;
  onApply: () => void;
  applying: boolean;
  applyResult: ApplyRunResult | null;
  /** ISO timestamp of when this run was generated, for the freshness cue. */
  previewedAt: string | null;
  /** Viewing a past/applied run: no selection or apply. */
  readOnly: boolean;
  /** Run id, used to name the audit export file (RD-057 §7). */
  runId?: string | null;
};

/** Trigger a client-side file download of `content` (RD-057 §7 audit export). */
function downloadTextFile(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** A preview reflects a point-in-time source snapshot; warn once it's this old. */
const STALE_AFTER_MS = 120_000;

/** The unit noun for a data type, used throughout the copy. */
function noun(kind: SyncKind, plural = false): string {
  const base = kind === "payee" ? "payee" : kind === "category" ? "category" : "change";
  if (!plural) return base;
  return kind === "category" ? "categories" : `${base}s`;
}

/** What the source scan counts, per data type. */
function scannedNoun(kind: SyncKind): string {
  return kind === "payee" ? "payees" : kind === "category" ? "categories" : "transactions";
}

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

export function PreviewPanel(props: PreviewPanelProps) {
  const { kind, summary, previewError, rows, selectedIds } = props;
  const [filter, setFilter] = useState<PreviewFilter>("all");

  if (previewError) {
    return (
      <div className="p-5">
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Preview couldn&apos;t run</p>
            <p className="text-muted-foreground">{previewError.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const tiles = previewTiles(rows, kind);
  // Only show a filter chip when it would actually match something; "All" always
  // stays. Keeps the chip row focused on the classes a run really produced.
  const filters = previewFilters(kind).filter((f) => f.key === "all" || filterCount(rows, f.key) > 0);
  const visible = rows.filter((r) => matchesPreviewFilter(r, filter));
  const selectedCount = rows.filter((r) => selectedIds.has(r.id)).length;
  // "Select all shown": every selectable row under the active filter.
  const visibleSelectableIds = props.readOnly ? [] : visible.filter((r) => r.selectable).map((r) => r.id);
  const selectedVisible = visibleSelectableIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleSelectableIds.length > 0 && selectedVisible === visibleSelectableIds.length;
  const splits = splitPositions(rows);
  const reviewCount = reviewQueueCount(rows);
  const columnCount = kind === "transaction" ? 9 : kind === "category" ? 5 : 4;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {props.applying && (
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-blue-400/40 bg-blue-50/70 px-3.5 py-2.5 text-sm dark:bg-blue-950/20">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          <span>Syncing selected {noun(kind, true)} to the target budget… this can take a while on large budgets.</span>
        </div>
      )}
      {!props.applying && props.applyResult && (
        <div className="mx-5 mt-4">
          <ApplyResultBanner result={props.applyResult} kind={kind} />
        </div>
      )}

      {/* Fixed header: stats + controls stay put while the table scrolls below. */}
      <div className="flex shrink-0 flex-col gap-2.5 px-5 pb-3 pt-4">
          {/* Result tiles - worded for the data type; click to filter the table */}
          <div className={cn("grid grid-cols-2 gap-2", tiles.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4")}>
            {tiles.map((tile) => (
              <Tile key={tile.key} value={tile.value} label={tile.label} tone={tile.tone} active={filter === tile.filter} onClick={() => setFilter(filter === tile.filter ? "all" : tile.filter)} />
            ))}
          </div>

          {/* Scan meta, a compact review-queue shortcut, and the rules caveat */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {summary.sourceItemsScanned} {scannedNoun(kind)} scanned
              {kind === "transaction" && ` · ${summary.generatedTransactionsExcluded} sync-generated excluded · ${summary.sourceItemsFilteredOut} filtered out`}
              <PreviewFreshness previewedAt={props.previewedAt} readOnly={props.readOnly} />
            </span>
            <div className="flex-1" />
            {reviewCount > 0 && (
              <button
                type="button"
                aria-pressed={filter === "review_queue"}
                onClick={() => setFilter(filter === "review_queue" ? "all" : "review_queue")}
                title="Automated sync leaves these for you - decide and apply them by hand."
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-50/70 px-2.5 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-100/70 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50",
                  filter === "review_queue" && "ring-2 ring-ring"
                )}
              >
                <ListChecks className="h-3.5 w-3.5" /> {reviewCount} to review
              </button>
            )}
            {kind === "transaction" && (
              <span
                className="inline-flex items-center gap-1"
                title={`Target-budget rules can adjust a created transaction's payee, category, or notes.${props.readOnly ? "" : " Items that need review stay unchecked until you pick them."}`}
              >
                <Info className="h-3.5 w-3.5" /> Rules may adjust resulting transactions
              </span>
            )}
          </div>

          {/* Toolbar: title + shown count + actions, separated from the chips so
              the buttons never reflow when selecting a row adds "Clear". */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
            <strong className="text-[13px]">Planned changes</strong>
            <span className="text-xs tabular-nums text-muted-foreground">{visible.length} shown</span>
            <div className="flex-1" />
            {rows.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                title="Export this run's audit (CSV)"
                onClick={() => downloadTextFile(buildRunAuditCsv(rows), auditFileName(props.runId ?? "run", "csv"), "text/csv")}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            )}
            {props.readOnly ? (
              <span className="text-xs text-muted-foreground">Read-only - a past run</span>
            ) : (
              <>
                {selectedCount > 0 && (
                  <Button size="sm" variant="ghost" onClick={props.onClearSelection} disabled={props.applying}>Clear</Button>
                )}
                <Button size="sm" variant="outline" onClick={props.onSelectAllSafeNew} disabled={props.applying}>Select all new</Button>
                <Button size="sm" onClick={props.onApply} disabled={selectedCount === 0 || props.applying}>
                  {props.applying ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…</>
                  ) : (
                    <>Sync selected{selectedCount > 0 && <span className="tabular-nums"> · {selectedCount}</span>}</>
                  )}
                </Button>
              </>
            )}
          </div>

          {/* Filter chips - only the classes this run actually produced */}
          <div className="flex flex-wrap gap-1">
            {filters.map((f) => {
              const count = filterCount(rows, f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    filter === f.key
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  {f.label}
                  {f.key !== "all" && <span className="tabular-nums"> {count}</span>}
                </button>
              );
            })}
          </div>
        </div>

      {/* Scrolling table, edge-to-edge with the section - only the rows move. */}
      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th className="w-8">
                  {visibleSelectableIds.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      title="Select all shown items"
                      disabled={props.applying}
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedVisible > 0 && !allVisibleSelected;
                      }}
                      onChange={() => props.onSelectRows?.(visibleSelectableIds, !allVisibleSelected)}
                    />
                  )}
                </th>
                <th>Status</th>
                {kind === "transaction" ? (
                  <>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Category</th>
                    <th>Notes</th>
                    <th className="text-right">Source amount</th>
                    <th className="text-right">Target amount</th>
                  </>
                ) : kind === "category" ? (
                  <>
                    <th>Category</th>
                    <th>Group</th>
                    <th>On target</th>
                  </>
                ) : (
                  <>
                    <th>Payee</th>
                    <th>On target</th>
                  </>
                )}
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const pos = splits.get(row.id);
                const details = row.message ?? row.flags.join(", ");
                const onTarget = row.classification === "already_synced" || row.classification === "target_name_match" ? "Linked" : row.group === "new" ? "New" : "-";
                return (
                  <tr
                    key={row.id}
                    data-testid="preview-row"
                    className={cn("border-t border-border/60 [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1.5", !row.selectable && "text-muted-foreground")}
                  >
                    <td>
                      <input type="checkbox" aria-label={`Select ${row.source.payeeName ?? row.sourceItemKey}`} disabled={!row.selectable || props.readOnly} checked={selectedIds.has(row.id)} onChange={() => props.onToggle(row.id)} />
                    </td>
                    <td>
                      <Badge variant={badgeVariant(row)} className="text-[10px]">{statusLabel(row)}</Badge>
                      {row.isSplit && <span className="ml-1 text-[10px] text-muted-foreground">split{pos ? ` ${pos.index}/${pos.total}` : ""}</span>}
                    </td>
                    {kind === "transaction" ? (
                      <>
                        <td className="tabular-nums">{row.source.date}</td>
                        <td><EntityCell display={targetEntityDisplay(row.source.payeeName, row.flags, "payee")} kind="payee" /></td>
                        <td><EntityCell display={targetEntityDisplay(row.source.categoryName, row.flags, "category")} kind="category" /></td>
                        <td><Truncate text={row.source.notes} width="11rem" /></td>
                        <td className="text-right"><Amount minor={row.source.amount} currency={row.fx?.sourceCurrency} /></td>
                        <td className="text-right"><Amount minor={row.target.amount} currency={row.fx?.targetCurrency} fx={row.fx} /></td>
                      </>
                    ) : kind === "category" ? (
                      <>
                        <td><Truncate text={row.source.payeeName} width="12rem" /></td>
                        <td><Truncate text={row.source.categoryName} width="10rem" /></td>
                        <td className="text-muted-foreground">{onTarget}</td>
                      </>
                    ) : (
                      <>
                        <td><Truncate text={row.source.payeeName} width="16rem" /></td>
                        <td className="text-muted-foreground">{onTarget}</td>
                      </>
                    )}
                    <td className="text-[11px] text-muted-foreground"><Truncate text={details || null} width="12rem" /></td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={columnCount} className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing here - try another filter.</td></tr>
              )}
            </tbody>
          </table>
      </div>
    </div>
  );
}

function Truncate({ text, width }: { text: string | null | undefined; width: string }) {
  return <span className="block truncate" style={{ maxWidth: width }} title={text ?? undefined}>{text ?? "-"}</span>;
}

/** A signed amount, colour-coded, with an optional currency code and FX rate cue. */
function Amount({ minor, currency, fx }: { minor: number | null; currency?: string; fx?: PreviewRow["fx"] }) {
  if (minor == null) return <span className="text-muted-foreground">-</span>;
  const tone = minor < 0 ? "text-red-600 dark:text-red-400" : minor > 0 ? "text-green-700 dark:text-green-400" : "text-muted-foreground";
  return (
    <span className="tabular-nums">
      <span className="whitespace-nowrap">
        {currency && <span className="text-[10px] text-muted-foreground">{currency} </span>}
        <span className={tone}>{formatAmount(minor)}</span>
      </span>
      {fx && (
        <span className="block text-[10px] text-muted-foreground" title={fx.effectiveDate ? `rate from ${fx.effectiveDate}` : undefined}>
          @ {fx.rate}
        </span>
      )}
    </span>
  );
}

/** A payee/category cell that always shows the source name and annotates its target fate. */
function EntityCell({ display, kind }: { display: ReturnType<typeof targetEntityDisplay>; kind: "payee" | "category" }) {
  if (display.state === "none") return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-1">
      <Truncate text={display.name} width="8.5rem" />
      {display.state === "new" && (
        <span className="shrink-0 rounded bg-green-500/15 px-1 py-px text-[9px] font-medium text-green-700 dark:text-green-400">new</span>
      )}
      {display.state === "unmatched" && (
        <span
          className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-700 dark:text-amber-400"
          title={kind === "payee"
            ? "Not on target. Turn on Auto-create payees to add it."
            : "No matching category on the target; left uncategorized."}
        >
          {kind === "payee" ? "unmatched" : "no match"}
        </span>
      )}
    </span>
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
      {stale && " - source may have changed; preview again"}
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

function badgeVariant(row: PreviewRow): "status-active" | "status-warning" | "secondary" {
  if (row.group === "new") return "status-active";
  if (row.classification === "target_name_match" || row.group === "marker_match") return "secondary";
  if (row.group === "duplicate" || row.group === "source_changed" || row.group === "blocked") return "status-warning";
  return "secondary";
}

function ApplyResultBanner({ result, kind }: { result: ApplyRunResult; kind: SyncKind }) {
  const tone = result.status === "applied" ? "border-green-500/30 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
    : result.status === "partial" ? "border-amber-400/30 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  const Icon = result.status === "failed" ? XCircle : CheckCircle2;
  const unresolved = result.items.filter((i) => i.outcome === "failed").length;
  const created = kind === "transaction" ? "created" : `${noun(kind, true)} created`;
  const linked = kind === "transaction" ? "re-linked to an existing transaction" : "linked to an existing one";
  const headline =
    result.status === "applied" ? "Synced." : result.status === "partial" ? "Partially synced." : "Sync failed.";
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3.5 py-2.5 text-sm", tone)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p><strong className="font-semibold">{headline}</strong> {result.counts.applied} {created} · {result.counts.repaired} {linked} · {result.counts.failed} failed.</p>
        {result.counts.appliedWithWarnings > 0 && <p className="text-xs opacity-90">{result.counts.appliedWithWarnings} were adjusted by target-budget rules. They show as “Already synced” next time.</p>}
        {unresolved > 0 && <p className="text-xs opacity-90">{unresolved} couldn&apos;t be confirmed on the target.</p>}
      </div>
    </div>
  );
}
