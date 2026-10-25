"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { DEPRECIATION_METHODS, depreciationInputSchema, type DepreciationMethod, type DepreciationSettings } from "@/lib/asset-registry/depreciation";
import type { Asset, Registry } from "@/lib/asset-registry/models";
import { assetMoney } from "./AssetPresentation";
import { registryRequest } from "./api";

class FieldFailure extends Error {}
const major = (minor: number) => (minor / 100).toFixed(2);
/** Two-decimal percent text to basis points, without binary floats. */
export function parseRateBps(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}
export function DepreciationEditor({ asset, settings, recordedMinor, today, onSaved, onClose }: {
  asset: Asset; settings?: DepreciationSettings; recordedMinor: number | null; today: string; onSaved: (registry: Registry) => Promise<void>; onClose: () => void;
}) {
  const [method, setMethod] = useState<DepreciationMethod>(settings?.method ?? "straight-line");
  const [basis, setBasis] = useState(settings ? major(settings.basisMinor) : recordedMinor !== null && recordedMinor > 0 ? major(recordedMinor) : "");
  const [residual, setResidual] = useState(settings ? major(settings.residualMinor) : "0.00");
  const [start, setStart] = useState(settings?.startDate ?? `${today.slice(0, 7)}-01`);
  const [life, setLife] = useState(settings?.lifeMonths ? String(settings.lifeMonths) : "60");
  const [rate, setRate] = useState(settings?.annualRateBps ? (settings.annualRateBps / 100).toFixed(2) : "20.00");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null); const [confirmRemove, setConfirmRemove] = useState(false);
  const fail = (field: string, message: string) => { setFieldError({ field, message }); return new FieldFailure(message); };
  const invalid = (field: string) => fieldError?.field === field;
  const dirty = !settings || basis !== major(settings.basisMinor) || residual !== major(settings.residualMinor) || start !== settings.startDate || method !== settings.method
    || (method === "straight-line" ? life !== String(settings.lifeMonths ?? "") : rate !== (settings.annualRateBps ? (settings.annualRateBps / 100).toFixed(2) : ""));
  const discard = useDiscardChanges(dirty && !busy, onClose);
  async function save(remove: boolean) {
    setBusy(true); setError(""); setFieldError(null);
    try {
      let payload: object | null = null;
      if (!remove) {
        const b = parseMajorToMinor(basis, 2); const r = parseMajorToMinor(residual, 2);
        if (!b.ok || b.value === null || !r.ok || r.value === null) throw fail(!b.ok || b.value === null ? "basis" : "residual", "Enter an amount with at most two decimals");
        const bps = method === "declining-balance" ? parseRateBps(rate) : null;
        if (method === "declining-balance" && bps === null) throw fail("rate", "Enter a percentage with at most two decimals");
        const months = method === "straight-line" ? Number(life) : null;
        if (method === "straight-line" && !(Number.isInteger(months) && months! > 0)) throw fail("life", "Enter a whole number of months");
        const parsed = depreciationInputSchema.safeParse({ method, basisMinor: b.value, residualMinor: r.value, startDate: start, lifeMonths: months, annualRateBps: bps });
        if (!parsed.success) { const issue = parsed.error.issues[0]; throw fail(issue.path[0] === "startDate" ? "start" : issue.path[0] === "residualMinor" || /Residual/.test(issue.message) ? "residual" : "form", issue.message); }
        payload = parsed.data;
      }
      await onSaved(await registryRequest(asset.budgetSyncId, "PUT", { __path: "depreciation", assetId: asset.id, assetRevision: asset.revision, expectedUpdatedAt: settings?.updatedAt ?? null, settings: payload }));
      onClose();
    } catch (e) { if (!(e instanceof FieldFailure)) setError(e instanceof Error ? e.message : "Could not save the schedule"); }
    finally { setBusy(false); }
  }
  const err = (field: string) => invalid(field) ? fieldError!.message : null;
  const bind = (field: string) => ({ "aria-invalid": invalid(field) || undefined, "aria-describedby": invalid(field) ? `dep-${field}-err` : undefined });
  return <>{discard.discardDialog}<ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} state={{ title: "Remove depreciation schedule?", message: "The planning schedule is deleted from Bench. Months already posted to Actual stay where they are; edit or delete them in Account Transactions.", destructiveLabel: "Remove schedule", onConfirm: () => void save(true) }} />
    <Dialog open onOpenChange={(open) => { if (!open && !busy) discard.requestClose(); }}><DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Depreciation schedule</DialogTitle><DialogDescription>{asset.name} · saving stores a planning schedule in Bench only. No Actual transaction is written.</DialogDescription></DialogHeader>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <FormField label="Method" htmlFor="dep-method" help="Personal planning conventions, not tax depreciation."><Select id="dep-method" value={method} onValueChange={(v) => setMethod(v as DepreciationMethod)} options={Object.entries(DEPRECIATION_METHODS).map(([value, label]) => ({ value, label }))} /></FormField>
        <FormField label="Start date" htmlFor="dep-start" help="The first calendar month is a full period." error={err("start")} errorId="dep-start-err"><DateInput id="dep-start" value={start} onValueChange={setStart} /></FormField>
        <FormField label="Depreciable basis" htmlFor="dep-basis" help="The amount the schedule starts from. Later revaluations never change it." required error={err("basis")} errorId="dep-basis-err" note={recordedMinor !== null ? `Recorded Actual value today: ${assetMoney(recordedMinor)}` : undefined}><Input id="dep-basis" inputMode="decimal" value={basis} onChange={(e) => setBasis(e.target.value)} {...bind("basis")} /></FormField>
        <FormField label="Residual value" htmlFor="dep-residual" help="The carrying value the forecast never goes below." error={err("residual")} errorId="dep-residual-err"><Input id="dep-residual" inputMode="decimal" value={residual} onChange={(e) => setResidual(e.target.value)} {...bind("residual")} /></FormField>
        {method === "straight-line"
          ? <FormField label="Useful life (months)" htmlFor="dep-life" help="Equal monthly decreases until the residual value." required error={err("life")} errorId="dep-life-err"><Input id="dep-life" inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} {...bind("life")} /></FormField>
          : <FormField label="Annual declining rate (%)" htmlFor="dep-rate" help="Each month: balance × annual rate ÷ 12, never below the residual." required error={err("rate")} errorId="dep-rate-err"><Input id="dep-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} {...bind("rate")} /></FormField>}
      </fieldset>
      {(error || invalid("form")) && <p role="alert" className="text-sm text-destructive">{error || fieldError?.message}</p>}
      <DialogFooter className="sm:justify-between">
        <div>{settings && <Button variant="outline" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove schedule</Button>}</div>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => discard.requestClose()}>Cancel</Button><Button disabled={busy || !dirty} onClick={() => void save(false)}>{busy ? "Saving…" : "Save schedule"}</Button></div>
      </DialogFooter>
    </DialogContent></Dialog></>;
}
