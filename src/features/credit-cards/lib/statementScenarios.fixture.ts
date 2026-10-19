import { createCreditCardStore } from "./store/store";
import { normalizeActivity, type ActivitySnapshot } from "./activity";
import { statementPayments } from "./derive/payments";
import { statementReview } from "./statements";
import { addStatement, addCard, source } from "./fixtures/testKit";
import type { SyncSourceTransaction } from "@/lib/actual/transport";

/**
 * Offline recreation of the three RD-098 statement scenarios (paid in full, late and overdue,
 * carrying debt). Rows go through the real normaliser; nothing connects to or writes Actual.
 */
export function statementScenario(kind: "full" | "late" | "carry", store = createCreditCardStore()) {
  const accountId = `account-${kind}`;
  const card = addCard(store, {
    budgetSyncId: "scenarios", accountId, creditLimitMinor: 1000000, purchaseAprBps: 2400, bankTimeZone: "UTC",
    closingDay: 31, dueRule: { kind: "day-of-month", value: 1 }, firstTrackedStatementDate: "2025-09-30",
    interestCategoryId: "interest", feeCategoryId: "fees", color: kind === "full" ? "#2563eb" : kind === "carry" ? "#991b1b" : null,
  });
  const sources: SyncSourceTransaction[] = [];
  const peers: SyncSourceTransaction[] = [];
  const add = (id: string, date: string, amount: number, categoryId: string | null, transfer = false) => {
    const peerId = `peer-${kind}-${id}`;
    sources.push(source({
      id: `${kind}-${id}`, accountId, date, amount, categoryId, categoryName: categoryId,
      payeeName: transfer ? "Test checking" : "Test merchant", transferId: transfer ? peerId : null,
    }));
    if (transfer) peers.push(source({ id: peerId, accountId: "checking", date, amount: -amount, transferId: `${kind}-${id}`, payeeName: "Transfer" }));
  };
  addStatement(store, "scenarios", card.id, {
    periodStart: "2025-09-01", closingDate: "2025-09-30", dueDate: "2025-10-01", balanceMinor: 0, minimumDueMinor: 0, previousBalanceMinor: 0,
  });
  let debt = 0;
  for (let index = 0; index < 12; index++) {
    const date = new Date(Date.UTC(2025, 9 + index, 1));
    const iso = (day: number, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, day)).toISOString().slice(0, 10);
    const spending = kind === "carry" ? 80000 : 100000 + index * 1000;
    const refund = kind !== "carry" && iso(1).startsWith("2026-05") ? 5000 : 0;
    const interest = kind === "carry" ? 2500 : 0;
    const fee = kind === "carry" && iso(1).startsWith("2026-07") ? 4000 : 0;
    add(`spending-${index}`, iso(10), -spending, "purchases");
    if (refund) add(`refund-${index}`, iso(25), refund, "purchases");
    if (interest) add(`interest-${index}`, iso(27), -interest, "interest");
    if (fee) add(`fee-${index}`, iso(28), -fee, "fees");
    debt += spending + interest + fee - refund;
    addStatement(store, "scenarios", card.id, {
      periodStart: iso(1), closingDate: iso(0, 1), dueDate: iso(1, 1), balanceMinor: debt,
      minimumDueMinor: Math.min(debt, Math.max(2500, Math.round(debt * 0.02))),
    });
    const payment = kind === "carry" ? 20000 : kind === "late" && index === 11 ? 0 : debt;
    if (payment) add(`payment-${index}`, iso(kind === "late" && index !== 8 ? 4 : 1, 1), payment, null, true);
    debt -= payment;
  }
  const snapshot: ActivitySnapshot = {
    accountId, from: "2025-09-01", to: "2026-10-15",
    rows: normalizeActivity(sources).rows,
    counterparts: normalizeActivity(peers).rows,
    issues: [], fetchedAt: "2026-10-15T10:00:00Z", signature: `rd098-${kind}`,
  };
  const ordered = () => store.getState().workspaces.scenarios.statements
    .filter((entry) => entry.cardId === card.id)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  for (const statement of ordered()) {
    const current = store.getState().workspaces.scenarios.statements.find((entry) => entry.id === statement.id)!;
    const review = statementReview(current, store.getState().workspaces.scenarios, snapshot);
    store.getState().saveReview("scenarios", current.id, current.revision, snapshot, review.rows.map((row) => ({
      transactionId: row.id,
      decision: row.date >= current.periodStart && row.date <= current.closingDate ? "included" as const : "excluded" as const,
      bankPostingDate: null,
      note: null,
    })));
  }
  const workspace = store.getState().workspaces.scenarios;
  const saved = workspace.cards.find((entry) => entry.id === card.id)!;
  return {
    store,
    card: saved,
    workspace,
    rows: workspace.statements.filter((entry) => entry.cardId === card.id),
    snapshot,
    payments: statementPayments(saved, workspace, snapshot, "2026-10-15"),
  };
}
