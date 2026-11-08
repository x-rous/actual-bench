import type { AccountFlagChange } from "@/lib/account-class/flags";
import type { AccountFlagRecord } from "@/lib/app-db/types";

/** Saves Bench metadata against permanent Actual ids; no Actual requests are made here. */
export async function saveAccountFlags(budgetSyncId: string, changes: AccountFlagChange[]): Promise<AccountFlagRecord[]> {
  const response = await fetch("/api/account-flags", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetSyncId, changes }),
  });
  if (!response.ok) throw new Error("Could not save the account setting");
  return ((await response.json()) as { accountFlags: AccountFlagRecord[] }).accountFlags;
}
