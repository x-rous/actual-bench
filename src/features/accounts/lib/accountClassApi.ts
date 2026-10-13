import type { AccountClassChange } from "@/lib/account-class";
import type { AccountClassRecord } from "@/lib/app-db/types";

/** Saves Bench metadata against permanent Actual ids; no Actual requests are made here. */
export async function saveAccountClasses(budgetSyncId: string, changes: AccountClassChange[]): Promise<AccountClassRecord[]> {
  const response = await fetch("/api/account-classes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetSyncId, changes }),
  });
  if (!response.ok) throw new Error("Could not save the account class");
  return ((await response.json()) as { accountClasses: AccountClassRecord[] }).accountClasses;
}
