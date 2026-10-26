"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountPicker, CategoryPicker } from "@/components/ui/entity-picker";
import { TransactionPickerDialog } from "@/components/transactions/TransactionPickerDialog";
import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";
import { SidePanel } from "@/features/credit-cards/components/primitives/SidePanel";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import { minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { ChoiceCards } from "@/components/ui/choice-cards";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { attributeBook } from "@/lib/asset-registry/ledger";
import { UncertainAssetWrite, type ActionResult } from "@/lib/asset-registry/actions";
import { prepareCapital, executeCapital, capitalMetadata, capitalEvidence, type CapitalContext, type CapitalInput, type CapitalPrepared, type PaymentType } from "@/lib/asset-registry/capitalActions";
import { accountOfTransaction, sourceEvidence } from "@/lib/asset-registry/cashflows";
import type { Category } from "@/types/entities";
import { assetMoney } from "./AssetPresentation";
import { saleModel } from "./saleReview";
import { registryRequest } from "./api";
import type { Registry } from "@/lib/asset-registry/models";

const pickLabel = (r: PickedTransaction) => `${r.date} · ${r.payeeName ?? "No payee"} · ${assetMoney(r.amountMinor)}`;
export function CapitalEditor({ kind, context, categories, fresh, onSaved, onClose, onUncertain, onPendingMetadata }: {
  /** "payment" is Add a payment (an existing expense or a new transfer); "dispose" is a sale or write-off. */ kind: "payment" | "dispose"; context: CapitalContext; categories: Category[]; fresh: (date: string, accountIds?: string[]) => Promise<CapitalContext>;
  onSaved: (registry?: Registry) => Promise<void>; onClose: () => void; onUncertain: () => void; onPendingMetadata: () => void;
}) {
  const today = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [date, setDate] = useState(today); const [notes, setNotes] = useState("");
  const [sourcePick, setSourcePick] = useState<PickedTransaction | null>(null); const [transferId, setTransferId] = useState("");
  const [feePicks, setFeePicks] = useState<PickedTransaction[]>([]); const [picker, setPicker] = useState<"source" | "fees" | null>(null);
  const [representation, setRepresentation] = useState<"external-receipt" | "asset-transfer" | "write-off">("external-receipt"); const [basis, setBasis] = useState<"gross" | "net">("gross");
  const [amount, setAmount] = useState(() => kind === "dispose" ? minorToMajorText(attributeBook(context.snapshot, context.registry.assets, context.registry.metadata).totals.get(context.asset.id) ?? 0, 2) : ""); const [accountId, setAccountId] = useState(""); const [categoryId, setCategoryId] = useState(""); const [notRecorded, setNotRecorded] = useState(false);
  const [prepared, setPrepared] = useState<CapitalPrepared | null>(null); const [known, setKnown] = useState<ActionResult | null>(null); const [touched, setTouched] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [complete, setComplete] = useState(false); const [uncertain, setUncertain] = useState(false); const [error, setError] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  // The first money into an asset is its purchase; later money is added capital.
  const [asType, setAsType] = useState<PaymentType>(() => attributeBook(context.snapshot, context.registry.assets, context.registry.metadata).rows.some((r) => r.assetId === context.asset.id && ["acquisition", "added-capital"].includes(r.classification ?? "")) ? "added-capital" : "acquisition");
  const sourceId = kind === "dispose" && representation === "asset-transfer" ? transferId : sourcePick?.id ?? "";
  const discard = useDiscardChanges(!complete && !uncertain && (!!amount || !!sourceId || !!notes || !!accountId || feePicks.length > 0), onClose);
  const title = kind === "dispose" ? "Record a sale or write-off" : "Add a payment";
  const book = attributeBook(context.snapshot, context.registry.assets, context.registry.metadata);
  const assetAccounts = [...new Set(context.registry.assets.map((a) => a.actualAccountId))];
  const allLinks = [...context.registry.metadata, ...(context.registry.cashflows ?? [])];
  const reasonOf = (row: PickedTransaction) => {
    const link = allLinks.find((m) => m.actualTransactionId === row.id);
    if (link && link.assetId && link.assetId !== context.asset.id) return "Already linked to another asset";
    if (link?.context) return "Already part of a sale";
    return null;
  };
  function choose(rows: PickedTransaction[]) {
    if (picker === "fees") { setFeePicks(rows); return; }
    const row = rows[0]; setSourcePick(row);
    setDate(row.date); // an existing movement keeps its own date
  }
  async function review() {
    setBusy(true); setError("");
    try {
      const parsed = parseMajorToMinor(amount, 2); const minor = parsed.ok && parsed.value !== null ? parsed.value : 0;
      const base = { date, notes };
      const input: CapitalInput = kind === "payment" && mode === "existing" ? { ...base, kind: "convert", sourceId, asType } : kind === "dispose" ? { ...base, kind, sourceId, representation, carryingMinor: minor, proceedsBasis: basis, feeIds: feePicks.map((r) => r.id) } : { ...base, kind: "acquire", asType, sourceAccountId: accountId, categoryId, amountMinor: minor, paymentNotRecorded: notRecorded };
      const accounts = new Set<string>([...(sourcePick ? [sourcePick.accountId] : []), ...feePicks.map((r) => r.accountId), ...(kind === "payment" && mode === "new" && accountId ? [accountId] : [])]);
      if (kind === "dispose" && representation === "asset-transfer" && transferId) {
        const counterpart = book.rows.find((r) => r.id === transferId)?.transferId;
        const where = counterpart ? await accountOfTransaction(context.transport, counterpart) : null;
        if (where) accounts.add(where);
      }
      const ids = [...accounts]; setTouched(ids);
      setPrepared(prepareCapital(await fresh(date, ids), input));
    } catch (e) { setError(e instanceof Error ? e.message : "Preview failed"); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!prepared || busy || uncertain || complete) return;
    setBusy(true); setError("");
    try {
      const result = known ?? await executeCapital(prepared, () => fresh(date, touched)); setKnown(result); onPendingMetadata();
      const live = await fresh(date, touched);
      await onSaved(await registryRequest(context.asset.budgetSyncId, "PUT", { changes: capitalMetadata(prepared, result), sources: sourceEvidence(capitalEvidence(live)) }));
      setComplete(true);
    } catch (e) { if (e instanceof UncertainAssetWrite) { setUncertain(true); onUncertain(); } setError(e instanceof Error ? e.message : "Posting failed"); }
    finally { setBusy(false); }
  }
  function close() { if (busy) return; if (known && !complete) { setError("Actual has changed. Retry the pending metadata before closing this treatment."); return; } discard.requestClose(); }
  if (kind === "dispose") {
    const before = book.totals.get(context.asset.id) ?? 0;
    const transferRow = representation === "asset-transfer" ? book.rows.find((r) => r.id === transferId) : undefined;
    const wholeMinor = before + (transferRow ? -transferRow.amountMinor : 0);
    const hasSource = representation === "external-receipt" ? !!sourcePick : representation === "asset-transfer" ? !!transferId : false;
    const locked = busy || !!prepared || complete || uncertain;
    const net = prepared ? prepared.proceedsMinor - (representation === "write-off" || basis === "gross" ? prepared.feesMinor : 0) : 0;
    const gain = prepared && prepared.input.kind === "dispose" ? net - prepared.input.carryingMinor : 0;
    const model = prepared ? saleModel({ representation, sourceLabel: representation === "external-receipt" ? (sourcePick ? pickLabel(sourcePick) : null) : transferRow ? `(${transferRow.label} · ${transferRow.date} · ${assetMoney(transferRow.amountMinor)})` : null,
      adjustmentMinor: prepared.deltaMinor, date, feeLabels: feePicks.map(pickLabel), basis, netProceedsMinor: net, gainMinor: gain }) : null;
    return <>{discard.discardDialog}<Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12"><DialogTitle>{title}</DialogTitle><DialogDescription className="text-xs">{context.asset.name} · recorded value {assetMoney(before)}. Nothing is written until you confirm.</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <fieldset disabled={locked} className="grid gap-5">
          <ChoiceCards legend="What happened?" columns={3} name="sale-representation" value={representation} onChange={(v) => { setRepresentation(v); setSourcePick(null); setTransferId(""); }} options={[
            { value: "external-receipt", title: "I sold it and the money is in my account", detail: "A deposit for the sale is already in one of your accounts in Actual." },
            { value: "asset-transfer", title: "I sold it and the money was moved out of the asset's account", detail: "A transfer from the asset's account to your bank is already in Actual." },
            { value: "write-off", title: "I got no money", detail: "Given away, scrapped, lost or written off." },
          ]} />
          {representation !== "write-off" && <fieldset className="grid gap-4 rounded-xl border px-4 pt-3 pb-4"><legend className="-ml-1 px-2 text-xs font-semibold">The sale</legend>
            {representation === "external-receipt"
              ? <FormField label="The payment you received" help="The deposit already in Actual. Its category, payee, amount, Notes and date never change."><Button variant="outline" className="justify-start" onClick={() => setPicker("source")}>{sourcePick ? pickLabel(sourcePick) : "Choose the deposit…"}</Button></FormField>
              : <FormField label="The transfer" htmlFor="sale-source" help="The transfer out of the asset's account that carries the sale proceeds."><Select id="sale-source" value={transferId} onValueChange={(id) => { setTransferId(id); const row = book.rows.find((r) => r.id === id); if (row) setDate(row.date); }} options={book.rows.filter((r) => r.assetId === context.asset.id && r.transferId && r.amountMinor < 0).map((r) => ({ value: r.id, label: `${r.date} · ${r.label} · ${assetMoney(r.amountMinor)}` }))} /></FormField>}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Selling costs (optional)" help="Expenses you already entered, such as an agent's fee. They stay in your budget unchanged."><div className="flex items-center gap-2"><Button variant="outline" onClick={() => setPicker("fees")}>{feePicks.length ? `${feePicks.length} selected` : "Add selling costs…"}</Button>{feePicks.length > 0 && <Button size="xs" variant="ghost" onClick={() => setFeePicks([])}>Clear</Button>}</div></FormField>
              {feePicks.length > 0 && <FormField label="Does this payment include the costs?" htmlFor="sale-basis" help="If the payment is before costs, Bench subtracts the costs you added. If it is already after costs, it does not subtract them again."><Select id="sale-basis" value={basis} onValueChange={(v) => setBasis(v as typeof basis)} options={[{ value: "gross", label: "Before costs: subtract the costs I added" }, { value: "net", label: "Already after costs" }]} /></FormField>}
            </div>
          </fieldset>}
          <fieldset className="grid gap-4 rounded-xl border px-4 pt-3 pb-4"><legend className="-ml-1 px-2 text-xs font-semibold">How much leaves the asset</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Value removed from the asset" htmlFor="capital-amount" help="The recorded value that leaves the asset. For a full sale use the whole value; a smaller amount records a partial sale." note={`Recorded value now: ${assetMoney(wholeMinor)}`}>
                <div className="flex items-center gap-2"><Input id="capital-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><Button size="sm" variant="outline" className="shrink-0" onClick={() => setAmount(minorToMajorText(wholeMinor, 2))}>Whole asset</Button></div></FormField>
              <FormField label="Date of the sale" htmlFor="capital-date" help={hasSource ? "Taken from the payment you chose." : "The date of the asset's entry in Actual."}><DateInput id="capital-date" disabled={hasSource} value={date} onValueChange={setDate} /></FormField>
            </div>
            <FormField label="Note (optional)" htmlFor="capital-notes" help="Stored on the asset's new entry in Actual. The type tag and the asset tag are added for you."><Input id="capital-notes" value={notes} onChange={(e) => { setNotes(e.target.value); }} /></FormField>
          </fieldset>
        </fieldset>
        {prepared && model && <section aria-label="How this will be recorded" className="grid gap-3 rounded-xl border bg-muted/20 px-4 py-3 text-xs">
          <h3 className="text-sm font-semibold">How this will be recorded</h3>
          <div><p className="font-medium">In Actual</p><ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/80">{model.actual.map((line) => <li key={line}>{line}</li>)}</ul></div>
          <div><p className="font-medium">In Bench</p><ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/80">{model.bench.map((line) => <li key={line}>{line}</li>)}</ul></div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t pt-3"><dt>Asset value before</dt><dd className="text-right tabular-nums">{assetMoney(prepared.beforeMinor)}</dd><dt>Asset value after</dt><dd className="text-right font-medium tabular-nums">{assetMoney(prepared.afterMinor)}</dd>
            <dt>Money you got after costs</dt><dd className="text-right tabular-nums">{assetMoney(net)}</dd><dt>Gain or loss on the sale</dt><dd className="text-right tabular-nums">{assetMoney(gain)}</dd></dl>
        </section>}
        {known && !complete && <p role="status" className="text-xs">Actual treatment confirmed. Only relationship metadata remains pending; retry does not repeat the financial write.</p>}
        {complete && <p role="status" className="text-sm">Treatment saved and Actual values refreshed.</p>}
        {uncertain && <p role="alert" className="text-sm">Refresh and inspect Actual before another action. This editor will not repeat the write.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter className="mx-0 mb-0 shrink-0 items-center border-t px-6 py-3"><Button variant="outline" disabled={busy} onClick={close}>{complete || uncertain ? "Close" : "Cancel"}</Button>{prepared && !known && !uncertain && !complete && <Button variant="outline" disabled={busy} onClick={() => setPrepared(null)}>Edit details</Button>}{!complete && !uncertain && <Button disabled={busy} onClick={() => void (prepared ? confirm() : review())}>{busy ? "Working…" : known ? "Retry metadata only" : prepared ? "Confirm Actual write" : "Review"}</Button>}</DialogFooter>
      {picker && <TransactionPickerDialog today={today} title={picker === "fees" ? "Link selling costs" : "Select the payment you received"} multiple={picker === "fees"} disabledReason={reasonOf} confirmLabel={picker === "fees" ? "Use selected costs" : "Use selected transaction"}
      constraints={{ excludeAccountIds: assetAccounts, excludeTransfers: true, amountSign: picker === "fees" ? "negative" : "positive" }} onClose={() => setPicker(null)} onConfirm={(rows) => choose(rows)} />}
    </DialogContent></Dialog></>;
  }
  const converting = mode === "existing";
  const sourceAccountName = sourcePick ? context.external.accounts.find((a) => a.id === sourcePick.accountId)?.name ?? sourcePick.accountName : "";
  return <>{discard.discardDialog}<SidePanel title={title} description={context.asset.name} className="w-[394px]" onClose={close} footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>{complete || uncertain ? "Close" : "Cancel"}</Button>{prepared && !known && !uncertain && !complete && <Button variant="outline" disabled={busy} onClick={() => setPrepared(null)}>Edit</Button>}{!prepared && !complete && !uncertain && <Button disabled={busy || (converting ? !sourceId : false)} onClick={() => void review()}>{busy ? "Checking…" : "Review"}</Button>}{prepared && !uncertain && !complete && <Button disabled={busy} onClick={() => void confirm()}>{busy ? "Working…" : known ? "Retry metadata only" : converting ? "Convert to transfer" : "Record payment"}</Button>}</div>}>
    <fieldset disabled={busy || !!prepared || complete || uncertain} className="grid gap-4 p-4">
      <p className="text-xs text-muted-foreground">A payment is <span className="font-medium text-foreground">capital added to the asset&apos;s value</span>: it is recorded as a Acquisition / Purchase, counts toward what you have invested, and raises the recorded value by its amount.</p>
      <div className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">How was it paid?</p>
        <div role="group" aria-label="How was it paid" className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
          {([["existing", "Already in Actual"], ["new", "Not in Actual yet"]] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setPrepared(null); setError(""); }} className={cn("h-8 rounded-md px-2 text-xs transition-colors", mode === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}
        </div>
        <p className="text-xs text-muted-foreground">{converting ? "You entered the payment as an expense. Bench turns it into the transfer into this asset by changing only its payee." : "Bench records the payment as one transfer from the account you paid with."}</p></div>
      <FormField label="Record it as" htmlFor="payment-type" help="Acquisition / Purchase is the purchase itself. Added Capital is money you put in afterwards, such as an improvement or an extra contribution. Both are capital: neither counts as a change in the asset's worth."><Select id="payment-type" value={asType} onValueChange={(v) => setAsType(v as PaymentType)} options={[{ value: "acquisition", label: "Acquisition / Purchase" }, { value: "added-capital", label: "Added Capital" }]} /></FormField>
      {converting
        ? <FormField label="The expense" help="An expense you already entered in Actual, paid out of another account. Its amount, date, category and Notes stay as they are."><Button variant="outline" className="h-auto justify-start py-1.5 text-left" onClick={() => setPicker("source")}>{sourcePick ? pickLabel(sourcePick) : "Choose the expense…"}</Button></FormField>
        : <>
          <FormField label="Paid from" help="The account the payment left. Bench creates one transfer from it to the asset account."><AccountPicker ariaLabel="Payment account" value={accountId} onChange={setAccountId} accounts={context.external.accounts.filter((a) => !a.closed && !context.registry.assets.some((asset) => asset.actualAccountId === a.id))} /></FormField>
          <FormField label="Category" help="The category recorded on the on-budget side of the payment."><CategoryPicker ariaLabel="Payment category" value={categoryId} onChange={setCategoryId} categories={categories.filter((c) => !c.isIncome)} /></FormField>
          <FormField label="Amount" htmlFor="capital-amount" help="The amount you paid."><Input id="capital-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
          <FormField label="Date" htmlFor="capital-date"><DateInput id="capital-date" value={date} onValueChange={setDate} /></FormField>
          <FormField label="Notes (optional)" htmlFor="capital-notes" help="Stored on the transfer in Actual. The asset tag is added for you."><Input id="capital-notes" value={notes} onChange={(e) => { setNotes(e.target.value); }} /></FormField>
          <label className="flex items-start gap-2 text-xs"><Checkbox checked={notRecorded} onCheckedChange={(value) => setNotRecorded(value === true)} />This payment is not already in Actual.</label>
        </>}
    </fieldset>
    {prepared && <div className="space-y-3 border-t p-4 text-sm">
      <p className="font-medium">{converting ? "This expense becomes a transfer" : "One new transfer into the asset"}</p>
      {converting && sourcePick && <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground"><li>In {sourceAccountName}: the payee {sourcePick.payeeName ? `“${sourcePick.payeeName}”` : "(none)"} becomes the transfer to {context.asset.name}.</li><li>Amount, date, category and Notes stay as they are.</li><li>Actual adds the matching {assetMoney(prepared.deltaMinor)} entry in the asset&apos;s account.</li></ul>}
      <dl className="grid grid-cols-2 gap-2"><dt>Asset value before</dt><dd className="text-right tabular-nums">{assetMoney(prepared.beforeMinor)}</dd><dt>Capital added</dt><dd className="text-right tabular-nums">{assetMoney(prepared.deltaMinor)}</dd><dt>Asset value after</dt><dd className="text-right font-medium tabular-nums">{assetMoney(prepared.afterMinor)}</dd></dl></div>}
    {known && !complete && <p role="status" className="p-4 text-xs">Actual is updated. Only the relationship metadata remains pending; retry does not repeat the write.</p>}
    {complete && <p role="status" className="p-4 text-sm">Payment recorded and Actual values refreshed.</p>}
    {uncertain && <p role="alert" className="p-4 text-sm">Refresh and inspect Actual before another action. This editor will not repeat the write.</p>}
    {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
  </SidePanel>
  {picker && <TransactionPickerDialog today={today} title="Select the expense" disabledReason={reasonOf} confirmLabel="Use selected expense"
    constraints={{ excludeAccountIds: assetAccounts, excludeTransfers: true, amountSign: "negative" }}
    onClose={() => setPicker(null)} onConfirm={(rows) => choose(rows)} />}
  </>;
}
