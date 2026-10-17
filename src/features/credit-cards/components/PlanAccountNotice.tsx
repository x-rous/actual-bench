import type { trackedCardDebt } from "../lib/planTracking";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { FieldInfo } from "./FieldInfo";

export function PlanAccountNotice({ tracking, showSharedBalance = true }: { tracking?: ReturnType<typeof trackedCardDebt>; showSharedBalance?: boolean }) {
  if (!tracking) return null;
  const entries = tracking.sharedAccounts.reduce((count, account) => count + account.unlinkedCurrentCount, 0);
  const needsBalanceCheck = tracking.sharedAccounts.some((account) => account.differenceMinor < 0);
  const label = !tracking.known ? "Plan balance unavailable" : tracking.problems.length || needsBalanceCheck ? "Check plan balances" : entries ? `${entries} plan ${entries === 1 ? "transaction needs" : "transactions need"} linking` : showSharedBalance && tracking.sharedAccounts.length ? "Other balance in shared plan account" : null;
  if (!label) return null;
  return <span className="mt-2 flex items-center text-xs text-muted-foreground">{label}<FieldInfo label="Plan account details">{tracking.problems.join(". ")}{tracking.sharedAccounts.map((account) => <span key={account.accountId} className="block">{account.differenceMinor >= 0 ? `${formatAmount(account.differenceMinor, 2)} in the shared account is outside the registered plan balances. This amount is excluded from this card’s total; it may belong to other cards or plans.` : "Registered plan balances exceed the shared account balance. Check remaining opening balances and transaction links."}</span>)}{entries > 0 && <span className="mt-1 block">Use Review plan entries on the card to link its transactions.</span>}</FieldInfo></span>;
}
