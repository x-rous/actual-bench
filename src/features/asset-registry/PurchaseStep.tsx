"use client";
import { useQuery } from "@tanstack/react-query";
import { TransactionPickerPanel } from "@/components/transactions/TransactionPickerPanel";
import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";
import { ChoiceCards } from "@/components/ui/choice-cards";
import { DateInput } from "@/components/ui/date-input";
import { AccountPicker, CategoryPicker } from "@/components/ui/entity-picker";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { getTransport } from "@/lib/actual";
import type { Registry } from "@/lib/asset-registry/models";
import type { ConnectionInstance } from "@/store/connection";
import type { Account } from "@/types/entities";
import { assetMoney } from "./AssetPresentation";
import { pickReason, type PurchaseDraft, type PurchasePlan } from "./wizardPlan";

const pick = (r: PickedTransaction) => `${r.payeeName ?? "No payee"} · ${r.date} · ${assetMoney(r.amountMinor)}`;

/**
 * "How did you get it?": the transaction already exists and you pick it, or you enter a value, or you record a payment that
 * is not in Actual yet. A picked transaction decides what happens: one in the asset's own account becomes its starting value
 * (or its purchase, if it is a transfer); an expense in another account has its value added to the asset. Optional.
 */
export function PurchaseStep({ allowSkip = true, connection, draft, plan, onChange, accountId, accounts, registry, today }: {
  /** Offer "I'll do this later" (not when recording for an asset that already exists). */ allowSkip?: boolean;
  connection: ConnectionInstance; draft: PurchaseDraft; plan: PurchasePlan | null; onChange: (patch: Partial<PurchaseDraft>) => void;
  /** The saved account chosen for the asset, or "" while it is a new account that does not exist yet. */ accountId: string;
  accounts: Account[]; registry: Registry; today: string;
}) {
  const categories = useQuery({ queryKey: ["wizardCategories", connection.id], queryFn: async () => (await getTransport(connection).getCategoryGroups()).categories });
  const assetAccounts = new Set(registry.assets.map((a) => a.actualAccountId));
  const payFrom = accounts.filter((a) => !a.closed && !assetAccounts.has(a.id) && a.id !== accountId);
  const used = new Set([...(registry.cashflows ?? []), ...registry.metadata].map((m) => m.actualTransactionId));
  const outcome = plan?.kind === "expense" ? "This is an expense in your budget. Bench adds its value to the asset; the expense and its category stay exactly as they are."
    : plan?.kind === "transfer" ? "This is a transfer into the asset's account. Bench marks it as the purchase."
    : plan?.kind === "opening-existing" ? "This is already in the asset's account. Bench marks it as the starting value." : null;
  return <div className="grid gap-5">
    <ChoiceCards legend="How did you get this asset?" hideLegend columns={allowSkip ? 4 : 3} name="asset-path" value={draft.path} onChange={(path) => onChange({ path, pick: null })} options={[
      { value: "existing", title: "Pick a transaction I already have", detail: "The purchase, transfer or opening balance is already in Actual." },
      { value: "manual", title: "Enter a value", detail: "Creates one entry in the asset's off-budget account for what it is worth. It doesn't touch your budget. The only choice if you bought it before you started tracking in Actual." },
      { value: "new", title: "Record a purchase", detail: "Use this only if the payment isn't in Actual yet. Bench creates one transfer from the account you paid with." },
      ...(allowSkip ? [{ value: "skip" as const, title: "I'll do this later", detail: "Nothing is recorded now. You can record how you got it from the asset's page." }] : []),
    ]} />
    {draft.path === "existing" && <div className="grid gap-1.5">
      <p className="text-xs text-muted-foreground">Pick one transaction from any account: the transfer or opening balance in the asset&apos;s own account, or the expense you paid from another account.</p>
      <div className="grid gap-2">
        <div className="flex h-80 min-h-0 flex-col rounded-lg border p-2"><TransactionPickerPanel today={today} multiple={false} filters={["dates", "accounts", "payees", "search"]} columns={["date", "account", "payee", "category", "notes", "amount"]}
          disabledReason={(r) => pickReason(r, accountId, used)} onSelectionChange={(rows) => onChange({ pick: rows[0] ?? null })} /></div>
        <p role="status" className="text-xs text-muted-foreground">{draft.pick ? <><span className="font-medium text-foreground">{pick(draft.pick)}</span>. {outcome}</> : "Select one transaction in the list."}</p>
      </div>
    </div>}
    {draft.path === "manual" && <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Value" htmlFor="opening-amount" required help="What the asset is worth on that date."><Input id="opening-amount" inputMode="decimal" placeholder="0.00" value={draft.amount} onChange={(e) => onChange({ amount: e.target.value })} /></FormField>
      <FormField label="As of" htmlFor="opening-date" help="The date the value applies from."><DateInput id="opening-date" value={draft.date || today} onValueChange={(date) => onChange({ date })} /></FormField>
      <FormField className="sm:col-span-2" label="Notes" htmlFor="opening-notes" help="Stored on the new transaction in Actual. The type tag is added for you."><Input id="opening-notes" placeholder="Starting value" value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} /></FormField>
    </div>}
    {draft.path === "new" && <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Paid from" help="The account the money left. Bench creates one transfer from it into the asset's account." required><AccountPicker ariaLabel="Account you paid from" value={draft.fromAccountId} onChange={(fromAccountId) => onChange({ fromAccountId })} accounts={payFrom} /></FormField>
      <FormField label="Category" help="The budget category recorded on your side of the payment." required><CategoryPicker ariaLabel="Payment category" value={draft.categoryId} onChange={(categoryId) => onChange({ categoryId })} categories={(categories.data ?? []).filter((c) => !c.isIncome)} /></FormField>
      <FormField label="Amount paid" htmlFor="purchase-amount" required><Input id="purchase-amount" inputMode="decimal" placeholder="0.00" value={draft.amount} onChange={(e) => onChange({ amount: e.target.value })} /></FormField>
      <FormField label="Date" htmlFor="purchase-date" help="When the payment was made."><DateInput id="purchase-date" value={draft.date || today} onValueChange={(date) => onChange({ date })} /></FormField>
    </div>}
  </div>;
}
