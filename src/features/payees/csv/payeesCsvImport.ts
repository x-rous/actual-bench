import { parseCsvLine } from "@/lib/csv";
import type { Payee } from "@/types/entities";

export type PayeesImportResult = {
  payees: Pick<Payee, "name">[];
  skipped: number;
};

export type PayeesImportError = { error: string };

/**
 * Parses a CSV string into a list of payees to create.
 * Pure function — does not touch the store. Caller is responsible for staging.
 *
 * Required column: name
 */
export function importPayeesFromCsv(text: string): PayeesImportResult | PayeesImportError {
  const allLines = text.split(/\r?\n/);
  const nonEmpty = allLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return { error: "CSV has no data rows." };

  const headers = parseCsvLine(nonEmpty[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) return { error: 'CSV must have a "name" column.' };
  const typeIdx = headers.indexOf("type");

  const payees: Pick<Payee, "name">[] = [];
  let skipped = 0;

  for (let i = 1; i < allLines.length; i++) {
    const fields = parseCsvLine(allLines[i]);
    const name = fields[nameIdx]?.trim() ?? "";
    if (!name) { skipped++; continue; }
    const type = typeIdx !== -1 ? (fields[typeIdx]?.trim().toLowerCase() ?? "") : "";
    if (type === "transfer") { skipped++; continue; }
    payees.push({ name });
  }

  return { payees, skipped };
}
