import { createCreditCardStore } from "./memory";
import { statementReview } from "./statements";
import { settlements } from "./repayments";
import type { ActivityRow, ActivitySnapshot } from "./activity";

/** Offline recreation of the three disposable RD098 scenarios; never connects to or writes Actual. */
export function statementScenario(kind: "full" | "late" | "carry", store = createCreditCardStore()) {
  const number = kind === "full" ? 1 : kind === "late" ? 2 : 3;
  const card = store.getState().register({ budgetSyncId: "scenarios", accountId: `account-${kind}`, nickname: `RD098 CC ${number} - ${kind === "full" ? "Paid in full" : kind === "late" ? "Late and overdue" : "Carrying debt"}`, issuer: "", last4: "", creditLimitMinor: 1000000, purchaseAprBps: 2400, bankTimeZone: "UTC", status: "active", closingDay: 31, dueRule: { kind: "day-of-month", day: 1 }, firstTrackedStatementDate: "2025-09-30", interestCategoryId: "interest", feeCategoryId: "fees", appearance: kind === "full" ? "blue" : kind === "carry" ? "red" : "default" });
  const rows: ActivityRow[] = [];
  const add = (id: string, date: string, amountMinor: number, categoryId: string | null, transferId: string | null = null) => rows.push({ id: `${kind}-${id}`, date, amountMinor, categoryId, transferId, accountId: card.accountId, label: transferId ? "Test checking" : "Test merchant", notes: null, categoryName: categoryId, cleared: true, transferKnown: true, parentId: null, fingerprint: `${kind}-${id}` });
  store.getState().recordStatement("scenarios", card.id, card.revision, { periodStart: "2025-09-01", closingDate: "2025-09-30", dueDate: "2025-10-01", officialBalanceMinor: 0, minimumDueMinor: 0, openingBalanceMinor: 0 }, true);
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
    store.getState().recordStatement("scenarios", card.id, store.getState().workspaces.scenarios.cards.find((entry) => entry.id === card.id)!.revision, { periodStart: iso(1), closingDate: iso(0, 1), dueDate: iso(1, 1), officialBalanceMinor: debt, minimumDueMinor: Math.min(debt, Math.max(2500, Math.round(debt * 0.02))) }, true);
    const payment = kind === "carry" ? 20000 : kind === "late" && index === 11 ? 0 : debt;
    if (payment) add(`payment-${index}`, iso(kind === "late" && index !== 8 ? 4 : 1, 1), payment, null, `peer-${kind}-${index}`);
    debt -= payment;
  }
  const snapshot: ActivitySnapshot = { accountId: card.accountId, from: "2025-09-01", to: "2026-10-15", rows, counterparts: [], issues: [], fetchedAt: "2026-10-15T10:00:00Z", signature: `rd098-${kind}` };
  for (const statement of store.getState().workspaces.scenarios.statements.filter((entry) => entry.cardId === card.id).sort((a, b) => a.closingDate.localeCompare(b.closingDate))) {
    const review = statementReview(statement, store.getState().workspaces.scenarios, snapshot);
    store.getState().saveReview("scenarios", statement.id, statement.revision, snapshot, review.rows.map((row) => ({ statementId: statement.id, cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, decision: row.date >= statement.periodStart && row.date <= statement.closingDate ? "included" : "excluded", provenance: "manual", reason: "Synthetic scenario cutoff", bankPostingDate: null })), true);
  }
  const workspace = store.getState().workspaces.scenarios;
  return { store, card: workspace.cards.find((entry) => entry.id === card.id)!, workspace, rows: workspace.statements.filter((entry) => entry.cardId === card.id), snapshot, statuses: settlements(card, workspace, snapshot, "2026-10-15") };
}
