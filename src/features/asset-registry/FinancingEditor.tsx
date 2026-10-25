"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { loanFingerprint, loanShares, type AssetDebtLink } from "@/lib/asset-registry/financing";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import type { Asset, Registry } from "@/lib/asset-registry/models";
import { parseRateBps } from "./DepreciationEditor";
import { registryRequest } from "./api";

class FieldFailure extends Error {}
export function FinancingEditor({ asset, registry, loans, preset, today, onSaved, onClose }: {
  asset: Asset; registry: Registry; loans: DebtSummary[]; preset?: AssetDebtLink; today: string; onSaved: (registry: Registry) => Promise<void>; onClose: () => void;
}) {
  const links = registry.debtLinks ?? [];
  const eligible = loans.filter((d) => (d.status === "active" && !d.blocked && d.liabilityAccountId) || d.id === preset?.debtId);
  const [debtId, setDebtId] = useState(preset?.debtId ?? "");
  const [mode, setMode] = useState<"set" | "end">("set");
  const [from, setFrom] = useState(today); const [to, setTo] = useState("");
  const [share, setShare] = useState(preset ? (preset.allocationBps / 100).toFixed(2) : "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const fail = (field: string, message: string) => { setFieldError({ field, message }); return new FieldFailure(message); };
  const invalid = (field: string) => fieldError?.field === field;
  const err = (field: string) => invalid(field) ? fieldError!.message : null;
  const dirty = !!debtId && (mode === "end" || !!share) && !busy;
  const discard = useDiscardChanges(dirty, onClose);
  const remainder = debtId && isIsoDate(from) ? loanShares(links.filter((l) => l.assetId !== asset.id), debtId, from).unallocatedBps : null;
  async function save() {
    setBusy(true); setError(""); setFieldError(null);
    try {
      if (!debtId) throw fail("loan", "Choose a loan");
      if (!isIsoDate(from)) throw fail("from", "Choose a valid effective date");
      let operation: object;
      if (mode === "end") operation = { kind: "end", effectiveFrom: from };
      else {
        const bps = parseRateBps(share);
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
  return <>{discard.discardDialog}<Dialog open onOpenChange={(open) => { if (!open && !busy) discard.requestClose(); }}><DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>Loan allocation</DialogTitle><DialogDescription>{asset.name} · Bench metadata only: the loan, its repayments, interest, offsets, anchors and your Actual transactions are not changed. Earlier and later periods are kept.</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <FormField className="sm:col-span-2" label="Existing loan" htmlFor="fin-loan" help="Active loans from Loans & Debt that are bound to an Actual liability account." required error={err("loan")} errorId="fin-loan-err"><Select id="fin-loan" aria-invalid={invalid("loan") || undefined} disabled={!!preset} value={debtId} onValueChange={setDebtId} options={[{ value: "", label: eligible.length ? "Choose a loan" : "No active loan bound to an Actual account" }, ...eligible.map((d) => ({ value: d.id, label: d.name }))]} /></FormField>
      <FormField label="Change" htmlFor="fin-mode" help="Set a share from a date, or end the allocation on a date."><Select id="fin-mode" value={mode} onValueChange={(v) => setMode(v as "set" | "end")} options={[{ value: "set", label: "Set the allocation from a date" }, { value: "end", label: "End the allocation on a date" }]} /></FormField>
      <FormField label={mode === "end" ? "Ends on" : "Effective from"} htmlFor="fin-from" help={mode === "end" ? "The allocation stops applying on this date (exclusive)." : "The first day the share applies."} required error={err("from")} errorId="fin-from-err"><DateInput id="fin-from" value={from} onValueChange={setFrom} /></FormField>
      {mode === "set" && <>
        <FormField label="Share of the loan's Actual debt (%)" htmlFor="fin-share" help="An explicit share. Ownership percentage never sets it." required error={err("share")} errorId="fin-share-err" note={remainder !== null ? `Other assets leave ${(remainder / 100).toFixed(2)}% unallocated on that date.` : undefined}><Input id="fin-share" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} {...bind("share")} /></FormField>
        <FormField label="Ends (optional)" htmlFor="fin-to" help="Exclusive end date; leave empty for open-ended." error={err("to")} errorId="fin-to-err"><DateInput id="fin-to" value={to} onValueChange={setTo} /></FormField>
      </>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={() => discard.requestClose()}>Cancel</Button><Button disabled={busy || !debtId} onClick={() => void save()}>{busy ? "Saving…" : mode === "end" ? "End allocation" : "Save allocation"}</Button></DialogFooter>
  </DialogContent></Dialog></>;
}
