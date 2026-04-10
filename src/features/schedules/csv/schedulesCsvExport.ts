import { csvField } from "@/lib/csv";
import type { StagedMap } from "@/types/staged";
import type { Schedule, ScheduleAmountRange } from "@/types/entities";

type EntityMaps = {
  payees: StagedMap<{ id: string; name: string }>;
  accounts: StagedMap<{ id: string; name: string }>;
};

/**
 * Serializes staged schedules to CSV.
 * date column: ISO string for one-time, or JSON-encoded RecurConfig for recurring.
 * amount column: cents value (or "num1|num2" for isbetween ranges).
 * Deleted entries are excluded. Read-only server fields (ruleId, nextDate) are omitted.
 */
export function exportSchedulesToCsv(
  staged: StagedMap<Schedule>,
  maps: EntityMaps
): string {
  const rows = Object.values(staged).filter((s) => !s.isDeleted);

  const lines = [
    "id,name,date,amount,amountOp,payee,account,posts_transaction,completed",
    ...rows.map(({ entity: s }) => {
      const dateStr = typeof s.date === "object" ? JSON.stringify(s.date) : (s.date ?? "");
      let amountStr = "";
      if (s.amount !== undefined) {
        if (typeof s.amount === "number") {
          amountStr = String(s.amount);
        } else {
          const r = s.amount as ScheduleAmountRange;
          amountStr = `${r.num1}|${r.num2}`;
        }
      }
      const payeeName   = maps.payees[s.payeeId ?? ""]?.entity.name ?? "";
      const accountName = maps.accounts[s.accountId ?? ""]?.entity.name ?? "";
      return [
        csvField(s.id),
        csvField(s.name ?? ""),
        csvField(dateStr),
        csvField(amountStr),
        csvField(s.amountOp ?? ""),
        csvField(payeeName),
        csvField(accountName),
        s.postsTransaction ? "true" : "false",
        s.completed ? "true" : "false",
      ].join(",");
    }),
  ];

  return lines.join("\n");
}
