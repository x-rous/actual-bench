"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { explainInTransit } from "@/lib/financial-insights/inTransit";
import { readOtherSides, readTransferRows } from "@/lib/financial-insights/reads";
import { money } from "../format";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;

/**
 * Finds the transfers behind an "in transit" amount (one read, only now that it was asked for) and the recorded reason each one
 * is there, then hands them to the read-only list. Nothing is changed, and no cause is guessed: the reasons are only what the
 * transactions themselves show.
 */
export function useInTransitTarget(data: Ready, today: string, cashOnly: boolean, enabled: boolean) {
  const connection = useConnectionStore(selectActiveInstance);
  const { ledger, period } = data;
  return useQuery({
    queryKey: ["financial-insights", "in-transit", connection?.id, connection?.budgetSyncId, today, period.startDate, period.endDate, cashOnly],
    enabled: enabled && !!connection, gcTime: 60_000,
    queryFn: async (): Promise<Extract<DrillTarget, { kind: "inTransitRows" }>> => {
      const scope = [...ledger.account.values()].filter((a) => !cashOnly || ledger.role.get(a.id) === "cash").map((a) => a.id);
      const rows = await readTransferRows(connection!, { accountIds: scope, counterpartIds: scope, startDate: period.startDate, endDate: period.endDate, today });
      const inSet = new Set(rows.map((r) => r.id));
      const missing = [...new Set(rows.flatMap((r) => (r.transferId && !inSet.has(r.transferId) ? [r.transferId] : [])))];
      const others = await readOtherSides(connection!, missing);
      const found = explainInTransit(rows, others, { startDate: period.startDate, endDate: period.endDate }, money, ledger.facts.excluded);
      return {
        kind: "inTransitRows", ids: found.ids, reasons: found.reasons, expectedMinor: found.totalMinor,
        title: `${cashOnly ? "In transit between cash accounts" : "In transit"} · ${period.label}`,
      };
    },
  });
}

/** What shows while the transfers are being found, or if they could not be read. */
export function InTransitStatus({ state, onClose, retry }: { state: "loading" | "error"; onClose: () => void; retry: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>In transit</DialogTitle><DialogDescription>{state === "loading" ? "Finding the transfers behind this amount…" : "The transfers could not be read. Nothing was changed."}</DialogDescription></DialogHeader>
        <DialogFooter>{state === "error" && <Button variant="outline" onClick={retry}>Retry</Button>}<Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
