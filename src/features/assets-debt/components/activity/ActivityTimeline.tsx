"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import type { ReproductionResult } from "@/lib/assets-debt/services/reproduceService";
import { formatAmount } from "../../lib/money";
import { listPostings, reproducePosting } from "../../lib/postingsApi";

/**
 * The posting timeline and reproduction view (RD-084 P1.6 T138; FR-182,
 * FR-201, FR-204). Proposals, decisions, applies, reversals and reproduction
 * checks, newest first, virtualized for long histories. Reproduction runs on
 * the server from stored inputs alone and never reads Actual. There is no
 * automation run history: nothing in this feature runs on its own.
 */

const ROW_HEIGHT = 56;

function event(posting: PostingView): string {
  const status = String(posting.status);
  if (status === "applied") return `Applied ${posting.appliedAt?.slice(0, 10) ?? ""}`;
  if (status === "declined") return `Declined ${posting.decidedAt?.slice(0, 10) ?? ""}`;
  if (status === "reversed") return "Reversed";
  if (status === "superseded") return "Superseded by a newer preview";
  if (status === "indeterminate") return "Interrupted; check Actual";
  if (status === "failed") return "Failed";
  return status === "proposed" ? "Proposed" : status;
}

function ReproductionLine({ result, digits }: { result: ReproductionResult; digits: number }) {
  const stored = result.stored.map((c) => `${c.kind} ${formatAmount(c.amountMinor, digits)}`).join(", ");
  const recomputed = result.recomputed.map((c) => `${c.kind} ${formatAmount(c.amountMinor, digits)}`).join(", ");
  const label = result.status === "exact-match" ? "Exact match" : result.status === "not-calculated" ? "Not an engine calculation" : result.status === "not-reproducible" ? "Not reproducible" : "Mismatch";
  return <p role="status" className="text-[11px]">Stored {stored || "none"} · Recomputed {recomputed || "none"} · <span className="font-semibold">{label}</span>. {result.detail}</p>;
}

export function ActivityTimeline({ debtId, currencyMinorDigits }: { debtId: string; currencyMinorDigits: number }) {
  const postings = useQuery({ queryKey: ["assets-debt", "postings", debtId], queryFn: () => listPostings(debtId) });
  const [results, setResults] = useState<Record<string, ReproductionResult>>({});
  const reproduce = useMutation({ mutationFn: reproducePosting, onSuccess: (result) => setResults((current) => ({ ...current, [result.postingId]: result })) });
  const rows = [...(postings.data ?? [])].reverse();
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual intentionally owns the visible row window.
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 8, initialRect: { width: 800, height: 360 } });

  return (
    <section aria-labelledby="posting-activity-heading" className="flex flex-col gap-2 px-4 py-4 text-sm">
      <h2 id="posting-activity-heading" className="text-sm font-semibold">Posting activity</h2>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">No postings yet.</p> : (
        <div ref={scrollRef} className="h-[360px] overflow-y-auto rounded border border-border" role="list" aria-label={`Posting activity, ${rows.length} entries`}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const posting = rows[item.index];
              const result = results[posting.id];
              return (
                <div key={posting.id} role="listitem" className="absolute left-0 top-0 flex w-full flex-col gap-1 overflow-hidden border-b border-border/60 px-3 py-2" style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{String(posting.postingKind)}</span>
                    <span className="tabular-nums text-muted-foreground">{posting.periodKey.length === 10 ? posting.periodKey : "reversal"}</span>
                    <span>{event(posting)}</span>
                    {posting.reversalOf ? <span className="text-muted-foreground">reverses an earlier posting</span> : null}
                    {posting.actualIds?.length ? <span className="text-muted-foreground">{posting.actualIds.length} Actual row{posting.actualIds.length === 1 ? "" : "s"}</span> : null}
                    {posting.status === "applied" ? <Button type="button" size="sm" variant="outline" className="ml-auto h-6" disabled={reproduce.isPending} onClick={() => reproduce.mutate(posting.id)}>Reproduce</Button> : null}
                  </div>
                  {result ? <ReproductionLine result={result} digits={currencyMinorDigits} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
