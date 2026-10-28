"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ConditionsEditor, newCondition } from "@/components/transactions/ConditionsEditor";
import { useTransactionReference } from "@/components/transactions/useTransactionReference";
import { getTransport } from "@/lib/actual";
import { describeRule, ruleMatches, type RuleCondition } from "@/lib/transactions/conditions";
import { paymentRuleInputSchema, type DebtPaymentRule } from "@/lib/app-db/debtTrackingRepository";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { formatAmount } from "../../lib/money";
import { savePaymentRule } from "../../lib/trackingApi";
import { ruleAccounts } from "../../lib/trackingReads";

/**
 * A loan's payment rules (design spec 06 §7.5): the shared conditions editor, with the payments a rule finds listed under
 * it. Transfers into the loan account need no rule. Saving a rule changes nothing in Actual.
 */

type Draft = { id?: string; name: string; match: "all" | "any"; conditions: RuleCondition[] };
const blank = (): Draft => ({ name: "Repayments", match: "all", conditions: [newCondition()] });
const dt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function Preview({ draft, loanAccountId, from, today }: { draft: Draft; loanAccountId: string; from: string; today: string }) {
  const connection = useConnectionStore(selectActiveInstance);
  const ref = useTransactionReference({ excludeAccountIds: [loanAccountId] });
  const valid = paymentRuleInputSchema.safeParse({ name: draft.name || "x", match: draft.match, conditions: draft.conditions }).success;
  const key = JSON.stringify([draft.match, draft.conditions]);
  const matches = useQuery({
    queryKey: ["assets-debt", "rule-preview", connection?.id, loanAccountId, from, key],
    enabled: !!connection && valid,
    staleTime: 60_000,
    queryFn: async () => {
      const t = getTransport(connection!);
      const accounts = await t.getAccounts();
      const ids = ruleAccounts([draft], accounts.filter((a) => !a.closed && !a.offBudget).map((a) => a.id), loanAccountId);
      const ranges = ids.map((accountId) => ({ accountId, from, to: today }));
      const rows = !ranges.length ? [] : t.queryTransactionsForSync ? await t.queryTransactionsForSync({ ranges }) : (await Promise.all(ids.map((accountId) => t.listTransactionsForSync({ accountId, startDate: from, endDate: today })))).flat();
      return rows.filter((r) => r.amount < 0 && !r.transferId && !r.isChild && !r.isParent && ruleMatches(draft, { accountId: r.accountId, payeeId: r.payeeId, payeeName: r.payeeName, categoryId: r.categoryId, categoryName: r.categoryName, notes: r.notes, amountMinor: r.amount }))
        .sort((a, b) => b.date.localeCompare(a.date));
    },
  });
  if (!valid) return <p className="text-xs text-muted-foreground">Complete the conditions to see the payments this rule finds.</p>;
  if (matches.isLoading) return <p className="text-xs text-muted-foreground">Looking for matching payments…</p>;
  if (matches.isError) return <p className="text-xs text-destructive">The payments could not be read: {matches.error instanceof Error ? matches.error.message : "error"}</p>;
  const rows = matches.data ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium">{rows.length === 0 ? `Finds no payments since ${dt(from)}.` : `Finds ${rows.length} payment${rows.length === 1 ? "" : "s"} since ${dt(from)}.`}{rows.length > 60 ? " That is a lot for one loan: add a condition (a payee) so it finds only repayments." : ""}</p>
      {rows.length ? (
        <div className="max-h-56 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-muted-foreground"><tr><th className="px-2 py-1.5 text-left font-medium">Date</th><th className="px-2 py-1.5 text-left font-medium">Account</th><th className="px-2 py-1.5 text-left font-medium">Payee</th><th className="px-2 py-1.5 text-left font-medium">Category</th><th className="px-2 py-1.5 text-right font-medium">Amount</th></tr></thead>
            <tbody>{rows.slice(0, 200).map((r) => <tr key={r.id} className="border-t"><td className="px-2 py-1.5 whitespace-nowrap">{dt(r.date)}</td><td className="truncate px-2 py-1.5">{ref.names.account(r.accountId)}</td><td className="truncate px-2 py-1.5">{r.payeeName ?? "-"}</td><td className="truncate px-2 py-1.5">{r.categoryName ?? "-"}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(r.amount, 2)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function PaymentRulesDialog({ debtId, loanName, loanAccountId, rules, from, today, onSaved, onClose }: {
  debtId: string; loanName: string; loanAccountId: string; rules: DebtPaymentRule[];
  /** Payments from this date on are what the rule is for (the tracking window). */ from: string; today: string;
  onSaved: () => Promise<void> | void; onClose: () => void;
}) {
  const ref = useTransactionReference({ excludeAccountIds: [loanAccountId] });
  const [draft, setDraft] = useState<Draft | null>(rules.length ? null : blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(operation: Parameters<typeof savePaymentRule>[1]) {
    setBusy(true); setError("");
    try { await savePaymentRule(debtId, operation); await onSaved(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the rule"); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    const parsed = paymentRuleInputSchema.safeParse({ ...(draft.id ? { id: draft.id } : {}), name: draft.name, match: draft.match, conditions: draft.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, ...(c.operator === "between" ? { value2: c.value2 ?? "" } : {}) })) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (await send({ kind: "save", rule: parsed.data })) setDraft(null);
  }
  const description = `${loanName} · transfers into the loan account are found automatically. A rule finds repayments recorded as an expense in a bank account. Saving changes nothing in Actual.`;
  if (draft) return (
    <Dialog open onOpenChange={(open) => { if (open || busy) return; if (rules.length) setDraft(null); else onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>{draft.id ? "Edit payment rule" : "New payment rule"}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="grid gap-4">
          <FormField label="Rule name" htmlFor="payment-rule-name" required><Input id="payment-rule-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Mortgage payments" /></FormField>
          <ConditionsEditor value={{ match: draft.match, conditions: draft.conditions }} onChange={(next) => setDraft({ ...draft, ...next })} excludeAccountIds={[loanAccountId]} />
        </fieldset>
        <Preview draft={draft} loanAccountId={loanAccountId} from={from} today={today} />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setError(""); if (rules.length) setDraft(null); else onClose(); }}>{rules.length ? "Back" : "Cancel"}</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save rule"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Payment rules</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <ul aria-label="Saved payment rules" className="max-h-80 divide-y overflow-auto rounded-md border text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-muted-foreground" title={describeRule(r, ref.names)}>{describeRule(r, ref.names)}</p></div>
              <Button size="icon-xs" variant="ghost" aria-label={`Edit rule ${r.name}`} onClick={() => setDraft({ id: r.id, name: r.name, match: r.match, conditions: r.conditions })}><Pencil className="size-3.5" /></Button>
              <Button size="icon-xs" variant="ghost" aria-label={`Delete rule ${r.name}`} disabled={busy} onClick={() => void send({ kind: "delete", id: r.id })}><Trash2 className="size-3.5" /></Button>
            </li>
          ))}
        </ul>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={rules.length >= 10} onClick={() => { setError(""); setDraft(blank()); }}><Plus className="size-3.5" aria-hidden />New rule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
