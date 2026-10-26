"use client";
import { useState } from "react";
import { SearchableCombobox } from "@/components/ui/combobox";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { AccountFormValues } from "@/features/accounts/schemas/account.schema";
import { parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { useQuery } from "@tanstack/react-query";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { getTransport } from "@/lib/actual";
import { ASSET_TYPES, defaultIncomeGenerating, type AssetType, type Registry } from "@/lib/asset-registry/models";
import { cn } from "@/lib/utils";
import type { ConnectionInstance } from "@/store/connection";
import type { Account } from "@/types/entities";
import { AssetMark } from "./AssetPresentation";
import { OWNERSHIP_FROM_START } from "./OwnershipTable";
import { recordStartingValue } from "./startingValue";
import { ToggleRow } from "./ToggleRow";
import { useAssetSetup } from "./useAssetSetup";

/** A valid shared-asset hashtag from free text: lowercase letters, digits, underscores and hyphens after #asset_. */
const hashtagFrom = (text: string): string => `#asset_${text.trim().toLowerCase().replace(/^#?(asset_)?/, "").replace(/[^a-z0-9_-]+/g, "_").replace(/^_+/, "").slice(0, 93)}`;
/**
 * Adds an asset in one drawer: a name, a type, the share you own, its off-budget account (new or existing) and, optionally,
 * its opening value. Nothing else is asked: how the asset was acquired is recorded as entries in its Asset Ledger, as many
 * as needed. A new account is derived from the asset. If the optional opening value fails after the asset is created, the
 * asset is kept and the failure is said plainly.
 */
export function AssetCreateDrawer({ connection, accounts, registry, today, onSaved, onOpenAsset, onClose }: {
  connection: ConnectionInstance; accounts: Account[]; registry: Registry; today: string;
  onSaved: (registry: Registry) => void; onOpenAsset: (assetId: string) => void; onClose: () => void;
}) {
  const setup = useAssetSetup({ connection, accounts, registry, onDiscard: onClose, ownershipFrom: OWNERSHIP_FROM_START });
  const { draft, setDraft, errors, setErrors, error, busy, classes, createUncertain, pendingId, accountOptions, accountMode, hashtag } = setup;
  const [share, setShare] = useState("100"); const [shareError, setShareError] = useState("");
  const [accountPick, setAccountPick] = useState<"new" | "existing">("new");
  const [startAmount, setStartAmount] = useState(""); const [startDate, setStartDate] = useState(today); const [startError, setStartError] = useState("");
  const [created, setCreated] = useState<{ assetId: string; message: string } | null>(null);
  const accountClass = ASSET_TYPES[draft.assetType]?.accountClass;
  const picked = accountPick === "existing" && !!draft.actualAccountId;
  const balances = useQuery({ queryKey: ["assetAccountBalances", connection.id], queryFn: () => getTransport(connection).getAccountBalances(), enabled: picked, retry: false });
  const wholeBalance = picked ? balances.data?.get(draft.actualAccountId) : undefined;
  /** The chosen account's balance in integer minor units (Actual's entity balances are whole units). */
  const balance = typeof wholeBalance === "number" ? Math.round(wholeBalance * 100) : undefined;
  const changeShare = (text: string) => {
    setShare(text); const n = Number(text); const ok = text.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 100;
    setShareError(ok ? "" : "Enter a share between 0.01 and 100.");
    if (ok) setDraft((d) => ({ ...d, ownership: [{ effectiveFrom: OWNERSHIP_FROM_START, ownershipBps: Math.round(n * 100) }] }));
  };
  const changeType = (value: string) => { setAccountPick("new"); setDraft({ ...draft, assetType: value as AssetType, actualAccountId: "", ...(setup.incomeTouched ? {} : { incomeGenerating: defaultIncomeGenerating(value) }) }); };
  const startParsed = parseMajorToMinor(startAmount.trim(), 2);
  const startMinor = startAmount.trim() === "" ? 0 : startParsed.ok && startParsed.value !== null ? startParsed.value : -1;

  async function submit() {
    if (!draft.name.trim()) { setErrors({ name: "Enter a name for this asset." }); document.getElementById("asset-name")?.focus(); return; }
    if (shareError) { document.getElementById("asset-share")?.focus(); return; }
    if (startMinor < 0 || (startAmount.trim() !== "" && startMinor === 0)) { setStartError("Enter a positive opening value, or leave it empty."); return; }
    setStartError("");
    if (accountPick === "existing" && !setup.validate()) return;
    // A new account is derived from the asset: its name, off budget, and the class its type needs.
    const staged = accountPick === "new" ? setup.stageAccount({ name: draft.name.trim(), offBudget: true, accountClass } as AccountFormValues) : null;
    if (accountPick === "new" && !staged) return;
    const result = await setup.save(staged ?? undefined);
    if (!result) return;
    onSaved(result.registry);
    if (startMinor === 0) { onOpenAsset(result.assetId); return; }
    try {
      onSaved(await recordStartingValue({ transport: getTransport(connection), budgetSyncId: connection.budgetSyncId, assetId: result.assetId, shared: accountMode === "shared", date: startDate || today, amountMinor: startMinor }));
      onOpenAsset(result.assetId);
    } catch (e) {
      setCreated({ assetId: result.assetId, message: `The asset was created, but its opening value was not recorded: ${e instanceof Error ? e.message : "the write failed"}. Open the asset to check the Asset Ledger, then use Add Entry if it is missing.` });
    }
  }
  return <>
    {setup.discard.discardDialog}
    <Sheet open onOpenChange={(open) => { if (!open) { if (created) onClose(); else setup.close(); } }}>
      <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:w-[min(calc(40rem+40px),95vw)] data-[side=right]:sm:max-w-none" side="right">
        <SheetHeader className="shrink-0 border-b p-4 pr-12">
          <div className="flex items-center gap-3"><AssetMark type={draft.assetType} header />
            <div className="min-w-0"><SheetTitle className="text-base">Add an asset</SheetTitle><SheetDescription>Track an asset using a linked Actual account.</SheetDescription></div></div>
        </SheetHeader>
        <form id="asset-create" noValidate className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <section className="grid gap-3.5"><h3 className="text-sm font-semibold">Asset details</h3>
            <FormField label="Name" htmlFor="asset-name" required error={errors.name} errorId="asset-name-error"><Input id="asset-name" autoFocus aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? "asset-name-error" : undefined} maxLength={200} placeholder="e.g. Family car" value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} /></FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Type" htmlFor="asset-type" help="Decides which kind of account holds the asset, and whether it is expected to earn income."><Select id="asset-type" disabled={!!pendingId} value={draft.assetType} onValueChange={changeType} options={Object.entries(ASSET_TYPES).map(([value, info]) => ({ value, label: info.label }))} /></FormField>
              <FormField label="Your ownership" htmlFor="asset-share" help="Leave at 100% unless you own only part of it. The account's value already reflects your share. You can record changes over time later in Settings." error={shareError} errorId="asset-share-error"><div className="flex items-center"><Input id="asset-share" className="rounded-r-none" type="number" min="0" max="100" step="0.01" aria-invalid={!!shareError} aria-describedby={shareError ? "asset-share-error" : undefined} value={share} onChange={(e) => changeShare(e.target.value)} /><span className="flex h-8 items-center rounded-r-md border border-l-0 bg-muted/40 px-3 text-xs text-muted-foreground">%</span></div></FormField>
            </div>
            <FormField label="Description (optional)" htmlFor="asset-description"><Textarea id="asset-description" className="min-h-16" rows={3} placeholder="Add a note about this asset" maxLength={2000} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></FormField>
            <ToggleRow id="asset-income" label="Generates income" hint="Show rent, dividend and interest income in this asset's performance figures." checked={draft.incomeGenerating ?? false} onChange={(checked) => { setup.setIncomeTouched(true); setDraft({ ...draft, incomeGenerating: checked }); }} />
          </section>
          <section className="grid gap-3.5 border-t pt-5"><div><h3 className="text-sm font-semibold">Linked Actual account</h3><p className="mt-0.5 text-xs text-muted-foreground">The account balance represents the asset&apos;s value.</p></div>
            <div role="group" aria-label="Account source" className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
              {([["new", "Create new account"], ["existing", "Use an existing account"]] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={accountPick === value} onClick={() => { if (value === "new") setDraft({ ...draft, actualAccountId: "" }); else setup.discardPending(); setAccountPick(value); setErrors((e) => ({ ...e, account: undefined })); }} className={cn("h-8 rounded-md px-3 text-xs transition-colors", accountPick === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}
            </div>
            {accountPick === "new" ? <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-4 py-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Landmark className="size-4" aria-hidden /></span>
                <div className="min-w-0 text-xs"><p className="text-sm font-medium">New off-budget account</p><p className="text-muted-foreground">Created in Actual using the asset name when you save this asset.</p></div></div>
              : <div className="grid gap-3"><FormField label={`Select off-budget account (${ASSET_TYPES[draft.assetType]?.label ?? "Asset"})`} htmlFor="asset-account-pick" required error={errors.account} errorId="asset-account-error">
                {accountOptions.length === 0 ? <p className="text-xs text-muted-foreground">No unused off-budget account suits a {ASSET_TYPES[draft.assetType]?.label.toLowerCase()}. Choose “Create new account”.</p>
                  : <SearchableCombobox allowNone={false} ariaLabel="Account" value={draft.actualAccountId} options={accountOptions} placeholder="Choose an account…" onChange={(value) => { setDraft({ ...draft, actualAccountId: value }); setErrors((e) => ({ ...e, account: undefined })); }} />}</FormField>
                {picked && <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><p>Off-budget · {ASSET_TYPES[draft.assetType]?.label}</p>{balance !== undefined && <p className="mt-0.5 flex items-baseline justify-between text-sm"><span>Book value</span><span className="font-medium text-foreground tabular-nums">{formatAmount(balance, 2)}</span></p>}</div>}</div>}
            <ToggleRow id="asset-shared" label="Shared with other assets" hint="Use when multiple assets share one account." checked={accountMode === "shared"} onChange={(on) => { setup.setAccountMode(on ? "shared" : "dedicated"); if (on && !hashtag) setup.setHashtag(hashtagFrom(draft.name)); }} />
            {accountMode === "shared" && <FormField label="Asset hashtag" htmlFor="asset-tag" required note="Permanent once saved. Add it to the Notes of this asset's entries in Actual." error={errors.hashtag} errorId="asset-tag-error">
              <div className="flex items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring"><span className="pl-2.5 text-sm text-muted-foreground select-none">#asset_</span><Input id="asset-tag" className="border-0 pl-0 shadow-none focus-visible:ring-0" placeholder="family_car" aria-required="true" aria-invalid={!!errors.hashtag} aria-describedby={errors.hashtag ? "asset-tag-error" : undefined} maxLength={93} value={hashtag.replace(/^#asset_/, "")} onChange={(e) => { setup.setHashtag(hashtagFrom(e.target.value)); setErrors((x) => ({ ...x, hashtag: undefined })); }} /></div></FormField>}
          </section>
          <section className="grid gap-3.5 border-t pt-5"><div><h3 className="flex items-center gap-2 text-sm font-semibold">Opening value <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">Optional</span></h3><p className="mt-0.5 text-xs text-muted-foreground">{picked && balance !== undefined && balance !== 0 ? <>This account already has a book value of <span className="font-medium text-foreground tabular-nums">{formatAmount(balance, 2)}</span>. Leave this blank unless you want to add another opening entry.</> : <>Adds an opening entry to the account in Actual. Leave blank if this account already includes the asset&apos;s value.</>}</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Value" htmlFor="asset-start-amount" error={startError} errorId="asset-start-error"><Input id="asset-start-amount" inputMode="decimal" placeholder="0.00" aria-invalid={!!startError} aria-describedby={startError ? "asset-start-error" : undefined} value={startAmount} onChange={(e) => { setStartAmount(e.target.value); setStartError(""); }} /></FormField>
              <FormField label="As of" htmlFor="asset-start-date"><DateInput id="asset-start-date" value={startDate} onValueChange={setStartDate} /></FormField>
            </div>
          </section>
          {(error || created) && <p role="alert" className="text-sm text-destructive">{created?.message ?? error}</p>}
        </form>
        <SheetFooter className="flex-row justify-end border-t px-6 py-4">
          {created ? <><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => onOpenAsset(created.assetId)}>Open asset</Button></>
            : <><Button variant="outline" disabled={busy} onClick={setup.close}>Cancel</Button><Button form="asset-create" type="submit" disabled={busy || !classes.available || createUncertain}>{busy ? "Saving…" : "Create asset"}</Button></>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </>;
}
