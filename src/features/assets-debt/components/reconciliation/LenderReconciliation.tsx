"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTransport } from "@/lib/actual";
import { readDatedBalance, toDebtMagnitude } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { acceptDebtDrift, createDebtAnchor, getDebtReconciliation, listDebtObservations, recordDebtObservation, runConventionDiagnostic } from "../../lib/debtsApi";
import { MoneyField } from "../fields";

const today = () => new Date().toISOString().slice(0, 10);

export function LenderReconciliation({ debt, offsetHistories }: { debt: DebtDetail; offsetHistories?: OffsetHistorySnapshot[] }) {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const observations = useQuery({ queryKey: ["assets-debt", "observations", debt.debt.id], queryFn: () => listDebtObservations(debt.debt.id) });
  const [date, setDate] = useState(today());
  const [principalMinor, setPrincipalMinor] = useState<number | null>(null);
  const [interestMinor, setInterestMinor] = useState<number | null>(0);
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  useEffect(() => {
    const latest = observations.data?.observations[0]?.observedOn;
    if (latest) setDate(latest);
  }, [observations.data]);
  const actual = useQuery({
    queryKey: ["assets-debt", "dated-liability-balance", connection?.id, debt.debt.liabilityAccountId, date],
    queryFn: async () => {
      if (!connection || !debt.debt.liabilityAccountId) throw new Error("Choose a liability account first.");
      return readDatedBalance(getTransport(connection), { accountId: debt.debt.liabilityAccountId, date });
    },
    enabled: !!connection && !!debt.debt.liabilityAccountId && !!date,
  });
  const actualMagnitude = actual.data?.ok && typeof debt.debt.signConvention === "string" ? toDebtMagnitude(actual.data.balanceMinor, debt.debt.signConvention) : null;
  const reconciliation = useQuery({
    queryKey: ["assets-debt", "reconciliation", debt.debt.id, date, actualMagnitude, offsetHistories],
    queryFn: () => getDebtReconciliation(debt.debt.id, { comparisonDate: date, actualBalanceMinor: actualMagnitude!, offsetHistories }),
    enabled: actualMagnitude !== null && actualMagnitude >= 0 && (!debt.offsets.some((offset) => offset.useActualBalance) || offsetHistories !== undefined),
  });
  const save = useMutation({
    mutationFn: () => recordDebtObservation(debt.debt.id, { observedOn: date, recordedAt: new Date().toISOString(), principalMinor: principalMinor!, accruedInterestMinor: interestMinor, supersedesObservationId: correctionId, note: correctionId ? "Corrected statement observation" : null }),
    onSuccess: () => { setPrincipalMinor(null); setCorrectionId(null); void queryClient.invalidateQueries({ queryKey: ["assets-debt", "observations", debt.debt.id] }); },
  });
  const anchor = useMutation({ mutationFn: (observationId: string) => createDebtAnchor(debt.debt.id, observationId), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["assets-debt"] }) });
  const diagnostic = useMutation({ mutationFn: (observationId: string) => runConventionDiagnostic(debt.debt.id, observationId) });
  const accept = useMutation({ mutationFn: () => acceptDebtDrift(debt.debt.id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["assets-debt"] }); } });
  const format = (minor: number | null) => minor === null ? "Not available" : new Intl.NumberFormat(undefined, { minimumFractionDigits: debt.debt.currencyMinorDigits, maximumFractionDigits: debt.debt.currencyMinorDigits }).format(minor / 10 ** debt.debt.currencyMinorDigits);

  return (
    <section aria-labelledby="lender-reconciliation-heading" className="flex flex-col gap-4 px-4 py-4 text-sm">
      <div><h1 id="lender-reconciliation-heading" className="text-base font-semibold">Lender reconciliation</h1><p className="text-xs text-muted-foreground">Compare the model, Actual and immutable lender-statement evidence on one date. This workflow is read-only in Actual.</p></div>
      <div className="grid gap-3 rounded border border-border p-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Comparison date<Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <MoneyField label="Lender principal" valueMinor={principalMinor} minorDigits={debt.debt.currencyMinorDigits} onChange={setPrincipalMinor} />
        <MoneyField label="Accrued lender interest" valueMinor={interestMinor} minorDigits={debt.debt.currencyMinorDigits} onChange={setInterestMinor} />
        <Button type="button" size="sm" className="self-end" disabled={principalMinor === null || save.isPending} onClick={() => save.mutate()}>{correctionId ? "Record correction" : "Record statement balance"}</Button>
      </div>
      {actual.data && !actual.data.ok ? <p role="alert" className="text-destructive">{actual.data.message}</p> : null}
      {reconciliation.data ? (
        <>
          <dl className="grid grid-cols-2 gap-2 rounded border border-border p-3 md:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Calculated</dt><dd className="font-semibold tabular-nums">{format(reconciliation.data.comparison.modelMinor)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Actual</dt><dd className="font-semibold tabular-nums">{format(reconciliation.data.comparison.actualMinor)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Observed lender</dt><dd className="font-semibold tabular-nums">{format(reconciliation.data.comparison.lenderMinor)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="font-semibold">{reconciliation.data.drift}{reconciliation.data.health.overdue ? " · reconciliation overdue" : ""}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Model vs Actual {format(reconciliation.data.comparison.modelVsActualMinor)}{reconciliation.data.comparison.modelVsLenderMinor !== null ? ` · Model vs lender ${format(reconciliation.data.comparison.modelVsLenderMinor)} · Actual vs lender ${format(reconciliation.data.comparison.actualVsLenderMinor)}` : ""}. Projected-balance variance is reported separately in matching backtests and is not treated as lender drift.</p>
          {reconciliation.data.drift === "material" ? <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => accept.mutate()}>Accept current difference</Button> : null}
        </>
      ) : null}
      <div>
        <h2 className="text-sm font-semibold">Statement history</h2>
        {observations.data?.observations.length ? <ul className="divide-y divide-border">{observations.data.observations.map((observation) => <li key={observation.id} className="flex flex-wrap items-center gap-2 py-2"><span className="tabular-nums">{observation.observedOn}</span><span>{format(observation.principalMinor)} principal</span><Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => { setCorrectionId(observation.id); setDate(observation.observedOn); setPrincipalMinor(observation.principalMinor); setInterestMinor(observation.accruedInterestMinor); }}>Correct</Button><Button type="button" size="sm" variant="outline" onClick={() => diagnostic.mutate(observation.id)}>Run convention diagnostic</Button><Button type="button" size="sm" variant="outline" onClick={() => anchor.mutate(observation.id)}>Use as new anchor</Button></li>)}</ul> : <p className="text-xs text-muted-foreground">No lender statement balances recorded.</p>}
        {diagnostic.data ? <div className="mt-3 rounded border border-border p-2 text-xs"><p className="font-medium">Closest compatible conventions</p><ul>{diagnostic.data.slice(0, 3).map((candidate) => <li key={JSON.stringify(candidate.variant)}>{candidate.variant.dayCount}, {candidate.variant.timing}, {candidate.variant.interestPostingRounding}: {format(candidate.differenceMinor)} difference{candidate.isCurrent ? " (current)" : ""}</li>)}</ul><p className="text-muted-foreground">Diagnostic results never change the saved calculation method.</p></div> : null}
      </div>
    </section>
  );
}
