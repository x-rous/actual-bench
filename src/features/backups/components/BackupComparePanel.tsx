"use client";

import { Fragment, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, GitCompare, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { AccountComparison, BackupComparison, TransactionDifferences } from "@/lib/backup/compare";
import type { AccountTransaction } from "@/lib/backup/search";
import { compareBackup } from "../lib/backupsApi";
import { formatDateTime, formatMinorAmount } from "../lib/presentation";

/**
 * A budget backup beside the budget as it is now (RD-077).
 *
 * Answers "is this the copy from before it went wrong?" without restoring:
 * which accounts were added or removed since, and each account's transaction
 * count and balance then and now. The live budget is read through its
 * enrolment, so a budget Bench holds no credentials for says so instead.
 */

const CHANGE_LABEL: Record<AccountComparison["change"], string> = {
  removed: "Removed since",
  added: "Added since",
  changed: "Changed",
  same: "Unchanged",
};

// A removed account asks for a look; it is not an error. The label carries
// the meaning, the colour only supports it.
const CHANGE_VARIANT: Record<AccountComparison["change"], "status-warning" | "secondary" | "status-inactive"> = {
  removed: "status-warning",
  added: "secondary",
  changed: "secondary",
  same: "status-inactive",
};

const dash = <span className="text-muted-foreground">-</span>;
const number = "px-2 py-1 text-right tabular-nums whitespace-nowrap";

export function BackupComparePanel({ artifactId, passphrase }: { artifactId: string; passphrase: string }) {
  const [result, setResult] = useState<BackupComparison | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (accountId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  const compare = useMutation({
    mutationFn: () => compareBackup(artifactId, passphrase || undefined),
    onSuccess: setResult,
  });

  const opened = result?.opened ? result : null;
  const unchanged = opened ? opened.accounts.filter((row) => row.change === "same").length : 0;
  const rows = opened ? opened.accounts.filter((row) => showUnchanged || row.change !== "same") : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => compare.mutate()} disabled={compare.isPending}>
          {compare.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <GitCompare aria-hidden />}
          {opened ? "Compare again" : "Compare with the live budget"}
        </Button>
        {opened && unchanged > 0 && (
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <Checkbox checked={showUnchanged} onCheckedChange={(checked) => setShowUnchanged(checked === true)} />
            Show {unchanged} unchanged account{unchanged === 1 ? "" : "s"}
          </label>
        )}
      </div>

      {compare.isError && (
        <p role="alert" className="text-destructive">
          {compare.error.message}
        </p>
      )}

      {!result && !compare.isPending && !compare.isError && (
        <p className="text-muted-foreground">
          Reads the budget as it is now, through the credentials Bench stores for it, and lists the
          accounts added or removed since this copy and each account&rsquo;s transactions and balance
          then and now. Nothing is changed on either side.
        </p>
      )}

      {result && !result.opened && <p className="text-amber-800 dark:text-amber-300">{result.message}</p>}

      {opened && (
        <div className={cn("space-y-2", compare.isPending && "opacity-60")} aria-busy={compare.isPending}>
          <p className="text-[13px] leading-relaxed">
            This copy ({formatDateTime(opened.takenAt)}) has {opened.totals.backup.transactions.toLocaleString()}{" "}
            transactions in {opened.totals.backup.accounts} accounts. The budget now has{" "}
            {opened.totals.live.transactions.toLocaleString()} in {opened.totals.live.accounts}.
          </p>

          {rows.length === 0 ? (
            <p className="text-muted-foreground">Every account is the same as in this copy.</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
              <table className="w-full table-fixed border-collapse text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">Account</th>
                    <th className="w-32 px-2 py-1.5 text-left font-medium">Since this copy</th>
                    <th className="w-28 px-2 py-1.5 text-right font-medium">Balance then</th>
                    <th className="w-28 px-2 py-1.5 text-right font-medium">Balance now</th>
                    <th className="w-28 px-2 py-1.5 text-right font-medium">Difference</th>
                    <th className="w-24 px-2 py-1.5 text-right font-medium">Txns then</th>
                    <th className="w-24 px-2 py-1.5 text-right font-medium">Txns now</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Fragment key={row.accountId}>
                      <tr className="border-b border-border/60 last:border-0">
                        <td className="truncate px-2 py-1" title={row.name}>
                          <span className="flex min-w-0 items-center gap-1">
                            {row.details ? (
                              <button
                                type="button"
                                className="rounded text-muted-foreground hover:text-foreground"
                                aria-expanded={expanded.has(row.accountId)}
                                aria-label={`Show the transactions that changed in ${row.name}`}
                                onClick={() => toggle(row.accountId)}
                              >
                                <ChevronRight
                                  className={cn("size-3.5 transition-transform", expanded.has(row.accountId) && "rotate-90")}
                                  aria-hidden
                                />
                              </button>
                            ) : (
                              <span className="w-3.5" />
                            )}
                            <span className="truncate">{row.name}</span>
                            {(row.live ?? row.backup)?.closed && <span className="text-muted-foreground"> · closed</span>}
                          </span>
                        </td>
                        <td className="px-2 py-1">
                          <Badge variant={CHANGE_VARIANT[row.change]}>{CHANGE_LABEL[row.change]}</Badge>
                        </td>
                        <td className={number}>{row.backup ? formatMinorAmount(row.backup.balanceMinor) : dash}</td>
                        <td className={number}>{row.live ? formatMinorAmount(row.live.balanceMinor) : dash}</td>
                        <td className={number}>
                          {row.balanceDeltaMinor === null ? dash : formatMinorAmount(row.balanceDeltaMinor, { signed: true })}
                        </td>
                        <td className={number}>{row.backup ? row.backup.transactions.toLocaleString() : dash}</td>
                        <td className={number}>{row.live ? row.live.transactions.toLocaleString() : dash}</td>
                      </tr>
                      {row.details && expanded.has(row.accountId) && (
                        <tr className="border-b border-border/60 bg-muted/30">
                          <td colSpan={7} className="px-3 py-2">
                            <Differences details={row.details} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The rows behind one account's difference: in the copy only, in the budget only, or edited. */
function Differences({ details }: { details: TransactionDifferences }) {
  const { counts } = details;
  if (counts.onlyInCopy + counts.onlyNow + counts.edited === 0) {
    return (
      <p className="text-muted-foreground">
        Every transaction matches by id, amount and date; the difference is in the account itself (for
        example it was closed).
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <List title="Only in this copy" hint="deleted since, or not counted by Actual now" total={counts.onlyInCopy} rows={details.onlyInCopy} />
      <List title="Only in the budget now" hint="added since" total={counts.onlyNow} rows={details.onlyNow} />
      {counts.edited > 0 && (
        <div className="space-y-0.5">
          <p className="font-medium">
            Edited since <span className="font-normal text-muted-foreground">({counts.edited})</span>
          </p>
          <ul className="space-y-0.5">
            {details.edited.map(({ before, after }) => (
              <li key={before.id} className="flex gap-3 tabular-nums">
                <span className="w-24 shrink-0">{after.date ?? "-"}</span>
                <span className="min-w-0 flex-1 truncate">{after.payee ?? "-"}</span>
                <span className="w-56 shrink-0 text-right">
                  {formatMinorAmount(before.amountMinor)} → {formatMinorAmount(after.amountMinor)}
                  {before.date !== after.date && <span className="text-muted-foreground"> (was {before.date ?? "-"})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function List({ title, hint, total, rows }: { title: string; hint: string; total: number; rows: AccountTransaction[] }) {
  if (total === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="font-medium">
        {title} <span className="font-normal text-muted-foreground">({total}) · {hint}</span>
      </p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.id} className="flex gap-3 tabular-nums">
            <span className="w-24 shrink-0">{row.date ?? "-"}</span>
            <span className="w-48 shrink-0 truncate">{row.payee ?? "-"}</span>
            <span className="w-40 shrink-0 truncate text-muted-foreground">{row.category ?? "-"}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.notes ?? ""}</span>
            <span className="w-28 shrink-0 text-right">{formatMinorAmount(row.amountMinor)}</span>
          </li>
        ))}
      </ul>
      {total > rows.length && <p className="text-muted-foreground">and {total - rows.length} more</p>}
    </div>
  );
}
