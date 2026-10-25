"use client";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PayeePicker } from "@/components/ui/entity-picker";
import { FormField } from "@/components/ui/form-field";
import { Info, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { assetHashtags, attributeBook, type BookSnapshot } from "@/lib/asset-registry/ledger";
import { bookTypeChoices } from "./bookTypes";
import { BOOK_TYPES, type Asset, type BookType, type Registry } from "@/lib/asset-registry/models";
import { BOOK_TYPE_TAGS, withTypeTag } from "@/lib/asset-registry/tags";
import { boundTreatment, executeAction, prepareAction, UncertainAssetWrite, writeTypeTags, type ActionContext, type BookEdit, type PreparedAction, type ActionResult } from "@/lib/asset-registry/actions";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import { registryRequest } from "./api";

const money = (n: number) => formatAmount(n, 2);
export function BookActionEditor({ kind, row: sourceRow, accountName, initialClassification, asset, registry, snapshot, financialLock, registerNavigationGuard, fresh, onClose, onSaved, onUncertain }: {
  asset?: Asset; registry?: Registry; snapshot?: BookSnapshot; financialLock?: string | null;
  registerNavigationGuard?: (guard: ((action: () => void) => void) | null) => void;
  kind: BookEdit["kind"]; row?: SyncSourceTransaction; accountName?: string; initialClassification?: BookType; fresh: (date: string) => Promise<ActionContext>;
  onClose: () => void; onSaved: (registry?: Registry) => Promise<void>; onUncertain?: () => void;
}) {
  const [row] = useState(sourceRow);
  const [savedClassification] = useState(initialClassification ?? (sourceRow ? "" : "revaluation"));
  const [date, setDate] = useState(row?.date ?? bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [initialDate] = useState(date);
  const [amount, setAmount] = useState(row ? minorToMajorText(row.amount, 2) : "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [payeeId, setPayeeId] = useState(row?.payeeId ?? "");
  const [payees, setPayees] = useState<{ id: string; name: string }[]>([]);
  const [classification, setClassification] = useState<string>(initialClassification ?? (row ? "" : "revaluation"));
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Field-level problems are shown beside their field, not only at the bottom of the panel. */
  const [fieldError, setFieldError] = useState<{ amount?: string; type?: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [complete, setComplete] = useState(false);
  const [metadataRevision, setMetadataRevision] = useState(0);
  const [metadataAssignment, setMetadataAssignment] = useState<string | null>(null);
  const members = registry?.assets.filter((member) => member.actualAccountId === asset?.actualAccountId) ?? [];
  const [shared] = useState(members.length > 1);
  const [originalMetadata] = useState(() => registry?.metadata.find((entry) => entry.actualTransactionId === row?.id));
  const [attributed] = useState(() => row && snapshot && registry ? attributeBook(snapshot, registry.assets, registry.metadata).rows.find((entry) => entry.id === row.id) : null);
  const [assignment, setAssignment] = useState(row ? attributed?.assetId ?? "" : asset?.id ?? "");
  const financialChanged = !row || date !== row.date || amount !== minorToMajorText(row.amount, 2) || notes !== (row.notes ?? "") || payeeId !== (row.payeeId ?? "");
  const parsedAmount = parseMajorToMinor(amount.trim().replace(/^[+-]/, ""), 2);
  const signedMinor = parsedAmount.ok && parsedAmount.value !== null ? parsedAmount.value * (amount.trim().startsWith("-") ? -1 : 1) : 0;
  const typeAmount = kind === "set-value" && prepared ? prepared.deltaMinor : signedMinor;
  const allowedTypes = bookTypeChoices(typeAmount);
  const tagLocked = !!row && assetHashtags(notes).length > 0;
  const assignmentChanged = shared && row && assignment !== (attributed?.assetId ?? "");
  async function editorContext(atDate: string) {
    const context = await fresh(atDate);
    if (kind === "create" && shared) {
      const target = context.registry.assets.find((member) => member.id === assignment && member.actualAccountId === context.asset.actualAccountId);
      if (!target) throw new Error("Choose an asset for this shared account transaction.");
      return { ...context, asset: target };
    }
    return context;
  }
  async function saveOnlyMetadata() {
    if (!row || busy || complete) return;
    setBusy(true); setError("");
    try {
      if (classification && !allowedTypes.includes(classification as BookType)) throw new Error("Choose a type allowed for this amount.");
      const context = await fresh(snapshot?.date ?? date);
      const current = context.snapshot.source.find((entry) => entry.id === row.id);
      const metadata = context.registry.metadata.find((entry) => entry.actualTransactionId === row.id);
      if (JSON.stringify(current) !== JSON.stringify(row) || (metadata?.revision ?? 0) !== (originalMetadata?.revision ?? 0)) throw new Error("The transaction changed. Refresh before saving; your draft is preserved.");
      const currentMembers = context.registry.assets.filter((member) => member.actualAccountId === row.accountId);
      if (assignmentChanged && (currentMembers.length < 2 || (assignment && !currentMembers.some((member) => member.id === assignment)))) throw new Error("Shared account membership changed. Refresh before assigning.");
      if (assignmentChanged && assetHashtags(row.notes ?? "").length) throw new Error("This row is assigned by its hashtag. Amend its Notes in Actual first.");
      const bound = boundTreatment(context.registry, row.id);
      if (bound && (classification || null) !== bound) throw new Error("This row belongs to a capital or disposal treatment; its type cannot be changed here.");
      if (classification !== savedClassification) await writeTypeTags(context, [row.id], (classification || null) as BookType | null);
      await onSaved(await registryRequest(context.asset.budgetSyncId, "PATCH", { changes: [{ actualTransactionId: row.id, actualAccountId: row.accountId, assetId: assignmentChanged ? assignment || null : metadata?.assetId ?? null, classification: classification || null, revision: metadata?.revision ?? 0 }] }));
      setComplete(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save transaction metadata"); }
    finally { setBusy(false); }
  }
  async function preview() {
    setBusy(true); setError("");
    try {
      const negative = amount.trim().startsWith("-");
      const parsed = parseMajorToMinor(amount.trim().replace(/^[+-]/, ""), 2);
      setFieldError(null);
      if (kind !== "delete" && (!parsed.ok || parsed.value === null)) { setFieldError({ amount: parsed.ok ? "Enter an amount" : parsed.message }); return; }
      const amountMinor = parsed.ok && parsed.value !== null ? parsed.value * (negative ? -1 : 1) : 0;
      if (financialLock) throw new Error(financialLock);
      const ctx = await editorContext(date);
      if (row && JSON.stringify(ctx.snapshot.source.find((entry) => entry.id === row.id)) !== JSON.stringify(row)) throw new Error("The transaction changed. Refresh before reviewing this edit.");
      const ordinary = (await ctx.transport.getPayees()).filter((p) => !p.transferAccountId);
      setPayees(ordinary);
      if (payeeId && !ordinary.some((p) => p.id === payeeId)) throw new Error("The payee is missing or is a transfer payee");
      setBudget(ctx.asset.budgetSyncId);
      if (classification && (kind === "create" || kind === "edit") && !allowedTypes.includes(classification as BookType)) { setFieldError({ type: "Choose a type allowed for this amount." }); return; }
      if (assignmentChanged && assetHashtags(notes).length) throw new Error("Remove the conflicting hashtag before changing assignment.");
      setMetadataAssignment(shared && row && !assetHashtags(notes).length ? assignment || null : ctx.registry.metadata.find((m) => m.actualTransactionId === row?.id)?.assetId ?? (shared && !ctx.asset.assetTag ? ctx.asset.id : null));
      setMetadataRevision(ctx.registry.metadata.find((m) => m.actualTransactionId === row?.id)?.revision ?? 0);
      const finalNotes = kind === "delete" ? notes : classification ? withTypeTag(notes, classification as BookType) : savedClassification ? withTypeTag(notes, null) : notes;
      setPrepared(prepareAction(ctx, { kind, date, amountMinor, notes: finalNotes, payeeId: payeeId || null, transactionId: row?.id }));
    } catch (e) { setError(e instanceof Error ? e.message : "Preview failed"); }
    finally { setBusy(false); }
  }
  async function saveMetadata(known: ActionResult) {
    if (known.noop || !known.transactionId) { await onSaved(); setComplete(true); return; }
    // A deleted depreciation row keeps its month association so the schedule shows "Actual row missing" for reposting.
    if (known.deleted && originalMetadata?.depreciationPeriod) { setComplete(true); await onSaved(); return; }
    const registry = await registryRequest(budget, "PATCH", { changes: [{ actualTransactionId: known.transactionId, actualAccountId: prepared!.accountId, assetId: metadataAssignment, classification: known.deleted ? null : classification || null, revision: metadataRevision, remove: known.deleted }] });
    setComplete(true); await onSaved(registry);
  }
  async function confirm() {
    if (!prepared || busy || uncertain || complete) return;
    if (kind !== "delete" && classification && !bookTypeChoices(kind === "set-value" ? prepared.deltaMinor : signedMinor).includes(classification as BookType)) { setFieldError({ type: "Choose a type allowed for this amount." }); return; }
    setBusy(true); setError("");
    try {
      const known = result ?? await executeAction(prepared, () => editorContext(date));
      setResult(known); // retained even if metadata fails; retry never calls Actual again
      await saveMetadata(known);
    } catch (e) {
      if (e instanceof UncertainAssetWrite) { setUncertain(true); onUncertain?.(); }
      setError(e instanceof Error ? e.message : "Write failed");
    } finally { setBusy(false); }
  }
  const autoPreview = useRef(false);
  useEffect(() => { if (kind === "delete" && !autoPreview.current) { autoPreview.current = true; void preview(); } });
  const title = kind === "set-value" ? "Update value" : kind === "delete" ? "Delete from Actual" : kind === "edit" ? "Edit account transaction" : "Add Transaction";
  const dirty = !complete && !uncertain && ((row ? financialChanged : !!amount || !!notes || !!payeeId || date !== initialDate || (shared && assignment !== asset?.id)) || !!assignmentChanged || classification !== savedClassification);
  const discard = useDiscardChanges(dirty, onClose);
  const closeGuard = useRef(discard.confirmThen);
  useEffect(() => { closeGuard.current = (action) => { if (!busy) discard.confirmThen(action); }; });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    registerNavigationGuard?.((action) => closeGuard.current(action));
    const input = document.getElementById("book-amount") as HTMLInputElement | null;
    if (input && !input.matches(":disabled")) input.focus(); else document.getElementById("book-type")?.focus();
    return () => { registerNavigationGuard?.(null); if (opener?.isConnected) opener.focus(); };
  }, [registerNavigationGuard]);
  function close() { if (!busy) discard.requestClose(); }
  const asDialog = kind === "create" || kind === "set-value";
  const content = <>
    {asDialog
      ? <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12"><DialogTitle className="text-sm">{title}</DialogTitle><DialogDescription className="text-xs">{accountName ?? "Linked asset account"}</DialogDescription></DialogHeader>
      : <>
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4"><h3 className="text-sm font-semibold">{title}</h3><Button variant="ghost" size="icon" className="size-7" aria-label="Close transaction editor" disabled={busy} onClick={close}><X className="size-4" /></Button></header>
    <p className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">{accountName ?? "Linked asset account"}</p>
      </>}
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <fieldset disabled={!!prepared || busy || complete || uncertain || !!financialLock} className="grid gap-4">
        {kind !== "delete" && <FormField label="Effective date" htmlFor="book-date" help="The date the row has in Actual and the date the value change takes effect."><DateInput id="book-date" value={date} onValueChange={setDate} /></FormField>}
        {kind !== "delete" && <><FormField label={kind === "set-value" ? "Target owned recorded value" : "Signed amount"} htmlFor="book-amount" required help={kind === "set-value" ? "Bench adds the one adjustment that makes the asset reach this value." : "Positive adds to the asset, negative reduces it."} error={fieldError?.amount} errorId="book-amount-error"><Input id="book-amount" inputMode="decimal" aria-required="true" aria-invalid={!!fieldError?.amount} aria-describedby={fieldError?.amount ? "book-amount-error" : undefined} value={amount} onChange={(e) => { setAmount(e.target.value); setFieldError(null); }} /></FormField>
          <FormField label="Actual Notes" htmlFor="book-notes" help="Stored on the Actual transaction. The type tag and the asset tag are added for you."><Input id="book-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
          <FormField label="Existing payee" htmlFor="book-payee" help="Optional. Only ordinary payees can be used, not transfer payees."><PayeePicker ariaLabel="Existing payee" value={payeeId} allowNone noneLabel="No payee" payees={payees} onOpenChange={(open) => { if (open) void fresh(date).then((ctx) => ctx.transport.getPayees()).then((list) => setPayees(list.filter((p) => !p.transferAccountId))).catch(() => setError("Could not load payees")); }} onChange={setPayeeId} /></FormField>
          </>}
      </fieldset>
      {financialLock && <p role="note" className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{financialLock}</p>}
      {kind !== "delete" && <fieldset disabled={busy || !!result || complete || uncertain} className="grid gap-4">
        <FormField label="Bench classification" htmlFor="book-type" help={classification ? `Saved in Bench and written to the Notes in Actual as ${BOOK_TYPE_TAGS[classification as BookType]} (not for protected rows).` : "Saved in Bench and written to the Notes in Actual as a tag (not for protected rows)."} error={fieldError?.type} errorId="book-type-error"><Select id="book-type" aria-describedby={fieldError?.type ? "book-type-error" : undefined} value={classification} onValueChange={(v) => { setClassification(v); setFieldError(null); }} options={[{ value: "", label: "Unclassified" }, ...allowedTypes.map((value) => ({ value, label: BOOK_TYPES[value] }))]} /></FormField>
        {shared && kind !== "set-value" && <FormField label="Asset assignment" htmlFor="book-assignment" help="Which asset in this shared account the row belongs to." note={tagLocked ? "Assigned by the hashtag in Actual Notes." : undefined}><Select id="book-assignment" value={assignment} disabled={tagLocked || !!prepared} onValueChange={setAssignment} options={[...(row ? [{ value: "", label: "Unassigned" }] : []), ...members.map((member) => ({ value: member.id, label: member.name }))]} /></FormField>}
      </fieldset>}
      {prepared && <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm">
        <p className="font-medium">{kind === "delete" ? "This removes the transaction from Actual" : `${title} · ${date}`}</p><p>Actual account: {accountName ?? "Linked asset account"}</p>
        {row && <p>Existing row: {row.date} · {money(row.amount)} · {row.payeeName ?? "No payee"} · {row.notes ?? "No Notes"}</p>}
        <dl className="grid grid-cols-2 gap-2"><dt>Asset value before</dt><dd className="text-right tabular-nums">{money(prepared.beforeMinor)}</dd><dt>Signed change</dt><dd className="text-right tabular-nums">{money(prepared.deltaMinor)}</dd><dt>Asset value after</dt><dd className="text-right tabular-nums">{money(prepared.afterMinor)}</dd></dl>
        <details><summary className="cursor-pointer text-xs text-muted-foreground">Actual Notes & attribution</summary><p className="mt-2 break-words text-xs">{prepared.edit.notes || "-"} · {prepared.assetTag}</p></details><p>Payee: {payees.find((p) => p.id === payeeId)?.name ?? "No payee"}</p>
      </div>}
      {result && !complete && <p role="status" className="rounded border p-3 text-sm">Actual write confirmed{result.transactionId ? `: ${result.transactionId}` : ""}. Classification remains pending. Retry saves metadata only.</p>}
      {complete && <p role="status">{!result ? "Classification and assignment saved." : result?.noop ? "Value already matches; no row created." : "Actual write verified. Refresh complete."}</p>}
      {uncertain && <p role="alert">The editor is locked. Close it, Refresh, and inspect Actual before deciding whether another action is needed.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
    <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t p-3"><Button variant="outline" disabled={busy} onClick={close}>{complete || uncertain ? "Close" : "Cancel"}</Button>{prepared && !result && !uncertain && !complete && kind !== "delete" && <Button variant="outline" disabled={busy} onClick={() => setPrepared(null)}>Edit details</Button>}{!complete && !uncertain && <Button variant={kind === "delete" ? "destructive" : "default"} disabled={busy || (kind === "delete" && !prepared && !result)} onClick={() => void (row && kind === "edit" && !financialChanged ? saveOnlyMetadata() : prepared ? confirm() : preview())}>{busy ? "Working…" : result ? "Retry metadata only" : prepared ? (kind === "delete" ? "Delete from Actual" : "Confirm Actual write") : row && kind === "edit" && !financialChanged ? "Save changes" : "Review change"}</Button>}</footer>
  </>;
  return <>{discard.discardDialog}{asDialog
    ? <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent aria-label="Account transaction editor" className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">{content}</DialogContent></Dialog>
    : <aside aria-label="Account transaction editor" className="flex min-h-0 w-[394px] shrink-0 flex-col border-l border-border/60 bg-background" onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="listbox"], [data-slot="popover-content"]')) { event.preventDefault(); close(); } }}>
    {content}
  </aside>}</>;
}
