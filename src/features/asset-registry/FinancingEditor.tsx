"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { changePair, checkLoanLimits, loanFingerprint, loanShares, trackedEquity, type AllocationOperation, type AssetDebtLink, type DatedDebt } from "@/lib/asset-registry/financing";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import type { Asset, Registry } from "@/lib/asset-registry/models";
import { parseRateBps } from "./DepreciationEditor";
import { assetMoney } from "./AssetPresentation";
import { registryRequest } from "./api";

class FieldFailure extends Error {}
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
/** One short line about a loan, from what Loans & Debt already knows. */
export function loanFacts(loan: DebtSummary): string[] {
  const term = loan.contractualTermMonths ? (loan.contractualTermMonths % 12 === 0 ? `${loan.contractualTermMonths / 12} years` : `${loan.contractualTermMonths} months`) : null;
  const rate = loan.annualRateDecimal !== null && loan.annualRateDecimal !== undefined ? `${(Number(loan.annualRateDecimal) * 100).toFixed(2).replace(/\.?0+$/, "")}% a year` : null;
  return [loan.openingPrincipalMinor !== null ? `Original ${assetMoney(loan.openingPrincipalMinor)}` : null, loan.openingDate ? `Opened ${shortDate(loan.openingDate)}` : null, rate, term].filter((x): x is string => !!x);
}
export function FinancingEditor({ asset, registry, loans, preset, initialMode = "set", today, firstDate, valueAt, debtsAt, balanceAt, onSaved, onClose }: {
  asset: Asset; registry: Registry; loans: DebtSummary[]; preset?: AssetDebtLink; initialMode?: "set" | "end"; today: string; onSaved: (registry: Registry) => Promise<void>; onClose: () => void;
  /** The date of the asset's first ledger entry: an allocation never defaults to start before it. */ firstDate?: string;
  /** For the "what will happen" preview: the asset's recorded value on a date, the other linked loans' debt, and any loan's Actual debt (positive; null when unknown). */
  valueAt?: (date: string) => number | null; debtsAt?: (date: string) => DatedDebt[]; balanceAt?: (debtId: string, date: string) => Promise<number | null>;
}) {
  const links = registry.debtLinks ?? [];
  const eligible = loans.filter((d) => (d.status === "active" && !d.blocked && d.liabilityAccountId) || d.id === preset?.debtId);
  const [debtId, setDebtId] = useState(preset?.debtId ?? "");
  const [mode, setMode] = useState<"set" | "end">(initialMode);
  const [from, setFrom] = useState(today); const [to, setTo] = useState("");
  const [share, setShare] = useState(preset ? (preset.allocationBps / 100).toFixed(2) : "");
  const [touched, setTouched] = useState({ from: !!preset, share: !!preset });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const fail = (field: string, message: string) => { setFieldError({ field, message }); return new FieldFailure(message); };
  const invalid = (field: string) => fieldError?.field === field;
  const err = (field: string) => invalid(field) ? fieldError!.message : null;
  const dirty = !!debtId && (mode === "end" || !!share) && !busy;
  const discard = useDiscardChanges(dirty, onClose);
  const loan = loans.find((d) => d.id === debtId);
  const remainderAt = (date: string) => debtId && isIsoDate(date) ? loanShares(links.filter((l) => l.assetId !== asset.id), debtId, date).unallocatedBps : null;
  const remainder = remainderAt(from);

  /** Choosing a loan fills what it implies: the date it opened (never before the asset's first entry) and the share nobody else holds. */
  function chooseLoan(id: string) {
    setDebtId(id); setFieldError(null);
    const picked = loans.find((d) => d.id === id);
    const opened = picked?.openingDate && isIsoDate(picked.openingDate) ? picked.openingDate : today;
    const start = firstDate && opened < firstDate ? firstDate : opened;
    const nextFrom = touched.from ? from : start;
    if (!touched.from) setFrom(start);
    const free = remainderAt(nextFrom) ?? 10000;
    if (!touched.share) setShare((Math.max(free, 1) / 100).toFixed(2));
  }

  // What the change does to equity, on the date it takes effect (today when that is already past).
  const previewDate = isIsoDate(from) ? (from <= today ? today : from) : today;
  const [balance, setBalance] = useState<{ key: string; magnitude: number | null } | null>(null);
  useEffect(() => {
    if (!debtId || !balanceAt) return;
    let live = true; const key = `${debtId}|${previewDate}`;
    balanceAt(debtId, previewDate).then((magnitude) => { if (live) setBalance({ key, magnitude }); }).catch(() => { if (live) setBalance({ key, magnitude: null }); });
    return () => { live = false; };
  }, [debtId, previewDate, balanceAt]);
  const loanDebt = balance?.key === `${debtId}|${previewDate}` ? balance.magnitude : undefined; // undefined: still reading
  const bps = parseRateBps(share);
  const pair = links.filter((l) => l.assetId === asset.id && l.debtId === debtId);
  let nextPair: AssetDebtLink[] | null = null; let problem = "";
  if (debtId && isIsoDate(from) && (mode === "end" || (bps !== null && bps >= 1 && bps <= 10000))) {
    try {
      const operation: AllocationOperation = mode === "end" ? { kind: "end", assetId: asset.id, debtId, effectiveFrom: from } : { kind: "set", assetId: asset.id, debtId, effectiveFrom: from, allocationBps: bps!, ...(to && isIsoDate(to) ? { effectiveTo: to } : {}) };
      nextPair = changePair(pair, operation);
      problem = checkLoanLimits([...links.filter((l) => !(l.assetId === asset.id && l.debtId === debtId)), ...nextPair]) ?? "";
    } catch (e) { problem = e instanceof Error ? e.message : "This change cannot be applied"; }
  }
  const value = valueAt ? valueAt(previewDate) : null;
  const otherDebts = (debtsAt ? debtsAt(previewDate) : []).filter((d) => d.debtId !== debtId);
  const debts: DatedDebt[] = [...otherDebts, { debtId, magnitudeMinor: loanDebt ?? null }];
  const before = valueAt ? trackedEquity(asset.id, previewDate, links, value, debts) : null;
  const after = valueAt && nextPair && !problem ? trackedEquity(asset.id, previewDate, [...links.filter((l) => !(l.assetId === asset.id && l.debtId === debtId)), ...nextPair], value, debts) : null;
  const closed = nextPair ? pair.filter((p) => nextPair!.some((n) => n.effectiveFrom === p.effectiveFrom && n.effectiveTo !== p.effectiveTo)) : [];
  const money = (n: number | null | undefined) => n === undefined || n === null ? "Unavailable" : assetMoney(n);

  async function save() {
    setBusy(true); setError(""); setFieldError(null);
    try {
      if (!debtId) throw fail("loan", "Choose a loan");
      if (!isIsoDate(from)) throw fail("from", "Choose a valid effective date");
      let operation: object;
      if (mode === "end") operation = { kind: "end", effectiveFrom: from };
      else {
        if (bps === null || bps < 1 || bps > 10000) throw fail("share", "Enter an explicit share between 0.01% and 100%");
        if (to && !isIsoDate(to)) throw fail("to", "Choose a valid end date");
        operation = { kind: "set", effectiveFrom: from, allocationBps: bps, ...(to ? { effectiveTo: to } : {}) };
      }
      await onSaved(await registryRequest(asset.budgetSyncId, "PUT", { __path: "financing", assetId: asset.id, debtId, operation, expectedFingerprint: loanFingerprint(links, debtId) }));
      onClose();
    } catch (e) { if (!(e instanceof FieldFailure)) setError(e instanceof Error ? e.message : "Could not save the allocation"); }
    finally { setBusy(false); }
  }
  const bind = (field: string) => ({ "aria-invalid": invalid(field) || undefined, "aria-describedby": invalid(field) ? `fin-${field}-err` : undefined });
  return <>{discard.discardDialog}<Dialog open onOpenChange={(open) => { if (!open && !busy) discard.requestClose(); }}><DialogContent className="sm:max-w-4xl">
    <DialogHeader><DialogTitle>{mode === "end" ? "End loan allocation" : "Link a loan"}</DialogTitle><DialogDescription>{asset.name} · choose how much of a loan&apos;s Actual debt counts against this asset. Bench only records the share: the loan, its repayments and your Actual transactions never change.</DialogDescription></DialogHeader>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <fieldset disabled={busy} className="grid content-start gap-4">
        <FormField label="Loan" htmlFor="fin-loan" help="Active loans from Loans & Debt that are bound to an Actual liability account." required error={err("loan")} errorId="fin-loan-err"><Select id="fin-loan" aria-invalid={invalid("loan") || undefined} disabled={!!preset} value={debtId} onValueChange={chooseLoan} options={[{ value: "", label: eligible.length ? "Choose a loan…" : "No eligible loans" }, ...eligible.map((d) => ({ value: d.id, label: d.name }))]} /></FormField>
        {loan && <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs"><p className="text-sm font-medium">{loan.name}</p><p className="mt-0.5 text-muted-foreground">{loanFacts(loan).join(" · ") || "No loan terms recorded"}</p>
          <p className="mt-1">Actual debt {isIsoDate(from) && from > today ? "is not known for a future date" : `on ${shortDate(previewDate)}`}: <span className="font-medium tabular-nums">{loanDebt === undefined ? "reading…" : money(loanDebt)}</span></p></div>}
        <FormField label="Change" htmlFor="fin-mode" help="Set a share from a date, or end the allocation on a date."><Select id="fin-mode" value={mode} onValueChange={(v) => setMode(v as "set" | "end")} options={[{ value: "set", label: "Set the allocation from a date" }, { value: "end", label: "End the allocation on a date" }]} /></FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={mode === "end" ? "Ends on" : "Effective from"} htmlFor="fin-from" help={mode === "end" ? "The allocation stops applying on this date (exclusive)." : "The first day the share applies. It starts from the date the loan opened."} required error={err("from")} errorId="fin-from-err"><DateInput id="fin-from" value={from} onValueChange={(v) => { setFrom(v); setTouched((t) => ({ ...t, from: true })); }} /></FormField>
          {mode === "set" && <FormField label="Ends (optional)" htmlFor="fin-to" help="Exclusive end date; leave empty for open-ended." error={err("to")} errorId="fin-to-err"><DateInput id="fin-to" value={to} onValueChange={setTo} /></FormField>}
        </div>
        {mode === "set" && <FormField label="Share of the loan's Actual debt (%)" htmlFor="fin-share" help="An explicit share. Ownership percentage never sets it." required error={err("share")} errorId="fin-share-err"
          note={remainder !== null ? `Other assets hold ${pct(10000 - remainder)} on that date; ${pct(remainder)} is free.` : undefined}>
          <div className="flex items-center gap-2"><Input id="fin-share" className="w-32" inputMode="decimal" {...bind("share")} value={share} onChange={(e) => { setShare(e.target.value); setTouched((t) => ({ ...t, share: true })); }} />
            <Button type="button" size="xs" variant="outline" onClick={() => { setShare("100.00"); setTouched((t) => ({ ...t, share: true })); }}>100%</Button>
            {remainder !== null && remainder < 10000 && remainder > 0 && <Button type="button" size="xs" variant="outline" onClick={() => { setShare((remainder / 100).toFixed(2)); setTouched((t) => ({ ...t, share: true })); }}>Free share ({pct(remainder)})</Button>}</div></FormField>}
      </fieldset>
      <aside aria-label="What will happen" className="grid content-start gap-3 rounded-lg bg-muted/30 p-4 text-xs">
        <h3 className="text-sm font-semibold">What will happen</h3>
        {!debtId ? <p className="text-muted-foreground">Choose a loan to see how this changes the asset&apos;s equity.</p> : <>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {mode === "set"
              ? <li>{bps !== null && isIsoDate(from) ? <>From <span className="font-medium text-foreground">{shortDate(from)}</span>{to && isIsoDate(to) ? <> to <span className="font-medium text-foreground">{shortDate(to)}</span></> : ", with no end date,"} <span className="font-medium text-foreground">{pct(bps)}</span> of {loan?.name}&apos;s Actual debt counts against {asset.name}.</> : "Enter a share and a start date."}</li>
              : <li>The allocation stops applying on <span className="font-medium text-foreground">{isIsoDate(from) ? shortDate(from) : "the date you choose"}</span>.</li>}
            {closed.map((c) => <li key={c.effectiveFrom}>The period that started {shortDate(c.effectiveFrom)} is closed on {shortDate(from)}.</li>)}
            <li>Earlier and later periods are kept.</li>
            <li>Nothing changes in Actual or in the loan.</li>
          </ul>
          {problem ? <p role="alert" className="text-destructive">{problem}</p> : valueAt && <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 border-t pt-3 tabular-nums">
            <dt className="text-muted-foreground">On {shortDate(previewDate)}</dt><dd className="text-right text-muted-foreground">Now</dd><dd className="text-right text-muted-foreground">After</dd>
            <dt>Recorded value</dt><dd className="text-right">{money(value)}</dd><dd className="text-right">{money(value)}</dd>
            <dt>Allocated debt</dt><dd className="text-right">{money(before?.allocatedDebtMinor)}</dd><dd className="text-right">{money(after?.allocatedDebtMinor)}</dd>
            <dt className="font-medium">Tracked equity</dt><dd className="text-right font-medium">{money(before?.equityMinor)}</dd><dd className="text-right font-medium">{money(after?.equityMinor)}</dd></dl>}
        </>}
      </aside>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={() => discard.requestClose()}>Cancel</Button><Button disabled={busy || !debtId || !!problem} onClick={() => void save()}>{busy ? "Saving…" : mode === "end" ? "End allocation" : "Save allocation"}</Button></DialogFooter>
  </DialogContent></Dialog></>;
}
