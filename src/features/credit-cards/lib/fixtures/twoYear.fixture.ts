import { addDays, addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { normalizeActivity, type ActivitySnapshot } from "../activity";
import { cardSchema, planSchema, statementSchema, type Card, type RepaymentPlan, type Statement, type Workspace } from "../models";

/**
 * Two years of realistic card activity for performance budgets: three cards with about
 * 1,500 rows each (two purchases a day, monthly interest and a monthly payment transfer),
 * 24 monthly bank statements per card and two plans (one APR, one minimum + deadline).
 * Rows go through `normalizeActivity`, so fingerprints are real `cc-v2` digests.
 */
export const TWO_YEAR_TODAY = "2026-10-15";
const FROM = "2024-10-11";

function source(accountId: string, prefix: string): SyncSourceTransaction[] {
  const rows: SyncSourceTransaction[] = [];
  const base = (id: string, date: string, amount: number, payeeName: string): SyncSourceTransaction => ({
    id, accountId, date, amount, payeeId: null, payeeName, categoryId: "groceries", categoryName: "Groceries",
    notes: null, cleared: date <= addDays(TWO_YEAR_TODAY, -3), reconciled: false, importedId: null,
    transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [],
  });
  const days = daysBetween(FROM, TWO_YEAR_TODAY);
  for (let day = 0; day <= days; day++) {
    const date = addDays(FROM, day);
    // Deterministic amounts in integer minor units.
    rows.push(base(`${prefix}-p-${day}-a`, date, -(1000 + (day * 37) % 9000), `Merchant ${day % 41}`));
    rows.push(base(`${prefix}-p-${day}-b`, date, -(500 + (day * 53) % 4000), `Shop ${day % 23}`));
  }
  for (let month = 0; month < 24; month++) {
    const close = addMonths("2024-11-10", month, 10);
    rows.push({ ...base(`${prefix}-int-${month}`, close, -(800 + month * 10), "Interest charge"), categoryId: "interest", categoryName: "Interest" });
    const due = addMonths("2024-12-03", month, 3);
    if (due <= TWO_YEAR_TODAY) {
      rows.push({ ...base(`${prefix}-pay-${month}`, due, 150000, "Payment"), categoryId: null, categoryName: null, transferId: `${prefix}-peer-${month}` });
    }
  }
  return rows;
}

function card(id: string): Card {
  return cardSchema.parse({
    id, budgetSyncId: "budget", revision: 1, accountId: `account-${id}`,
    creditLimitMinor: 1000000, purchaseAprBps: 2400, bankTimeZone: "UTC", status: "active", closingDay: 10,
    dueRule: { kind: "day-of-month", value: 3 }, interestCategoryId: "interest", feeCategoryId: "fees",
    minimumPercentBps: 500, minimumFloorMinor: 10000, firstTrackedStatementDate: "2024-11-10",
  });
}

function statements(cardId: string): Statement[] {
  return Array.from({ length: 24 }, (_, index) => {
    const closingDate = addMonths("2024-11-10", index, 10);
    return statementSchema.parse({
      id: `${cardId}-s${index}`, cardId, revision: 1,
      periodStart: index ? addDays(addMonths("2024-11-10", index - 1, 10), 1) : "2024-10-11",
      closingDate, dueDate: addMonths("2024-12-03", index, 3),
      balanceMinor: 150000, minimumDueMinor: 10000, previousBalanceMinor: index ? null : 0,
    });
  });
}

function plans(cardId: string): RepaymentPlan[] {
  const common = { cardId, revision: 1, status: "active", recordedAs: "card-instalments", minimumFloorMinor: 10000 };
  return [
    planSchema.parse({
      ...common, id: "plan-apr", name: "Laptop", scheduleKind: "fixed", originalAmountMinor: 240000, startDate: "2025-11-15",
      firstDueDate: "2025-12-03", instalmentMinor: 20000, instalmentCount: 12, aprBps: 1999, includesCosts: false,
    }),
    planSchema.parse({
      ...common, id: "plan-minimum", name: "Sofa", scheduleKind: "minimum-deadline", originalAmountMinor: 120000,
      startDate: "2026-01-15", firstDueDate: "2026-02-03", instalmentCount: 12, aprBps: 2400, minimumPercentBps: 500,
    }),
  ];
}

export function twoYearFixture() {
  const cards = ["a", "b", "c"].map(card);
  const sources = cards.map((entry) => source(entry.accountId, entry.id));
  const snapshots: ActivitySnapshot[] = sources.map((rows, index) => ({
    accountId: cards[index].accountId,
    from: FROM,
    to: TWO_YEAR_TODAY,
    rows: normalizeActivity(rows).rows,
    counterparts: [],
    issues: [],
    fetchedAt: `${TWO_YEAR_TODAY}T00:00:00.000Z`,
    signature: `fixture-${index}`,
  }));
  const workspace: Workspace = {
    cards,
    statements: cards.flatMap((entry) => statements(entry.id)),
    decisions: [],
    typeCorrections: [],
    plans: plans(cards[0].id),
    planEntries: [],
    planAccounts: [],
    limitChanges: [],
  };
  return { cards, sources, snapshots, workspace, today: TWO_YEAR_TODAY };
}
