import { dailyBalanceHistory } from "./balanceHistory";
import { transferPlanScenario } from "./planTracking.fixture";
import { statementScenario } from "./statementScenarios.fixture";
import { sumMinor } from "./statements";

it("plots total daily debt once: conversion and billing move principal; cash payments reduce debt", () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const history = dailyBalanceHistory(cards[0], workspace, sources[0], -450000, "2026-10-16");
  const on = (date: string) => history.points.find((point) => point.date === date)!;
  expect(on("2026-06-09").valueMinor).toBe(0);
  expect(on("2026-06-10").valueMinor).toBe(3000000);
  expect(on("2026-07-07").valueMinor).toBe(3000000);
  expect(on("2026-07-08").valueMinor).toBe(3005000); // Billing stays flat; the separate fee adds 50.
  expect(on("2026-08-02").valueMinor).toBe(2500000);
  expect(on("2026-08-08").valueMinor).toBe(2500000);
  expect(history.currentMinor).toBe(1450000);
  expect(on("2026-10-16")).toMatchObject({ onCardMinor: 450000, planMinor: 1000000 });
  expect(history.events.filter((event) => event.kind === "payment").map((event) => event.id)).toEqual(["cash-a-8", "cash-a-9", "cash-a-10", "pending"]);
  expect(history.events.find((event) => event.id === "pending")).toMatchObject({ pending: true });
  expect(history.bands.some((band) => band.kind === "charged")).toBe(false); // Remaining 0% principal is not interest.
  expect(history.until).toBe("2026-12-31");
  expect(history.points.at(-1)?.date).toBe("2026-10-16"); // Never project debt into future key dates.
});

it("keeps unknown mid-plan history blank and ignores future entries in the current balance anchor", () => {
  const { cards, workspace, sources, plans } = transferPlanScenario();
  const current = dailyBalanceHistory(cards[0], workspace, sources[0], -450000, "2026-10-16");
  const withFuture = { ...sources[0], rows: [...sources[0].rows, { ...sources[0].rows[0], id: "future", date: "2026-11-10", amountMinor: -999000 }] };
  expect(dailyBalanceHistory(cards[0], workspace, withFuture, -450000, "2026-10-16").points).toEqual(current.points);
  const openingWorkspace = { ...workspace, plans: [{ ...plans[0], opening: { date: "2026-10-08", principalMinor: 1000000 } }, plans[1]] };
  const partial = dailyBalanceHistory(cards[0], openingWorkspace, sources[0], -450000, "2026-10-16");
  expect(partial.points.filter((point) => point.date < "2026-10-08").every((point) => point.valueMinor === null)).toBe(true);
  expect(partial.knownDays).toBe(9);
  expect(partial.currentMinor).toBe(1450000);
  expect(partial.averageMinor).toBe(Math.round(sumMinor(partial.points.map((point) => point.valueMinor ?? 0)) / 9));
  const missing = dailyBalanceHistory(cards[0], workspace, sources[0], undefined, "2026-10-16");
  expect(missing).toMatchObject({ knownDays: 0, averageMinor: null, currentMinor: null, highest: null });
});

it("calculates average end-of-day balances with exact minor units and identifies the earliest peak", () => {
  const { card, snapshot, workspace } = statementScenario("full");
  const row = snapshot.rows[0];
  const source = { ...snapshot, from: "2026-10-01", to: "2026-10-04", rows: [
    { ...row, id: "purchase", date: "2026-10-01", amountMinor: -10000 },
    { ...row, id: "payment", date: "2026-10-03", amountMinor: 2000 },
    { ...row, id: "payment2", date: "2026-10-04", amountMinor: 3000 },
  ] };
  const history = dailyBalanceHistory(card, { ...workspace, statements: [] }, source, -5000, "2026-10-04");
  expect(history.points.map((point) => point.valueMinor)).toEqual([10000, 10000, 8000, 5000]);
  expect(history.averageMinor).toBe(8250);
  expect(history.highest).toMatchObject({ date: "2026-10-01", valueMinor: 10000 });
});

it("distinguishes inferred paid-in-full windows from statement periods with recorded interest", () => {
  const full = statementScenario("full"), carry = statementScenario("carry");
  const build = (scenario: typeof full) => dailyBalanceHistory(scenario.card, scenario.workspace, scenario.snapshot, sumMinor(scenario.snapshot.rows.map((row) => row.amountMinor)), "2026-10-15");
  const free = build(full), charged = build(carry);
  expect(free.bands.some((band) => band.kind === "free")).toBe(true);
  expect(free.bands.some((band) => band.kind === "charged")).toBe(false);
  expect(charged.bands.some((band) => band.kind === "charged")).toBe(true);
  expect(charged.bands.some((band) => band.kind === "free")).toBe(false);
  expect(free.costsMinor).toBe(0);
  expect(charged.costsMinor).toBe(14000); // Jun–Sep interest 4 × 25, plus July's 40 fee.
  const refund = { ...carry.snapshot.rows.find((row) => row.categoryId === "interest")!, id: "interest-refund", fingerprint: "interest-refund", date: "2026-10-03", amountMinor: 500 };
  expect(build({ ...carry, snapshot: { ...carry.snapshot, rows: [...carry.snapshot.rows, refund] } }).costsMinor).toBe(13500);
  const { plans } = transferPlanScenario();
  const interestPlan = { ...plans[0], cardId: full.card.id, tracking: undefined, aprBps: 1200 };
  expect(build({ ...full, workspace: { ...full.workspace, plans: [interestPlan] } }).bands.some((band) => band.kind === "free" && band.to >= interestPlan.startDate)).toBe(false);
});

it("preserves daily debt when the two sides of an instalment transfer post on different dates", () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const source = sources[0];
  const delayed = { ...source, counterparts: source.counterparts.map((row) => row.id === "instalment-a-8-peer" ? { ...row, date: "2026-08-09" } : row), trackingAccounts: source.trackingAccounts!.map((account) => ({ ...account, rows: account.rows.map((row) => row.id === "instalment-a-8-peer" ? { ...row, date: "2026-08-09" } : row) })) };
  const history = dailyBalanceHistory(cards[0], workspace, delayed, -450000, "2026-10-16");
  const inTransit = history.points.find((point) => point.date === "2026-08-08")!;
  expect(inTransit).toMatchObject({ valueMinor: 2500000, transitMinor: -500000 });
  expect(inTransit.valueMinor).toBe(sumMinor([inTransit.onCardMinor!, inTransit.planMinor!, inTransit.transitMinor!]));
  expect(history.points.find((point) => point.date === "2026-08-09")?.valueMinor).toBe(inTransit.valueMinor);
});

it("keeps credit-reduced daily debt without treating refunds as paid-in-full interest-free windows", () => {
  const { card, workspace, snapshot } = statementScenario("full");
  const credits = { ...snapshot, rows: snapshot.rows.map((row) => row.transferId ? { ...row, transferId: null, categoryId: "purchases", label: "Merchant refund" } : row) };
  const balance = sumMinor(snapshot.rows.map((row) => row.amountMinor));
  const original = dailyBalanceHistory(card, workspace, snapshot, balance, "2026-10-15");
  const credited = dailyBalanceHistory(card, workspace, credits, balance, "2026-10-15");
  expect(credited.points.map((point) => point.valueMinor)).toEqual(original.points.map((point) => point.valueMinor));
  expect(credited.bands.some((band) => band.kind === "free")).toBe(false);
});
