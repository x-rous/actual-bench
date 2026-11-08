import { ASSET_CLASSES, CLASS_LABEL, CLASS_OF_POSITION, LIABILITY_CLASSES, type ClassKey } from "./breakdowns";
import { positionKey, type Ledger } from "./measures";
import { treatmentLabel } from "./wealth";

export type BalanceSheetRow = { id: string; name: string; groupId: string | null; groupName: string; reporting: string; closed: boolean; /** Balance in integer minor units; liabilities are shown as amounts owed. */ amountMinor: number };
/** One class of accounts, named and ordered as Summary's "What you own and owe" names and orders it, so each total matches it exactly. */
export type BalanceSheetGroup = { key: ClassKey; label: string; rows: BalanceSheetRow[]; /** Integer minor units. */ amountMinor: number };

/** Snapshot of included accounts at the period end, by account class. Amounts are integer minor units. */
export function buildBalanceSheet(ledger: Ledger, endMonth: string) {
  const groups = new Map<ClassKey, BalanceSheetGroup>([...ASSET_CLASSES, ...LIABILITY_CLASSES].map((key) => [key, { key, label: CLASS_LABEL[key], rows: [], amountMinor: 0 }]));
  for (const account of ledger.facts.accounts) {
    const key = CLASS_OF_POSITION[positionKey(account, ledger.role.get(account.id))];
    const balance = ledger.balanceAt(account.id, endMonth);
    const amountMinor = LIABILITY_CLASSES.includes(key) ? -balance : balance;
    const group = groups.get(key)!;
    group.rows.push({ id: account.id, name: account.name, groupId: account.groupId ?? null, groupName: account.groupId ? account.groupName ?? "Group unavailable" : "No Group", reporting: treatmentLabel(account), closed: !!account.closed, amountMinor });
    group.amountMinor += amountMinor;
  }
  const pick = (keys: readonly ClassKey[]) => keys.map((key) => groups.get(key)!).filter((group) => group.rows.length);
  const assets = pick(ASSET_CLASSES);
  const liabilities = pick(LIABILITY_CLASSES);
  const assetsMinor = assets.reduce((sum, group) => sum + group.amountMinor, 0);
  const liabilitiesMinor = liabilities.reduce((sum, group) => sum + group.amountMinor, 0);
  return { assets, liabilities, assetsMinor, liabilitiesMinor, netWorthMinor: assetsMinor - liabilitiesMinor };
}
