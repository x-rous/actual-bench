"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Link2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/ui/entity-picker";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import { cn } from "@/lib/utils";
import { formatAmount } from "../lib/previewRows";
import {
  linkSyncedTransfer,
  loadFxPosition,
  postFxRevaluation,
  type FxTransferPair,
} from "../lib/fxPositionClient";
import type { SyncFlow } from "@/lib/app-db/types";
import type { ConnectionInstance } from "@/store/connection";

type FxPositionPanelProps = {
  flow: SyncFlow;
  sourceConnection?: ConnectionInstance;
  targetConnection?: ConnectionInstance;
  onBack: () => void;
};

/** One labelled figure. Status is carried by the text, never by colour alone. */
function Figure({ label, value, currency, detail }: { label: string; value: number; currency: string; detail?: string }) {
  return (
    <div className="min-w-0 border-l border-border pl-3 first:border-l-0 first:pl-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold tabular-nums">
        <span className="mr-1 text-xs font-normal text-muted-foreground">{currency}</span>
        {formatAmount(value)}
      </div>
      {detail && <div className="truncate text-[11px] text-muted-foreground" title={detail}>{detail}</div>}
    </div>
  );
}

export function FxPositionPanel({ flow, sourceConnection, targetConnection, onBack }: FxPositionPanelProps) {
  const config = decodeFlowPlanConfig(flow);
  const [categoryId, setCategoryId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const ready = !!sourceConnection && !!targetConnection;
  const query = useQuery({
    queryKey: ["sync-fx-position", flow.id, flow.updatedAt, sourceConnection?.id, targetConnection?.id],
    queryFn: () => loadFxPosition({ flow, sourceConnection: sourceConnection!, targetConnection: targetConnection! }),
    enabled: ready,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const data = query.data;
  const position = data?.position;

  const revalue = useMutation({
    mutationFn: async () => {
      if (!position || !data || !targetConnection) throw new Error("The position is not loaded.");
      await postFxRevaluation({
        flow,
        targetConnection,
        amount: position.difference,
        rate: position.rate,
        categoryId: data.targetOffBudget ? null : categoryId,
        date: data.rateDate,
      });
    },
    onSuccess: async () => {
      setConfirming(false);
      setActionError(null);
      setNotice("Revaluation posted to the target budget.");
      await query.refetch();
    },
    onError: (err) => {
      setConfirming(false);
      setActionError(err instanceof Error ? err.message : "The revaluation could not be posted.");
    },
  });

  const link = useMutation({
    mutationFn: async (pair: FxTransferPair) => {
      if (!targetConnection) throw new Error("Connect the target budget first.");
      await linkSyncedTransfer({ flow, targetConnection, syncedId: pair.syncedId, counterpart: pair.counterpart });
    },
    onSuccess: async () => {
      setActionError(null);
      setNotice("Transfer linked at the amount the other account recorded.");
      await query.refetch();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "The transfer could not be linked."),
  });

  const needsCategory = !!data && !data.targetOffBudget && !categoryId;
  const canPost = !!position && position.difference !== 0 && !needsCategory && !revalue.isPending;
  const warnings = position && data ? [
    position.unsyncedRows > 0 && `${position.unsyncedRows} source transaction${position.unsyncedRows === 1 ? " is" : "s are"} not synced yet.`,
    position.missingOnTarget > 0 && `${position.missingOnTarget} synced transaction${position.missingOnTarget === 1 ? " was" : "s were"} deleted on the target.`,
    position.missingOnSource > 0 && `${position.missingOnSource} synced transaction${position.missingOnSource === 1 ? " was" : "s were"} deleted on the source.`,
    data.earlierDateRates > 0 && `${data.earlierDateRates} synced transaction${data.earlierDateRates === 1 ? " uses" : "s use"} an earlier date's rate. Turn on "Update synced transactions when the rate changes" and preview to correct them.`,
  ].filter((w): w is string => !!w) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">Currency position</h3>
          <p className="truncate text-xs text-muted-foreground">
            {config.sourceAccountName} in {config.fxSourceCurrency}, held in {config.targetBudgetName} as {config.fxTargetCurrency}
            {position ? ` · ${position.rate} on ${data?.rateDate}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { setNotice(null); void query.refetch(); }} disabled={!ready || query.isFetching}>
            {query.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to flow</Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {!ready && <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Connect both budgets to see this account&apos;s position.</p>}
        {ready && query.isLoading && (
          <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading both budgets…</p>
        )}
        {(query.error || actionError) && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{actionError ?? (query.error instanceof Error ? query.error.message : "The position could not be read.")}</span>
          </div>
        )}
        {notice && <p role="status" className="rounded-md border border-border bg-muted/40 px-3.5 py-2 text-sm">{notice}</p>}

        {position && data && (
          <>
            <section aria-label="Position" className="grid grid-cols-2 gap-4 rounded-md border border-border px-4 py-3 lg:grid-cols-4">
              <Figure label="Foreign balance (synced)" value={position.sourceTotal} currency={config.fxSourceCurrency} detail={`${position.syncedRows} transactions`} />
              <Figure label="Main budget holds" value={position.targetTotal} currency={config.fxTargetCurrency} detail={position.revaluedTotal ? `Includes ${formatAmount(position.revaluedTotal)} revaluation` : "Converted at each transaction's rate"} />
              <Figure label="Worth today" value={position.valueAtRate} currency={config.fxTargetCurrency} detail={`At ${position.rate}`} />
              <Figure label="Unrealised difference" value={position.difference} currency={config.fxTargetCurrency} detail={position.difference === 0 ? "In step with today's rate" : position.difference > 0 ? "Worth more than recorded" : "Worth less than recorded"} />
            </section>

            {warnings.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-md border border-amber-400/40 bg-amber-50/70 px-3.5 py-2.5 text-xs dark:bg-amber-950/20">
                {warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-1.5"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />{warning}</li>
                ))}
              </ul>
            )}

            <section className="flex flex-col gap-2 border-t border-border pt-3">
              <div>
                <h4 className="text-sm font-semibold">Revalue to today&apos;s rate</h4>
                <p className="text-xs text-muted-foreground">Adds one transaction to {config.targetAccountName} so its synced balance matches today&apos;s value. Nothing changes until you post it, and an account can be revalued once a day.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!data.targetOffBudget && (
                  <div className="w-72">
                    <CategoryPicker ariaLabel="Revaluation category" size="sm" categories={data.categories} groups={data.categoryGroups} value={categoryId} onChange={(value) => setCategoryId(value ?? "")} placeholder="FX gain/loss category…" />
                  </div>
                )}
                {confirming ? (
                  <>
                    <span className="text-xs">Post <strong className="tabular-nums">{config.fxTargetCurrency} {formatAmount(position.difference)}</strong> dated {data.rateDate}?</span>
                    <Button size="sm" onClick={() => revalue.mutate()} disabled={!canPost}>{revalue.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={revalue.isPending}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={!canPost}>Post revaluation</Button>
                )}
                {needsCategory && position.difference !== 0 && <span className="text-xs text-muted-foreground">Choose a category first.</span>}
              </div>
            </section>

            <section className="flex min-h-0 flex-col gap-2 border-t border-border pt-3">
              <div>
                <h4 className="text-sm font-semibold">Transfers to link</h4>
                <p className="text-xs text-muted-foreground">Synced transfers with a likely other side in the main budget. Linking uses that side&apos;s real amount, so reports stop counting the move as spending and income.</p>
              </div>
              {data.transfers.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">No unlinked transfers with a likely match.</p>
              ) : (
                <div className="overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                        <th>Date</th><th className="text-right">Synced amount</th><th>Other account</th><th>Other date</th><th>Payee</th>
                        <th className="text-right">Other amount</th><th className="text-right">Difference</th><th className="text-right">Real rate</th><th><span className="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transfers.map((pair) => (
                        <tr key={pair.syncedId} className="border-t border-border/60 [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1">
                          <td className="tabular-nums">{pair.synced.date}</td>
                          <td className="text-right tabular-nums">{formatAmount(pair.synced.amount)}</td>
                          <td>{pair.counterpartAccountName}</td>
                          <td className="tabular-nums">{pair.counterpart.date}</td>
                          <td className="max-w-48 truncate">{pair.counterpart.payeeName ?? "-"}</td>
                          <td className="text-right tabular-nums">{formatAmount(pair.counterpart.amount)}</td>
                          <td className={cn("text-right tabular-nums", pair.differenceBps > 200 && "font-medium")}>{(pair.differenceBps / 100).toFixed(2)}%</td>
                          <td className="text-right tabular-nums">{pair.realisedRate ?? "-"}</td>
                          <td className="text-right">
                            <Button size="xs" variant="outline" disabled={link.isPending} onClick={() => link.mutate(pair)} aria-label={`Link transfer of ${formatAmount(pair.synced.amount)} on ${pair.synced.date}`}>
                              {link.isPending && link.variables?.syncedId === pair.syncedId ? <Loader2 className="animate-spin" /> : <Link2 />} Link
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
