"use client";
import { useState } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { SearchableCombobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PillGroup } from "@/components/ui/pill-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AccountFormValues } from "@/features/accounts/schemas/account.schema";
import { StatusBadge } from "@/features/credit-cards/components/primitives/StatusBadge";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { UncertainAssetWrite } from "@/lib/asset-registry/actions";
import { ASSET_TYPES, defaultIncomeGenerating, type Asset, type AssetType, type Registry } from "@/lib/asset-registry/models";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import type { Account } from "@/types/entities";
import { cn } from "@/lib/utils";
import { OWNERSHIP_FROM_START } from "./OwnershipTable";
import { PurchaseStep } from "./PurchaseStep";
import { buildPlan, describePlan, emptyPurchase, planProblem, planValueDelta, planWritesToActual, type PurchasePlan } from "./wizardPlan";
import { startPurchase } from "./wizardRun";
import { useAssetSetup } from "./useAssetSetup";

const STEPS = ["The asset", "How you got it", "Review"] as const;
const HEADINGS = ["Tell us about the asset", "How did you get it?", "Review and create"];
const DESCRIPTIONS = [
  "A name, a type and the off-budget account that holds its value. You can change most of this later in Settings.",
  "Optional. This sets the asset's starting value. Skip it and do it later from the asset's page.",
  "Nothing has been created yet. Check what will happen, then create the asset.",
];
type Stage = { id: "asset" | "purchase"; label: string; state: "pending" | "running" | "done" | "failed"; message?: string };

/**
 * The guided way to add an asset: the asset and its account, how it was obtained, and a review. Everything happens in this
 * dialog. A new account is derived from the asset (its name, off budget, the class its type needs), so there is no account
 * form. The asset (and a new account) are created first, then the chosen purchase is recorded with the same safeguards as the
 * standalone actions; if a later step fails, what already succeeded is kept and said so.
 */
export function AssetWizard({ connection, accounts, registry, today, asset, onSaved, onOpenAsset, onClose }: {
  connection: ConnectionInstance; accounts: Account[]; registry: Registry; today: string;
  /** An existing asset: the wizard then only records how it was obtained (it starts at that step and creates nothing else). */ asset?: Asset;
  onSaved: (registry: Registry) => void; onOpenAsset: (assetId: string) => void; onClose: () => void;
}) {
  const existing = !!asset;
  const setup = useAssetSetup({ connection, asset, accounts, registry, onDiscard: onClose, ownershipFrom: OWNERSHIP_FROM_START });
  const { draft, setDraft, errors, setErrors, error, busy, classes, createUncertain, pendingId, staged, hiddenAccounts, accountOptions, accountMode, hashtag, discard } = setup;
  const [step, setStep] = useState(existing ? 1 : 0);
  const labels = existing ? STEPS.slice(1) : STEPS; const shown = existing ? step - 1 : step;
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");
  const [share, setShare] = useState("100"); const [shareError, setShareError] = useState("");
  const [accountPick, setAccountPick] = useState<"new" | "existing">("new");
  const [purchase, setPurchase] = useState(emptyPurchase());
  const [stages, setStages] = useState<Stage[]>([]); const [locked, setLocked] = useState(false);
  const [saved, setSaved] = useState<{ registry: Registry; assetId: string } | null>(null);
  const [commit, setCommit] = useState<null | (() => Promise<Registry>)>(null);
  const pending = pendingId ? staged[pendingId] : undefined;
  const accountClass = ASSET_TYPES[draft.assetType]?.accountClass;
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "";
  const plan: PurchasePlan | null = buildPlan({ ...purchase, date: purchase.date || today }, draft.actualAccountId, accountName);
  const problem = plan ? planProblem(plan) : "Choose one of the options above.";
  const sharePercent = `${share}%`;
  const changeShare = (text: string) => {
    setShare(text); const n = Number(text); const ok = text.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 100;
    setShareError(ok ? "" : "Enter a share between 0.01 and 100.");
    if (ok) setDraft((d) => ({ ...d, ownership: [{ effectiveFrom: OWNERSHIP_FROM_START, ownershipBps: Math.round(n * 100) }] }));
  };
  const changeType = (value: string) => { setAccountPick("new"); setDraft({ ...draft, assetType: value as AssetType, actualAccountId: "", ...(setup.incomeTouched ? {} : { incomeGenerating: defaultIncomeGenerating(value) }) }); };

  function next() {
    if (step === 0) {
      if (!draft.name.trim()) { setErrors({ name: "Enter a name for this asset." }); document.getElementById("wizard-name")?.focus(); return; }
      if (shareError) { document.getElementById("wizard-share")?.focus(); return; }
      if (!setup.validate(accountPick === "new")) return;
      // A new account is derived from the asset: its name, off budget, and the class its type needs. No balance: the value is recorded as a transaction.
      if (accountPick === "new") setup.stageAccount({ name: draft.name.trim(), offBudget: true, accountClass } as AccountFormValues);
    }
    setStep(step + 1);
  }
  async function create() {
    setPhase("running");
    const planned = plan!;
    setStages([...(existing ? [] : [{ id: "asset" as const, label: pendingId ? "Create the account and the asset" : "Create the asset", state: saved ? "done" as const : "pending" as const }]), ...(planned.kind === "skip" ? [] : [{ id: "purchase" as const, label: "Record how you got it", state: "pending" as const }])]);
    const mark = (id: Stage["id"], state: Stage["state"], message?: string) => setStages((all) => all.map((s) => s.id === id ? { ...s, state, message } : s));
    let result = saved ?? (asset ? { registry, assetId: asset.id } : null);
    if (!result) {
      mark("asset", "running");
      result = await setup.save();
      if (!result) { mark("asset", "failed", setup.error || "The asset could not be saved."); return; }
      setSaved(result); mark("asset", "done"); onSaved(result.registry);
    }
    // Everything went through: no confirmation page, go straight to the asset.
    if (planned.kind === "skip") { onOpenAsset(result.assetId); return; }
    mark("purchase", "running");
    try {
      let pendingCommit = commit;
      if (!pendingCommit) {
        const started = await startPurchase(planned, { transport: getTransport(connection), assetId: result.assetId, budgetSyncId: connection.budgetSyncId, shared: accountMode === "shared" });
        pendingCommit = started?.commit ?? null; setCommit(() => pendingCommit);
      }
      const registryAfter = pendingCommit ? await pendingCommit() : result.registry;
      onSaved(registryAfter); mark("purchase", "done"); onOpenAsset(result.assetId);
    } catch (e) {
      if (e instanceof UncertainAssetWrite) setLocked(true);
      mark("purchase", "failed", e instanceof Error ? e.message : "Could not record it.");
    }
  }
  const allDone = stages.length > 0 && stages.every((s) => s.state === "done");
  const failed = stages.some((s) => s.state === "failed");
  const running = phase === "running" && stages.some((s) => s.state === "running");

  const reviewRows = [
    ...(existing ? [] : accountPick === "new" ? [{ text: `Create the Actual account “${pending?.entity.name ?? draft.name.trim()}” (off budget)`, where: "Actual" as const }] : []),
    ...(existing ? [] : [{ text: `Create the asset “${draft.name.trim()}” (${ASSET_TYPES[draft.assetType]?.label ?? draft.assetType}), you own ${sharePercent}`, where: "Bench" as const }]),
    ...(plan && plan.kind !== "skip" ? [{ text: describePlan(plan), where: planWritesToActual(plan) ? "Actual" as const : "Bench" as const }] : []),
  ];
  const delta = plan ? planValueDelta(plan) : 0;

  return <>
    {discard.discardDialog}
    <Dialog open onOpenChange={(open) => { if (!open && !running) { if (phase === "form") setup.close(); else onClose(); } }}>
      <DialogContent className="flex h-[min(50rem,94dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 gap-3 border-b px-6 pt-5 pb-4">
          <div><DialogTitle>{existing ? `Record how you got ${asset!.name}` : phase === "done" ? "Asset created" : "Add an asset"}</DialogTitle><DialogDescription className="text-xs">{phase === "done" ? "Here is what was done." : DESCRIPTIONS[step]}</DialogDescription></div>
          {phase === "form" && <ol aria-label="Steps" className="flex items-center gap-2 text-xs">{labels.map((label, index) => <li key={label} aria-current={index === shown ? "step" : undefined} className="flex items-center gap-2">
            <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold", index < shown ? "border-foreground bg-foreground text-background" : index === shown ? "border-foreground" : "text-muted-foreground")}>{index < shown ? <Check className="size-3" aria-hidden /> : index + 1}</span>
            <span className={index === shown ? "font-medium" : "text-muted-foreground"}>{label}</span>{index < labels.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}</li>)}</ol>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {phase === "form" && <h3 className="mb-4 text-sm font-semibold">{HEADINGS[step]}</h3>}
          {phase === "form" && step === 0 && <div className="grid gap-6">
            <fieldset className="grid gap-4 rounded-xl border px-5 pt-3 pb-5"><legend className="-ml-1 px-2 text-xs font-semibold">About the asset</legend>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
                <FormField label="Name" htmlFor="wizard-name" required error={errors.name} errorId="wizard-name-error"><Input id="wizard-name" autoFocus aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? "wizard-name-error" : undefined} maxLength={200} placeholder="Family car, Rental flat…" value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} /></FormField>
                <FormField label="Type" htmlFor="wizard-type" help="Decides which kind of account holds the asset, and whether it is expected to earn income."><Select id="wizard-type" disabled={!!pendingId} value={draft.assetType} onValueChange={changeType} options={Object.entries(ASSET_TYPES).map(([value, info]) => ({ value, label: info.label }))} /></FormField>
                <FormField label="Your ownership" htmlFor="wizard-share" help="Leave at 100% unless you own only part of it. The account's value already reflects your share. You can record changes over time later in Settings." error={shareError} errorId="wizard-share-error"><div className="flex items-center gap-1.5"><Input id="wizard-share" type="number" min="0" max="100" step="0.01" aria-invalid={!!shareError} aria-describedby={shareError ? "wizard-share-error" : undefined} value={share} onChange={(e) => changeShare(e.target.value)} /><span className="text-xs text-muted-foreground">%</span></div></FormField>
                <FormField className="sm:col-span-3" label="Description (optional)" htmlFor="wizard-description"><Textarea id="wizard-description" className="min-h-16" maxLength={2000} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></FormField>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2"><Switch id="wizard-income" aria-labelledby="wizard-income-label" checked={draft.incomeGenerating ?? false} onCheckedChange={(checked) => { setup.setIncomeTouched(true); setDraft({ ...draft, incomeGenerating: checked }); }} />
                  <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Label id="wizard-income-label" htmlFor="wizard-income" className="text-xs leading-4">Generates income</Label><InfoHint label="Generates income">Turn on if it pays you money, like rent from a tenant, dividends or interest. Leave it off for something you just own, like a car or jewellery: the Overview then hides income figures.</InfoHint></div></div>
              </div>
            </fieldset>
            <fieldset className="grid gap-4 rounded-xl border px-5 pt-3 pb-5"><legend className="-ml-1 px-2 text-xs font-semibold">Its account in Actual</legend>
              <div className="grid gap-2"><div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><span>Which account?</span><InfoHint label="its account">Every asset has its own off-budget account. The transactions in it set the asset&apos;s value.</InfoHint></div>
                <PillGroup<"new" | "existing"> value={accountPick} onChange={(value) => { if (value === "new") setDraft({ ...draft, actualAccountId: "" }); else setup.discardPending(); setAccountPick(value); setErrors((e) => ({ ...e, account: undefined })); }}
                  options={[{ value: "new", label: "Create a new account" }, { value: "existing", label: "Use an existing account" }]} /></div>
              {accountPick === "new" ? <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">A new off-budget account named “{draft.name.trim() || "the asset's name"}” is created in Actual when you finish{accountClass ? ` (account class: ${ASSET_TYPES[draft.assetType]?.label})` : ""}. Nothing else to fill in.</p>
                : <FormField label="Account" htmlFor="wizard-account-pick" required error={errors.account} errorId="wizard-account-error" note={hiddenAccounts > 0 ? `${hiddenAccounts} other ${hiddenAccounts === 1 ? "account isn't" : "accounts aren't"} listed: on-budget, closed, a different account class, or already used by an asset.` : undefined}>
                  {accountOptions.length === 0 ? <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">No off-budget account fits a {ASSET_TYPES[draft.assetType]?.label.toLowerCase()} yet. Choose “Create a new account”.</p>
                    : <SearchableCombobox allowNone={false} ariaLabel="Account" value={draft.actualAccountId} options={accountOptions} placeholder="Choose an account…" onChange={(value) => { setDraft({ ...draft, actualAccountId: value }); setErrors((e) => ({ ...e, account: undefined })); }} />}</FormField>}
              <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><Label htmlFor="wizard-shared" className="text-xs leading-4 font-medium">This account holds more than one asset <span className="font-normal text-muted-foreground">(advanced)</span></Label>
                <div className="flex items-center gap-2"><InfoHint label="shared accounts">Each asset&apos;s transactions are told apart by a hashtag in their Notes. Most assets don&apos;t need this.</InfoHint><Switch id="wizard-shared" checked={accountMode === "shared"} onCheckedChange={(on) => setup.setAccountMode(on ? "shared" : "dedicated")} /></div></div>
                {accountMode === "shared" && <FormField label="Asset hashtag" htmlFor="asset-tag" required help="A unique identifier for this asset in the shared account. It stays fixed after saving." error={errors.hashtag} errorId="asset-tag-error"><Input id="asset-tag" placeholder="#asset_family_car" aria-required="true" aria-invalid={!!errors.hashtag} aria-describedby={errors.hashtag ? "asset-tag-error" : undefined} maxLength={100} value={hashtag} onChange={(e) => { setup.setHashtag(e.target.value); setErrors((x) => ({ ...x, hashtag: undefined })); }} /></FormField>}</div>
            </fieldset>
          </div>}
          {phase === "form" && step === 1 && <PurchaseStep allowSkip={!existing} connection={connection} draft={purchase} plan={plan} onChange={(patch) => setPurchase((p) => ({ ...p, ...patch }))} accountId={draft.actualAccountId} accounts={accounts} registry={registry} today={today} />}
          {phase === "form" && step === 2 && <div className="grid gap-4">
            <ul aria-label="What will happen" className="divide-y rounded-lg border">{reviewRows.map((row) => <li key={row.text} className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs"><span>{row.text}</span><StatusBadge label={row.where === "Actual" ? "Writes to Actual" : "Bench only"} tone={row.where === "Actual" ? "attention" : "neutral"} /></li>)}</ul>
            {plan && plan.kind !== "skip" && <p className="text-xs text-muted-foreground">{delta !== 0 ? <>The asset&apos;s recorded value will change by <span className="font-medium tabular-nums text-foreground">{formatAmount(delta, 2)}</span>.</> : "The asset's recorded value does not change; Bench only classifies what is already there."}</p>}
            {plan?.kind === "skip" && <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs">You&apos;ll see a short list of next steps on the asset&apos;s page, including how to record how you got it.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>}
          {phase !== "form" && <div className="grid gap-4">
            <ul aria-label="Progress" className="divide-y rounded-lg border">{stages.map((stage) => <li key={stage.id} className="flex items-start gap-3 px-3 py-2.5 text-xs">
              <span className="mt-0.5">{stage.state === "done" ? <Check className="size-4 text-green-600" aria-hidden /> : stage.state === "failed" ? <CircleAlert className="size-4 text-destructive" aria-hidden /> : stage.state === "running" ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : <span className="block size-4 rounded-full border" aria-hidden />}</span>
              <div><p className="font-medium">{stage.label}</p>{stage.message && <p role={stage.state === "failed" ? "alert" : undefined} className={stage.state === "failed" ? "mt-0.5 text-destructive" : "mt-0.5 text-muted-foreground"}>{stage.message}</p>}</div></li>)}</ul>
            {failed && stages.find((s) => s.id === "asset")?.state === "done" && <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs">The asset exists. {locked ? "Open the asset and check Actual before trying again; it won't repeat the write." : "You can try again, or open the asset and finish from there. Nothing that already succeeded is repeated."}</p>}
            {allDone && <p className="text-xs text-muted-foreground">Open the asset to see its value over time. A short list of next steps will guide you.</p>}
          </div>}
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 items-center border-t px-6 py-3 sm:justify-between">
          {phase === "form" ? <>
            <Button variant="ghost" disabled={step === (existing ? 1 : 0) || busy} onClick={() => setStep(step - 1)}>Back</Button>
            <div className="flex items-center gap-2"><Button variant="outline" disabled={busy} onClick={setup.close}>Cancel</Button>
              {step < 2 ? <Button onClick={next} disabled={step === 1 && (!plan || !!problem)}>{step === 1 && plan?.kind === "skip" ? "Skip and review" : "Next"}</Button>
                : <Button disabled={busy || !classes.available || createUncertain || !plan} onClick={() => void create()}>{busy ? "Working…" : existing ? "Record it" : "Create asset"}</Button>}</div></> : <>
            <div>{failed && !locked && <Button variant="outline" disabled={running} onClick={() => void create()}>Try again</Button>}</div>
            <div className="flex items-center gap-2"><Button variant="outline" disabled={running} onClick={onClose}>Close</Button>{saved && <Button disabled={running} onClick={() => onOpenAsset(saved.assetId)}>Open asset</Button>}</div></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
