import { normalizeActivity, type ActivitySnapshot } from "./activity";
import { cardSchema } from "./models";
import { statementDrafts } from "./statements";
import { cumulativeInterestCharges, observedInterestTotals, statementHistory } from "./history";
import { statementBreakdown } from "./derive/breakdown";
import { statementPayments } from "./derive/payments";
import { CARD_INPUT, facts, row, setup, snapshot, source as tx, transfer, BANK_ACCOUNT } from "./fixtures/testKit";

const card = cardSchema.parse({ ...CARD_INPUT, id: "c", revision: 1, closingDay: 31, dueRule: { kind: "day-of-month", value: 1 }, accountId: "card" });

function read(): ActivitySnapshot {
  const normalized = normalizeActivity([
    tx({ id: "spend", accountId: "card", date: "2026-09-10", amount: -80000, categoryId: "purchases", notes: "#2026-09" }),
    tx({ id: "interest", accountId: "card", date: "2026-09-20", amount: -2500, categoryId: "interest", notes: "#2026-09" }),
    tx({ id: "pay", accountId: "card", date: "2026-10-04", amount: 82500, transferId: "funding", notes: "#2026-01" }),
  ]);
  return { ...normalized, accountId: "card", from: "2025-01-01", to: "2026-10-10", counterparts: [], fetchedAt: "2026-10-10", signature: "snapshot" };
}

it("omits fabricated zero periods before first activity, while keeping zero cycles in known history", () => {
  expect(statementDrafts(card, "2026-10-10", 24, read(), 0).map((entry) => entry.closingDate)).toEqual(["2026-09-30"]);
  const later = statementDrafts(card, "2026-11-10", 24, { ...read(), to: "2026-11-10" }, 0);
  expect(later[0]).toMatchObject({ closingDate: "2026-10-31", balanceMinor: 0 });
  expect(statementDrafts(card, "2026-10-10", 24, { ...read(), rows: [] }, 0)).toEqual([]);
});

it("keeps inferred opening debt but respects an explicit date opened", () => {
  expect(statementDrafts(card, "2026-10-10", 3, read(), -10000)).toHaveLength(3);
  expect(statementDrafts({ ...card, openedDate: "2026-09-01" }, "2026-10-10", 3, read(), -10000)).toHaveLength(1);
});

it("keeps post-closing payments out of the statement's breakdown and reconciles from the previous balance", () => {
  const context = setup({ closingDay: 31, dueRule: { kind: "day-of-month", value: 1 }, interestCategoryId: "interest" }, [
    facts("2026-08-31", 0, { periodStart: "2026-08-01", dueDate: "2026-09-01", previousBalanceMinor: 0 }),
    facts("2026-09-30", 82500, { periodStart: "2026-09-01", dueDate: "2026-10-01" }),
  ]);
  const source = snapshot([
    row({ id: "spend", date: "2026-09-10", amount: -80000, categoryId: "purchases" }),
    row({ id: "interest", date: "2026-09-20", amount: -2500, categoryId: "interest" }),
    transfer("pay", "2026-10-04", 82500, BANK_ACCOUNT).card,
  ], { from: "2026-07-01", to: "2026-10-10" });
  const statement = context.workspace().statements[1];
  const breakdown = statementBreakdown(context.card(), statement, context.workspace(), source);
  expect(breakdown).toMatchObject({ openingMinor: 0, chargesMinor: 80000, interestMinor: 2500, paymentsMinor: 0, varianceMinor: 0 });
  const payment = statementPayments(context.card(), context.workspace(), source, "2026-10-10").find((entry) => entry.statementId === statement.id);
  // Paid three days late: the badge keeps the lateness after full settlement.
  expect(payment).toMatchObject({ paidMinor: 82500, leftToPayMinor: 0, paidDate: "2026-10-04" });
});

it("includes plan instalments in Charges and counts interest and fees once (CA-12)", () => {
  const context = setup({ closingDay: 31, dueRule: { kind: "day-of-month", value: 1 }, interestCategoryId: "interest", feeCategoryId: "fees" }, [
    facts("2026-09-30", 12500, { periodStart: "2026-09-01", dueDate: "2026-10-01", previousBalanceMinor: 0 }),
  ]);
  const source = snapshot([
    row({ id: "spend", date: "2026-09-10", amount: -2000, categoryId: "purchases" }),
    row({ id: "emi", date: "2026-09-15", amount: -10000, payeeName: "EMI 3/12" }),
    row({ id: "fee", date: "2026-09-16", amount: -500, categoryId: "fees" }),
  ], { from: "2026-08-01", to: "2026-10-10" });
  const history = statementHistory(context.card(), context.workspace(), source, "2026-10-10");
  expect(history[0].breakdown).toMatchObject({ chargesMinor: 12000, planChargesMinor: 10000, feesMinor: 500, interestAndFeesMinor: 500, varianceMinor: 0 });
});

it("accumulates observed charges chronologically and refuses unknown coverage", () => {
  const context = setup({ closingDay: 31, dueRule: { kind: "day-of-month", value: 1 }, interestCategoryId: "interest" }, [
    facts("2026-09-30", 82500, { periodStart: "2026-09-01", dueDate: "2026-10-01", previousBalanceMinor: 0 }),
  ]);
  const source = snapshot([
    row({ id: "spend", date: "2026-09-10", amount: -80000, categoryId: "purchases" }),
    row({ id: "interest", date: "2026-09-20", amount: -2500, categoryId: "interest" }),
  ], { from: "2026-08-01", to: "2026-10-10" });
  const history = statementHistory(context.card(), context.workspace(), source, "2026-10-10");
  const older = { ...history[0], statement: { ...history[0].statement, id: "older", closingDate: "2026-08-31" }, interestMinor: 1000 };
  expect(cumulativeInterestCharges([...history, older])).toEqual([{ date: "2026-08-31", value: 1000 }, { date: "2026-09-30", value: 3500 }]);
  expect(cumulativeInterestCharges([...history, { ...older, interestMinor: null }])).toEqual([{ date: "2026-08-31", value: null }, { date: "2026-09-30", value: null }]);
  expect(observedInterestTotals(context.card(), context.workspace(), { ...source, issues: ["Incomplete"] }, "2026-10-10").classificationKnown).toBe(false);
});
