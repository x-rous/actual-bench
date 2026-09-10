import { parseCsvLine, parseBoolean } from "@/lib/csv";
import type { Account } from "@/types/entities";

export type AccountsImportResult = {
  accounts: Omit<Account, "id">[];
  skipped: number;
};

export type AccountsImportError = { error: string };

/**
 * Parses a CSV string into a list of accounts to create.
 * Pure function — does not touch the store. Caller is responsible for staging.
 *
 * Required column: name
 * Optional columns: offBudget, closed
 */
export function importAccountsFromCsv(
  text: string
): AccountsImportResult | AccountsImportError {
  const allLines = text.split(/\r?\n/);
  const nonEmpty = allLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return { error: "CSV has no data rows." };

  const headers = parseCsvLine(nonEmpty[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) return { error: 'CSV must have a "name" column.' };

  const budgetIdx = headers.indexOf("offbudget");
  const closedIdx = headers.indexOf("closed");

  const accounts: Omit<Account, "id">[] = [];
  let skipped = 0;

  for (let i = 1; i < nonEmpty.length; i++) {
    const fields = parseCsvLine(nonEmpty[i]);
    const name = fields[nameIdx]?.trim() ?? "";
    if (!name) { skipped++; continue; }

    accounts.push({
      name,
      offBudget: budgetIdx !== -1 ? parseBoolean(fields[budgetIdx] ?? "") : false,
      closed: closedIdx !== -1 ? parseBoolean(fields[closedIdx] ?? "") : false,
    });
  }

  return { accounts, skipped };
}
