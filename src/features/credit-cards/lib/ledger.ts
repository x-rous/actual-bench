import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { Account } from "@/types/entities";
import { resolveAccountClass, type AccountClassMaps } from "@/lib/account-class";
import { cardBalance } from "./financialAdapter";

export type CardDirectory = { accounts: Account[]; balances: Map<string, ReturnType<typeof cardBalance>>; fetchedAt: string };
type DirectoryTransport = Pick<ActualBenchTransport, "getAccounts" | "getAccountBalances" | "getSyncCapabilities">;

export function eligibleCardAccount(account: Account, classes: AccountClassMaps) {
  return !account.offBudget && !account.closed && resolveAccountClass(account.id, account.groupId, classes).accountClass === "credit-card";
}

/** Batched directory read over either transport; no financial write method is reachable. */
export async function readCardDirectory(transport: DirectoryTransport): Promise<CardDirectory> {
  if (!transport.getSyncCapabilities().capabilities.listAccounts) throw new Error("This connection cannot read card accounts");
  const accounts = await transport.getAccounts();
  const raw = await transport.getAccountBalances();
  const balances = new Map<string, ReturnType<typeof cardBalance>>();
  for (const account of accounts) {
    const balance = raw.get(account.id);
    if (balance !== undefined) balances.set(account.id, cardBalance(balance));
  }
  return { accounts, balances, fetchedAt: new Date().toISOString() };
}
