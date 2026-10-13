import { createCreditCardStore } from "./memory";
import { cardInputSchema } from "./models";
import type { ActivityRow, ActivitySnapshot } from "./activity";
import { settlements } from "./repayments";
import { statementPaymentSummary } from "./paymentSummary";

function scenario(payments: { date: string; amount: number; pending?: boolean }[], balance = 10000, minimum = 2000, today = "2026-10-10", covered = true) {
  const store = createCreditCardStore();
  const card = store.getState().register(cardInputSchema.parse({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", closingDay: 31 }));
  const statement = store.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-01", officialBalanceMinor: balance, minimumDueMinor: minimum });
  const rows: ActivityRow[] = payments.map((payment, index) => ({ id: `p${index}`, accountId: "card", date: payment.date, amountMinor: payment.amount, cleared: !payment.pending, transferId: `peer${index}`, transferKnown: true, fingerprint: `p${index}`, label: "Checking", notes: "#2026-12 unrelated", categoryId: null, categoryName: null, parentId: null }));
  const snapshot: ActivitySnapshot = { accountId: "card", from: covered ? "2026-08-01" : "2026-09-15", to: today, rows, counterparts: [], issues: [], fetchedAt: today, signature: "test" };
  const settlement = settlements(card, store.getState().workspaces.budget, snapshot, today)[0];
  return { statement, settlement, summary: statementPaymentSummary(statement, settlement, today, true) };
}
const texts = (lines: { text: string }[]) => lines.map((line) => line.text).join(" | ");

it("separates an on-time minimum from full settlement three days late", () => {
  const { summary } = scenario([{ date: "2026-09-01", amount: 2000 }, { date: "2026-09-04", amount: 8000 }]);
  expect(texts(summary.progress)).toContain("Paid: 100.00 | Minimum met | Paid in full");
  expect(texts(summary.timing)).toBe("Minimum: 01 Sep 2026 · on time | Full: 04 Sep 2026 · 3 days late");
});
it("does not call pending thresholds met, and uses confirmed dates once cleared payments cover them", () => {
  const pending = scenario([{ date: "2026-09-01", amount: 10000, pending: true }]);
  expect(texts(pending.summary.progress)).toContain("Minimum recorded · pending | Full recorded · pending");
  expect(texts(pending.summary.timing)).toContain("on time (pending)");
  const mixed = scenario([{ date: "2026-09-01", amount: 10000, pending: true }, { date: "2026-09-04", amount: 10000 }]);
  expect(mixed.settlement).toMatchObject({ paidDate: "2026-09-01", confirmedPaidDate: "2026-09-04", confirmedMinimumPaidDate: "2026-09-04", status: "Paid late" });
  expect(texts(mixed.summary.timing)).toContain("Minimum: 04 Sep 2026 · 3 days late");
  expect(texts(mixed.summary.progress)).toContain("beyond obligation 100.00 (recorded)");
  const carried = scenario([{ date: "2026-09-01", amount: 3000, pending: true }, { date: "2026-09-04", amount: 2000 }]);
  expect(carried.settlement.status).toBe("Minimum paid late · balance carried");
  expect(texts(carried.summary.timing)).toContain("Minimum: 04 Sep 2026 · 3 days late | Full: balance carried");
});
it("shows partial and missed minimums without losing full remaining amounts", () => {
  const { summary } = scenario([{ date: "2026-09-01", amount: 1000 }]);
  expect(texts(summary.progress)).toBe("Paid: 10.00 | Minimum remaining: 10.00 | Full remaining: 90.00");
  expect(texts(summary.timing)).toContain("Minimum: 39 days overdue");
});
it("labels balance carried separately from a late minimum", () => {
  const { summary } = scenario([{ date: "2026-09-03", amount: 2000 }]);
  expect(texts(summary.timing)).toBe("Minimum: 03 Sep 2026 · 2 days late | Full: balance carried");
});
it("keeps due-today, zero-minimum and zero/credit-balance cases distinct", () => {
  expect(texts(scenario([], 10000, 2000, "2026-09-01").summary.timing)).toBe("Minimum: due today | Full: due today");
  expect(texts(scenario([], 10000, 0).summary.progress)).toContain("No minimum required | Full remaining: 100.00");
  for (const balance of [0, -1000]) expect(texts(scenario([], balance, 0).summary.timing)).toBe("No payment required");
});
it("retains actual overpayment and pending partial payments with provisional remaining amounts", () => {
  expect(texts(scenario([{ date: "2026-09-01", amount: 15000 }]).summary.progress)).toContain("Paid: 150.00 | Minimum met | Paid in full · beyond obligation 50.00");
  const { summary } = scenario([{ date: "2026-09-01", amount: 500, pending: true }]);
  expect(texts(summary.progress)).toContain("Paid: 5.00 · 5.00 pending | Minimum remaining: 15.00 | Full remaining: 95.00");
  expect(summary.detail).toContain("provisional until clearing");
});
it("never invents zero payments when coverage, bank facts or current source are unknown", () => {
  const { summary, statement, settlement } = scenario([], 10000, 2000, "2026-10-10", false);
  expect(texts(summary.progress)).toBe("Load payment history");
  expect(texts(statementPaymentSummary({ ...statement, bankConfirmed: false }, settlement, "2026-10-10", true).progress)).toBe("Confirm bank values");
  expect(texts(statementPaymentSummary(statement, settlement, "2026-10-10", false).progress)).toBe("Refresh activity");
});
