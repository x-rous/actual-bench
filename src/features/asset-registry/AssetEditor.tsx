"use client";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ConnectionInstance } from "@/store/connection";
import type { Account } from "@/types/entities";
import { ASSET_TYPES, type Asset, type AssetType, type Registry } from "@/lib/asset-registry/models";
import { OwnershipTable } from "./OwnershipTable";
import { useAssetSetup } from "./useAssetSetup";

/**
 * Settings for an existing asset. Status sits first, the account is shown as a summary (it cannot change), ownership is a
 * table, and the account's reconciliation and sharing facts are tucked under Advanced. New assets use the creation wizard.
 */
export function AssetEditor({ connection, asset, accounts, registry, recordedValueMinor, bookContext, onClose, onSaved }: {
  connection: ConnectionInstance; asset: Asset; accounts: Account[]; registry: Registry; recordedValueMinor?: number | null;
  bookContext?: { balanceMinor: number | null; assignedMinor: number | null; unassignedMinor: number | null; memberCount: number; issues: string[] };
  onClose: () => void; onSaved: (registry: Registry) => void;
}) {
  const setup = useAssetSetup({ connection, asset, accounts, registry, onDiscard: onClose });
  const { draft, setDraft, errors, setErrors, error, busy, classes, createUncertain, shared, discard } = setup;
  const account = accounts.find((a) => a.id === asset.actualAccountId);
  const money = (minor: number | null | undefined) => typeof minor === "number" ? formatAmount(minor, 2) : "Unavailable";
  async function submit() {
    const saved = await setup.save();
    if (saved) { onSaved(saved.registry); onClose(); }
  }
  return <>
    {discard.discardDialog}
    <Sheet open onOpenChange={(open) => { if (!open) setup.close(); }}>
      <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:w-[min(40rem,95vw)] data-[side=right]:sm:max-w-none" side="right">
        <SheetHeader className="shrink-0 border-b p-4 pr-12"><SheetTitle>Asset settings</SheetTitle><SheetDescription>{asset.name}</SheetDescription></SheetHeader>
        <form id="asset-settings" noValidate className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {draft.status === "archived" && recordedValueMinor !== 0 && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{recordedValueMinor == null ? "Recorded value is unavailable. Inspect the account before archiving." : `This asset still has a recorded value of ${formatAmount(recordedValueMinor, 2)}. Archiving keeps that value and its attribution.`}</p>}
          <section className="grid gap-3"><h3 className="text-xs font-semibold">Details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Name" htmlFor="asset-name" required error={errors.name} errorId="asset-name-error"><Input id="asset-name" aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? "asset-name-error" : undefined} maxLength={200} value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} /></FormField>
              <FormField label="Asset type" htmlFor="asset-type" help="Fixed once the asset is saved: it decides which account class the asset's account must have."><Select disabled id="asset-type" value={draft.assetType} onValueChange={() => {}} options={Object.entries(ASSET_TYPES).map(([value, info]) => ({ value, label: info.label }))} /></FormField>
              <FormField className="sm:col-span-2" label="Description" htmlFor="asset-description"><Textarea id="asset-description" className="min-h-16" maxLength={2000} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></FormField>
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3"><div className="flex items-center gap-2"><Switch id="asset-income" aria-labelledby="asset-income-label" aria-describedby="asset-income-hint" checked={draft.incomeGenerating ?? false} onCheckedChange={(checked) => { setup.setIncomeTouched(true); setDraft({ ...draft, incomeGenerating: checked }); }} />
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Label id="asset-income-label" htmlFor="asset-income" className="text-xs leading-4">Generates income</Label><InfoHint label="Generates income"><span id="asset-income-hint">Rent, dividends or interest are expected. Turn off for assets held for use or appreciation (a car, a collectible): the Overview then hides Operating Result and yield.</span></InfoHint></div></div>
              <div className="flex items-center gap-2"><Switch id="asset-active" aria-labelledby="asset-active-label" checked={draft.status === "active"} onCheckedChange={(on) => setDraft({ ...draft, status: on ? "active" : "archived" })} />
                <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Label id="asset-active-label" htmlFor="asset-active" className="text-xs leading-4">Active</Label><InfoHint label="Active">Turn off to archive the asset. Archiving does not close or zero the account in Actual; any remaining value stays attributed and is still included in reconciliation.</InfoHint></div></div></div>
          </section>
          <section className="grid gap-3 border-t pt-4"><h3 className="text-xs font-semibold">Actual account</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-md border bg-muted/20 px-3 py-2.5 text-xs">
              <dt className="text-muted-foreground">Account</dt><dd className="text-right font-medium">{account?.name ?? "Unavailable"}{account ? (account.offBudget ? " · Off budget" : " · On budget") : ""}</dd>
              <dt className="text-muted-foreground">Used by</dt><dd className="text-right">{bookContext && bookContext.memberCount > 1 ? `Shared by ${bookContext.memberCount} assets` : "This asset only"}</dd>
              {asset.assetTag && <><dt className="text-muted-foreground">Asset hashtag</dt><dd className="text-right"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{asset.assetTag}</code></dd></>}
            </dl>
            {shared && <p role="status" className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">This account is shared. Review Unassigned transactions after saving.</p>}
            {bookContext && <details className="rounded-md border px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Advanced: account reconciliation</summary>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">{[["Attributed to assets", bookContext.assignedMinor], ["Unassigned", bookContext.unassignedMinor], ["Account balance", bookContext.balanceMinor]].map(([label, minor]) => <div key={String(label)} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums">{money(minor as number | null)}</dd></div>)}</dl>
              <p className="mt-3 text-muted-foreground">The account balance equals the assets attributed to it plus Unassigned. Archived assets keep their tags and attribution. Asset values are already part of your Actual net worth.</p>
              {bookContext.issues.map((issue) => <p key={issue} className="mt-2 text-destructive">{issue}</p>)}</details>}
          </section>
          <section className="grid gap-3 border-t pt-4"><div className="flex items-center gap-1"><h3 className="text-xs font-semibold">Ownership</h3><InfoHint label="ownership">The account&apos;s value already represents your share. Ownership is recorded for reference and never multiplies or changes it.</InfoHint></div>
            <OwnershipTable value={draft.ownership} onChange={(ownership) => setDraft({ ...draft, ownership: ownership as typeof draft.ownership })} />
          </section>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
        <SheetFooter className="flex-row justify-end border-t px-6 py-4"><Button variant="outline" disabled={busy} onClick={setup.close}>Cancel</Button><Button form="asset-settings" type="submit" disabled={busy || !classes.available || createUncertain}>{busy ? "Saving…" : "Save asset"}</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  </>;
}
export type { AssetType };
