import type { AccountReportingChange } from "@/lib/app-db/accountReportingRepository";
import type { AccountReportingRecord } from "@/lib/app-db/types";

/** Saves Bench metadata against permanent Actual ids; no Actual requests are made here. */
export async function saveAccountReporting(budgetSyncId: string, changes: AccountReportingChange[]): Promise<AccountReportingRecord[]> {
  const response = await fetch("/api/account-reporting", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetSyncId, changes }),
  });
  if (!response.ok) throw new Error("Could not save the Financial Reporting choice");
  return ((await response.json()) as { accountReporting: AccountReportingRecord[] }).accountReporting;
}
