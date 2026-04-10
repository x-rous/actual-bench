import { parseCsvLine, parseBoolean } from "@/lib/csv";
import { generateId } from "@/lib/uuid";
import { recurConfigSchema } from "../schemas/schedule.schema";
import type { StagedMap } from "@/types/staged";
import type { Schedule, ScheduleAmountRange, ScheduleAmountOp } from "@/types/entities";

type EntityMaps = {
  payees: StagedMap<{ id: string; name: string }>;
  accounts: StagedMap<{ id: string; name: string }>;
};

export type SchedulesImportResult = {
  schedules: Schedule[];
  skipped: number;
};

export type SchedulesImportError = { error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_AMOUNT_OPS = new Set<string>(["is", "isapprox", "isbetween"]);
const STRICT_INT = /^[+-]?\d+$/;

/**
 * Parses a CSV string into a list of schedules to stage.
 * Required column: date. All other columns optional.
 * Rows with an invalid or missing date are skipped.
 * payee / account columns are resolved by name from the staged maps.
 */
export function importSchedulesFromCsv(
  text: string,
  maps: EntityMaps
): SchedulesImportResult | SchedulesImportError {
  const allLines = text.split(/\r?\n/);
  const nonEmpty = allLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return { error: "CSV has no data rows." };

  const headers = parseCsvLine(nonEmpty[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);

  const dateIdx   = col("date");
  if (dateIdx === -1) return { error: 'CSV must have a "date" column.' };

  const nameIdx    = col("name");
  const amountIdx  = col("amount");
  const opIdx      = col("amountop");
  const payeeIdx   = col("payee");
  const accountIdx = col("account");
  const postsIdx   = col("posts_transaction");

  // Build name→id lookup maps
  const payeeByName = new Map<string, string>();
  for (const s of Object.values(maps.payees)) {
    if (!s.isDeleted) payeeByName.set(s.entity.name.toLowerCase(), s.entity.id);
  }
  const accountByName = new Map<string, string>();
  for (const s of Object.values(maps.accounts)) {
    if (!s.isDeleted) accountByName.set(s.entity.name.toLowerCase(), s.entity.id);
  }

  const schedules: Schedule[] = [];
  let skipped = 0;

  for (let i = 1; i < allLines.length; i++) {
    const line = allLines[i];
    if (!line.trim()) continue;

    const fields = parseCsvLine(line);
    const cell = (idx: number) => (idx >= 0 ? (fields[idx]?.trim() ?? "") : "");

    const dateRaw = cell(dateIdx);
    if (!dateRaw) { skipped++; continue; }

    // Parse date — either ISO string or validated RecurConfig JSON
    let date: Schedule["date"];
    if (ISO_DATE.test(dateRaw)) {
      date = dateRaw;
    } else {
      try {
        const parsed = JSON.parse(dateRaw);
        const result = recurConfigSchema.safeParse(parsed);
        if (!result.success) { skipped++; continue; }
        date = result.data as Schedule["date"];
      } catch {
        skipped++; continue;
      }
    }

    // Amount — set amountOp only after confirming the numeric parse succeeded
    let amount: number | ScheduleAmountRange | undefined;
    let amountOp: ScheduleAmountOp | undefined;
    const amountRaw = cell(amountIdx);
    const opRaw     = cell(opIdx);

    if (amountRaw && opRaw && VALID_AMOUNT_OPS.has(opRaw)) {
      if (opRaw === "isbetween") {
        const parts = amountRaw.split("|");
        const p0 = parts[0]?.trim() ?? "";
        const p1 = parts[1]?.trim() ?? "";
        if (parts.length === 2 && STRICT_INT.test(p0) && STRICT_INT.test(p1)) {
          amount = { num1: Number(p0), num2: Number(p1) };
          amountOp = "isbetween";
        }
      } else {
        const trimmed = amountRaw.trim();
        if (STRICT_INT.test(trimmed)) { amount = Number(trimmed); amountOp = opRaw as ScheduleAmountOp; }
      }
    }

    // Payee / account resolved by name
    const payeeIdResolved  = payeeByName.get(cell(payeeIdx).toLowerCase()) ?? undefined;
    const accountIdResolved = accountByName.get(cell(accountIdx).toLowerCase()) ?? undefined;

    schedules.push({
      id: generateId(),
      name: cell(nameIdx) || undefined,
      date,
      amount,
      amountOp,
      payeeId: payeeIdResolved ?? null,
      accountId: accountIdResolved ?? null,
      postsTransaction: parseBoolean(cell(postsIdx)),
      completed: false,
    });
  }

  return { schedules, skipped };
}
