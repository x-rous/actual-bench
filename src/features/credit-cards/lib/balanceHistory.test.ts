import { dailyBalanceHistory } from "./balanceHistory";
import { statementScenario } from "./statementScenarios.fixture";
import { sumMinor } from "./statements";
import { BANK_ACCOUNT, row, setup, snapshot, transfer } from "./fixtures/testKit";

const PLAN = "plan-laptop";

/** 30,000 bought on 10 Jun, converted into a plan account on 12 Jun, billed back 5,000 on 8 Jul, paid 5,000 cash on 2 Aug. */
function planned(options: { peerDate?: string } = {}) {
  const test = setup({ purchaseAprBps: null });
  const conversion = transfer("conversion", "2026-06-12", 3000000, PLAN, { peerDate: options.peerDate });
  const billed = transfer("billed", "2026-07-08", -500000, PLAN);
  const cash = transfer("cash", "2026-08-02", 500000, BANK_ACCOUNT);
  const rows = [row({ id: "laptop", date: "2026-06-10", amount: -3000000, categoryId: "tech" }), conversion.card, billed.card, cash.card];
  const source = snapshot(rows, { from: "2026-06-01", to: "2026-10-16", planAccounts: { [PLAN]: { rows: [conversion.peer, billed.peer] } } });
  test.store.getState().savePlan("budget", null, source, {
    id: "plan", cardId: test.cardId, revision: 1, name: "Laptop", recordedAs: "plan-account", planAccountId: PLAN, originalAmountMinor: 3000000, startDate: "2026-06-10",
  }, []);
  const signed = sumMinor(source.rows.map((entry) => entry.amountMinor));
  return { ...test, source, signed };
}

it("plots Total owed once a day: conversion and billing move principal; cash payments reduce it", () => {
  const { card, workspace, source, signed } = planned();
  const history = dailyBalanceHistory(card(), workspace(), source, signed, "2026-10-16");
  const on = (date: string) => history.points.find((point) => point.date === date)!;
  expect(on("2026-06-09").valueMinor).toBe(0);
  expect(on("2026-06-10").valueMinor).toBe(3000000);
  expect(on("2026-06-12").valueMinor).toBe(3000000);
  expect(on("2026-07-08").valueMinor).toBe(3000000);
  expect(on("2026-08-02").valueMinor).toBe(2500000);
  expect(on("2026-10-16")).toMatchObject({ valueMinor: 2500000, onCardMinor: 0, planMinor: 2500000 });
  expect(history.events.filter((event) => event.kind === "payment").map((event) => event.id)).toEqual(["cash"]);
  expect(history.points.at(-1)?.date).toBe("2026-10-16");
});

it("does not jump when the two legs of a transfer post on different days", () => {
  const { card, workspace, source, signed } = planned({ peerDate: "2026-06-14" });
  const history = dailyBalanceHistory(card(), workspace(), source, signed, "2026-10-16");
  const values = ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"].map((date) => history.points.find((point) => point.date === date)!.valueMinor);
  expect(values).toEqual([3000000, 3000000, 3000000, 3000000]);
});

it("ignores future entries in the current balance anchor and keeps missing balances blank", () => {
  const { card, workspace, source, signed } = planned();
  const current = dailyBalanceHistory(card(), workspace(), source, signed, "2026-10-16");
  const future = { ...source, rows: [...source.rows, row({ id: "future", date: "2026-11-10", amount: -999000 })] };
  expect(dailyBalanceHistory(card(), workspace(), future, signed, "2026-10-16").points).toEqual(current.points);
  expect(dailyBalanceHistory(card(), workspace(), source, undefined, "2026-10-16")).toMatchObject({ knownDays: 0, averageMinor: null, currentMinor: null, highest: null });
});

it("calculates average end-of-day balances in exact minor units and finds the earliest peak", () => {
  const { card, workspace } = setup({ purchaseAprBps: null });
  const source = snapshot([
    row({ id: "purchase", date: "2026-10-01", amount: -10000 }),
    row({ id: "refund", date: "2026-10-03", amount: 2000 }),
    row({ id: "refund-2", date: "2026-10-04", amount: 3000 }),
  ], { from: "2026-10-01", to: "2026-10-04" });
  const history = dailyBalanceHistory(card(), workspace(), source, -5000, "2026-10-04");
  expect(history.points.map((point) => point.valueMinor)).toEqual([10000, 10000, 8000, 5000]);
  expect(history.averageMinor).toBe(8250);
  expect(history.highest).toMatchObject({ date: "2026-10-01", valueMinor: 10000 });
});

it("shades paid-in-full windows apart from statement periods with recorded interest", () => {
  const full = statementScenario("full");
  const carry = statementScenario("carry");
  const build = (scenario: typeof full) => dailyBalanceHistory(scenario.card, scenario.workspace, scenario.snapshot,
    sumMinor(scenario.snapshot.rows.map((entry) => entry.amountMinor)), "2026-10-15");
  expect(build(full).bands.some((band) => band.kind === "free")).toBe(true);
  expect(build(full).bands.some((band) => band.kind === "charged")).toBe(false);
  expect(build(carry).bands.some((band) => band.kind === "charged")).toBe(true);
});

it("ends just after the next bill's due date, projects paying Left to pay, and scores each bill", () => {
  const late = statementScenario("late");
  const signed = sumMinor(late.snapshot.rows.map((entry) => entry.amountMinor));
  const history = dailyBalanceHistory(late.card, late.workspace, late.snapshot, signed, "2026-10-15");
  // On 15 Oct every bill is past due: the chart ends today and projects nothing.
  expect(history.bills.some((bill) => bill.dueDate > "2026-10-15")).toBe(false);
  expect(history.until).toBe("2026-10-15");
  expect(history.projection).toBeNull();
  // On 30 Sep the bill closing that day is still to come due (1 Oct): the chart runs two days past it and
  // projects paying its Left to pay.
  const closing = dailyBalanceHistory(late.card, late.workspace, late.snapshot,
    sumMinor(late.snapshot.rows.filter((entry) => entry.date <= "2026-09-30").map((entry) => entry.amountMinor)), "2026-09-30");
  expect(closing.until).toBe("2026-10-03");
  expect(closing.projection).toMatchObject({ from: "2026-09-30", to: "2026-10-01", startMinor: 111000, payMinor: 111000, endMinor: 0 });
  expect(history.bills.length).toBeGreaterThan(0);
  expect(history.bills.some((bill) => bill.status.late || bill.status.key === "paid-late")).toBe(true);
  expect(history.billsPaidInFull.paid).toBeLessThan(history.billsPaidInFull.total);
  const full = statementScenario("full");
  const fullHistory = dailyBalanceHistory(full.card, full.workspace, full.snapshot, sumMinor(full.snapshot.rows.map((entry) => entry.amountMinor)), "2026-10-15", 12);
  expect(fullHistory.billsPaidInFull.paid).toBe(fullHistory.billsPaidInFull.total);
  // Paid in full every month with no interest: every reviewed statement in the range is interest-free.
  expect(fullHistory.interestFreeStatements.total).toBeGreaterThan(0);
  expect(fullHistory.interestFreeStatements.free).toBe(fullHistory.interestFreeStatements.total);
  const carry = statementScenario("carry");
  const carried = dailyBalanceHistory(carry.card, carry.workspace, carry.snapshot, sumMinor(carry.snapshot.rows.map((entry) => entry.amountMinor)), "2026-10-15", 12);
  expect(carried.interestFreeStatements.free).toBeLessThan(carried.interestFreeStatements.total);
});
