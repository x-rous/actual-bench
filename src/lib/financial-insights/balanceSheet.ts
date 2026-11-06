import type { AccountFact, Ledger } from "./measures";
import { treatmentLabel } from "./wealth";

type GroupKey = "currentAssets" | "nonCurrentAssets" | "unspecifiedAssets" | "currentLiabilities" | "nonCurrentLiabilities" | "unspecifiedLiabilities";
export type BalanceSheetRow = { id: string; name: string; groupId: string | null; groupName: string; reporting: string; closed: boolean; /** Balance in integer minor units; liabilities are shown as amounts owed. */ amountMinor: number };
export type BalanceSheetGroup = { key: GroupKey; label: string; rows: BalanceSheetRow[]; /** Integer minor units. */ amountMinor: number };

function groupFor(account: AccountFact): GroupKey {
  switch (account.accountClass) {
    case "cash": return "currentAssets";
    case "bank": return account.treatment === "fixed-deposit" ? "nonCurrentAssets" : "currentAssets";
    case "investment": return account.treatment === "current-investment" ? "currentAssets" : account.treatment === "non-current-investment" ? "nonCurrentAssets" : "unspecifiedAssets";
    case "other-asset": return account.treatment === "current-asset" ? "currentAssets" : account.treatment === "non-current-asset" || account.treatment === "fixed-asset" ? "nonCurrentAssets" : "unspecifiedAssets";
    case "property": case "vehicle": case "retirement": return "nonCurrentAssets";
    case "credit-card": return "currentLiabilities";
    case "loan": return "nonCurrentLiabilities";
    case "other-liability": return account.treatment === "current-liability" ? "currentLiabilities" : account.treatment === "non-current-liability" ? "nonCurrentLiabilities" : "unspecifiedLiabilities";
  }
}

/** Snapshot of included accounts at the period end. Amounts are integer minor units. */
export function buildBalanceSheet(ledger: Ledger, endMonth: string) {
  const labels: Record<GroupKey, string> = { currentAssets: "Current assets", nonCurrentAssets: "Non-current assets", unspecifiedAssets: "Assets: maturity not specified", currentLiabilities: "Current liabilities", nonCurrentLiabilities: "Non-current liabilities", unspecifiedLiabilities: "Liabilities: maturity not specified" };
  const group = (key: GroupKey): BalanceSheetGroup => ({ key, label: labels[key], rows: [], amountMinor: 0 });
  const groups: Record<GroupKey, BalanceSheetGroup> = { currentAssets: group("currentAssets"), nonCurrentAssets: group("nonCurrentAssets"), unspecifiedAssets: group("unspecifiedAssets"), currentLiabilities: group("currentLiabilities"), nonCurrentLiabilities: group("nonCurrentLiabilities"), unspecifiedLiabilities: group("unspecifiedLiabilities") };
  for (const account of ledger.facts.accounts) {
    const key = groupFor(account);
    const balance = ledger.balanceAt(account.id, endMonth);
    const amountMinor = key.endsWith("Liabilities") ? -balance : balance;
    groups[key].rows.push({ id: account.id, name: account.name, groupId: account.groupId ?? null, groupName: account.groupId ? account.groupName ?? "Group unavailable" : "No Group", reporting: treatmentLabel(account), closed: !!account.closed, amountMinor });
    groups[key].amountMinor += amountMinor;
  }
  const assets = [groups.currentAssets, groups.nonCurrentAssets, groups.unspecifiedAssets].filter((group) => group.rows.length);
  const liabilities = [groups.currentLiabilities, groups.nonCurrentLiabilities, groups.unspecifiedLiabilities].filter((group) => group.rows.length);
  const assetsMinor = assets.reduce((sum, group) => sum + group.amountMinor, 0);
  const liabilitiesMinor = liabilities.reduce((sum, group) => sum + group.amountMinor, 0);
  return { assets, liabilities, assetsMinor, liabilitiesMinor, netWorthMinor: assetsMinor - liabilitiesMinor };
}
