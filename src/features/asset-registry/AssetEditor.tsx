"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ConnectionInstance } from "@/store/connection";
import type { Account } from "@/types/entities";
import { ASSET_TYPES, type Asset, type AssetType, type Registry } from "@/lib/asset-registry/models";
import { OwnershipTable } from "./OwnershipTable";
import { registryRequest } from "./api";
import { AssetMark } from "./AssetPresentation";
import { ToggleRow } from "./ToggleRow";
import { useAssetSetup } from "./useAssetSetup";

/**
 * Settings for an existing asset. Status sits first, the account is shown as a summary (it cannot change), ownership is a
 * table, and the account's reconciliation and sharing facts are tucked under Advanced. New assets use the creation drawer.
 */
export function AssetEditor({ connection, asset, accounts, registry, recordedValueMinor, bookContext, onClose, onSaved, onDeleted }: {
  connection: ConnectionInstance; asset: Asset; accounts: Account[]; registry: Registry; recordedValueMinor?: number | null;
  bookContext?: { balanceMinor: number | null; assignedMinor: number | null; unassignedMinor: number | null; memberCount: number; issues: string[] };
  onClose: () => void; onSaved: (registry: Registry) => void; /** Called after the asset was deleted permanently. */ onDeleted?: () => void;
}) {
  const setup = useAssetSetup({ connection, asset, accounts, registry, onDiscard: onClose });
  const { draft, setDraft, errors, setErrors, error, busy, classes, createUncertain, shared, discard } = setup;
  const account = accounts.find((a) => a.id === asset.actualAccountId);
  const money = (minor: number | null | undefined) => typeof minor === "number" ? formatAmount(minor, 2) : "Unavailable";
  const [confirmDelete, setConfirmDelete] = useState(false); const [deleteError, setDeleteError] = useState("");
  /** Permanently deletes an archived asset's Bench records; Actual is not touched. */
  async function remove() {
    setDeleteError("");
    try { onSaved(await registryRequest(connection.budgetSyncId, "DELETE", { assetId: asset.id })); onClose(); onDeleted?.(); }
    catch (e) { setDeleteError(e instanceof Error ? e.message : "The asset could not be deleted."); }
  }
  async function submit() {
    const saved = await setup.save();
    if (saved) { onSaved(saved.registry); onClose(); }
  }
  return <>
    {discard.discardDialog}
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} state={{ title: `Delete ${asset.name}?`, message: "This permanently removes the asset and what Bench saved for it. The Actual account and its transactions are not changed, and Bench can no longer show this asset.", destructiveLabel: "Delete asset", onConfirm: () => void remove() }} />
    <Sheet open onOpenChange={(open) => { if (!open) setup.close(); }}>
      <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:w-[min(calc(40rem+40px),95vw)] data-[side=right]:sm:max-w-none" side="right">
        <SheetHeader className="shrink-0 border-b p-4 pr-12"><div className="flex items-center gap-3"><AssetMark type={asset.assetType} header /><div className="min-w-0"><SheetTitle className="text-base">Asset settings</SheetTitle><SheetDescription className="truncate">{asset.name}</SheetDescription></div></div></SheetHeader>
        <form id="asset-settings" noValidate className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {draft.status === "archived" && recordedValueMinor !== 0 && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{recordedValueMinor == null ? "Recorded value is unavailable. Inspect the account before archiving." : `This asset still has a recorded value of ${formatAmount(recordedValueMinor, 2)}. Archiving keeps that value and its attribution.`}</p>}
          <section className="grid gap-3.5"><h3 className="text-sm font-semibold">Asset details</h3>
            <FormField label="Name" htmlFor="asset-name" required error={errors.name} errorId="asset-name-error"><Input id="asset-name" aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? "asset-name-error" : undefined} maxLength={200} value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} /></FormField>
            <FormField label="Asset type" htmlFor="asset-type" help="Fixed once the asset is saved: it decides which account class the asset's account must have."><Select disabled id="asset-type" value={draft.assetType} onValueChange={() => {}} options={Object.entries(ASSET_TYPES).map(([value, info]) => ({ value, label: info.label }))} /></FormField>
            <FormField label="Description (optional)" htmlFor="asset-description"><Textarea id="asset-description" className="min-h-16" rows={3} placeholder="Add a note about this asset" maxLength={2000} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></FormField>
            <ToggleRow id="asset-income" label="Generates income" hint="Rent, dividends or interest. Turn off for assets held for use or appreciation: the Overview then hides income figures." checked={draft.incomeGenerating ?? false} onChange={(checked) => { setup.setIncomeTouched(true); setDraft({ ...draft, incomeGenerating: checked }); }} />
            <ToggleRow id="asset-active" label="Active" hint="Turn off to archive the asset. Archiving does not close or zero the account in Actual; any remaining value stays attributed." checked={draft.status === "active"} onChange={(on) => setDraft({ ...draft, status: on ? "active" : "archived" })} />
          </section>
          <section className="grid gap-3.5 border-t pt-5"><div><h3 className="text-sm font-semibold">Linked Actual account</h3><p className="mt-0.5 text-xs text-muted-foreground">The account balance represents the asset&apos;s value. It cannot be changed once saved.</p></div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Account</dt><dd className="text-right font-medium">{account?.name ?? "Unavailable"}{account ? (account.offBudget ? " · Off budget" : " · On budget") : ""}</dd>
              <dt className="text-muted-foreground">Used by</dt><dd className="text-right">{bookContext && bookContext.memberCount > 1 ? `Shared by ${bookContext.memberCount} assets` : "This asset only"}</dd>
              {asset.assetTag && <><dt className="text-muted-foreground">Asset hashtag</dt><dd className="text-right"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{asset.assetTag}</code></dd></>}
            </dl>
            {shared && <p role="status" className="text-xs text-muted-foreground">This account is shared. Review Unassigned transactions after saving.</p>}
            {bookContext && <details className="rounded-md border px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Advanced: account reconciliation</summary>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">{[["Attributed to assets", bookContext.assignedMinor], ["Unassigned", bookContext.unassignedMinor], ["Account balance", bookContext.balanceMinor]].map(([label, minor]) => <div key={String(label)} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums">{money(minor as number | null)}</dd></div>)}</dl>
              <p className="mt-3 text-muted-foreground">The account balance equals the assets attributed to it plus Unassigned. Archived assets keep their tags and attribution. Asset values are already part of your Actual net worth.</p>
              {bookContext.issues.map((issue) => <p key={issue} className="mt-2 text-destructive">{issue}</p>)}</details>}
          </section>
          <section className="grid gap-3.5 border-t pt-5"><div className="flex items-center gap-1"><h3 className="text-sm font-semibold">Ownership</h3><InfoHint label="ownership">The account&apos;s value already represents your share. Ownership is recorded for reference and never multiplies or changes it.</InfoHint></div>
            <OwnershipTable value={draft.ownership} onChange={(ownership) => setDraft({ ...draft, ownership: ownership as typeof draft.ownership })} />
          </section>
          <section className="grid gap-3 border-t pt-5"><h3 className="text-sm font-semibold">Delete</h3>
            {asset.status === "archived" ? <>
              <p className="text-xs text-muted-foreground">Deleting removes this asset and everything Bench saved for it: entry types, linked income and expenses, rules, the depreciation schedule and loan allocations. Nothing in Actual changes: the account and every transaction in it, including any transfer Bench created, stay as they are.</p>
              <div><Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>Delete asset permanently</Button></div>
              {deleteError && <p role="alert" className="text-xs text-destructive">{deleteError}</p>}
            </> : <p className="text-xs text-muted-foreground">To delete this asset, turn off Active and save to archive it first. Deleting only removes Bench&apos;s records; Actual is not changed.</p>}
          </section>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
        <SheetFooter className="flex-row justify-end border-t px-6 py-4"><Button variant="outline" disabled={busy} onClick={setup.close}>Cancel</Button><Button form="asset-settings" type="submit" disabled={busy || !classes.available || createUncertain}>{busy ? "Saving…" : "Save asset"}</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  </>;
}
export type { AssetType };
