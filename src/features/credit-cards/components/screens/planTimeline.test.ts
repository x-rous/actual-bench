import { planTimeline } from "./planTimeline";
import { laptopPlanScenario, row, setup, snapshot, transfer } from "../../lib/fixtures/testKit";
import { planEntryFor } from "../../lib/plans";

const summary = (rows: ReturnType<typeof planTimeline>["rows"]) => rows.map((entry) => [entry.event, entry.status.label, entry.actual?.id ?? null]);

/** A 6,000.00 purchase billed on the card in 12 × 500.00 from 07 Sep. */
function billedOnCard(options: { status?: "active" | "completed"; scheduleKind?: "fixed" | null | "promotional" } = {}) {
  const test = setup({});
  const purchase = row({ id: "laptop", date: "2026-08-10", amount: -600000, payeeName: "Laptop store" });
  const first = row({ id: "i1", date: "2026-09-07", amount: -50000, payeeName: "Instalment" });
  const second = row({ id: "i2", date: "2026-10-07", amount: -50000, payeeName: "Instalment" });
  const later = row({ id: "i3", date: "2026-11-05", amount: -50000, payeeName: "Laptop instalment" });
  const settlement = row({ id: "settle", date: "2026-10-20", amount: -500000, payeeName: "Plan settlement" });
  const read = snapshot([purchase, first, second, later, settlement], { from: "2026-08-01", to: "2026-11-10" });
  const scheduleKind = options.scheduleKind === undefined ? "fixed" : options.scheduleKind;
  test.store.getState().savePlan("budget", null, read, {
    id: "plan", cardId: test.cardId, revision: 1, name: "Laptop", recordedAs: scheduleKind === "fixed" ? "card-instalments" : "card-balance",
    status: options.status ?? "active", endedOn: options.status === "completed" ? "2026-10-20" : null, originalAmountMinor: 600000, startDate: "2026-08-10",
    scheduleKind, firstDueDate: scheduleKind === "fixed" ? "2026-09-07" : null, instalmentCount: scheduleKind === "fixed" ? 12 : null,
    instalmentMinor: scheduleKind === "fixed" ? 50000 : null, expiryDate: scheduleKind === "promotional" ? "2027-02-01" : null,
  }, [
    planEntryFor("plan", purchase, "original"),
    planEntryFor("plan", first, "instalment", 1),
    planEntryFor("plan", second, "instalment"),
    ...(options.status === "completed" ? [planEntryFor("plan", settlement, "settlement")] : []),
  ]);
  return { ...test, read };
}

it("bank-billed plan: the original purchase, billed instalments with what posted, the next one with a suggestion, then upcoming", () => {
  const { workspace, card, read } = billedOnCard();
  const { rows, suggestedCount } = planTimeline(workspace().plans[0], card(), workspace(), read, "2026-10-15", 500000);
  expect(summary(rows).slice(0, 4)).toEqual([
    ["Original purchase", "Recorded", "laptop"],
    ["Instalment 1 of 12", "Billed", "i1"],
    ["Instalment 2 of 12", "Billed", "i2"],
    ["Instalment 3 of 12", "Next", null],
  ]);
  expect(rows[3].suggestion?.row.id).toBe("i3");
  expect(rows.filter((entry) => entry.status.label === "Upcoming")).toHaveLength(9);
  expect(suggestedCount).toBeGreaterThan(0);
});

it("bank-billed plan settled early: the settlement is its own row and the rest of the schedule is not needed", () => {
  const { workspace, card, read } = billedOnCard({ status: "completed" });
  const { rows, closedEarly } = planTimeline(workspace().plans[0], card(), workspace(), read, "2026-11-10", 0);
  expect(closedEarly).toBe(true);
  expect(summary(rows)).toContainEqual(["Early settlement", "Recorded", "settle"]);
  expect(summary(rows)).toContainEqual(["Instalment 2 of 12", "Billed", "i2"]);
  expect(rows.filter((entry) => entry.status.label === "Not needed")).toHaveLength(10);
  expect(rows.some((entry) => entry.suggestion)).toBe(false);
});

it("plan in a plan account: the booking and each instalment come from the account, with no expected rows when there is no schedule", () => {
  const plan = laptopPlanScenario();
  const { rows } = planTimeline(plan.workspace().plans[0], plan.card(), plan.workspace(), plan.snapshot, plan.today, 2500000);
  expect(rows.some((entry) => entry.event === "Booked" && entry.source === "owned")).toBe(true);
  expect(rows.every((entry) => entry.source !== "expected")).toBe(true);
});

it.each([null, "promotional"] as const)("plan with no schedule (%s): only what happened, no expected instalments", (scheduleKind) => {
  const { workspace, card, read } = billedOnCard({ scheduleKind });
  const { rows } = planTimeline(workspace().plans[0], card(), workspace(), read, "2026-10-15", null);
  expect(rows.every((entry) => entry.expectedMinor === null)).toBe(true);
  expect(summary(rows)).toContainEqual(["Original purchase", "Recorded", "laptop"]);
});

it("works before Actual is read: the schedule alone, every row expected", () => {
  const { workspace, card } = billedOnCard();
  const { rows } = planTimeline(workspace().plans[0], card(), workspace(), undefined, "2026-08-15", null);
  expect(rows).toHaveLength(12);
  expect(rows[0].status.label).toBe("Next");
});

it("plan account closed early by one large transfer: that posting reads Closed early with its difference, the rest Not needed", () => {
  const test = setup({});
  const LOANS = "loans";
  test.store.getState().setPlanAccounts("budget", [LOANS]);
  const legs = [
    transfer("book", "2026-05-01", 600000, LOANS), transfer("b1", "2026-06-01", -100000, LOANS),
    transfer("b2", "2026-07-01", -100000, LOANS), transfer("rest", "2026-07-20", -400000, LOANS),
  ];
  const read = snapshot(legs.map((leg) => leg.card), { from: "2026-04-01", to: "2026-10-15", planAccounts: { [LOANS]: { rows: legs.map((leg) => leg.peer) } } });
  test.store.getState().savePlan("budget", null, read, {
    id: "plan", cardId: test.cardId, revision: 1, name: "BT", recordedAs: "plan-account", planAccountId: LOANS, originalAmountMinor: 600000,
    startDate: "2026-05-01", scheduleKind: "fixed", firstDueDate: "2026-06-01", instalmentCount: 6, instalmentMinor: 100000,
  }, []);
  const { rows, closedEarly } = planTimeline(test.workspace().plans[0], test.card(), test.workspace(), read, "2026-10-15", 0);
  expect(closedEarly).toBe(true);
  const third = rows.find((entry) => entry.event === "Instalment 3 of 6")!;
  expect(third).toMatchObject({ status: { label: "Closed early" }, differenceMinor: 300000 });
  expect(rows.filter((entry) => entry.status.label === "Not needed")).toHaveLength(3);
  expect(summary(rows)[0]).toEqual(["Booked", "Recorded", "book"]);
});

it("separates due and posted dates, and runs the principal still owed down the timeline", () => {
  const { workspace, card, read } = billedOnCard();
  const { rows } = planTimeline(workspace().plans[0], card(), workspace(), read, "2026-10-15", 500000);
  const byEvent = (event: string) => rows.find((entry) => entry.event === event)!;
  expect(byEvent("Original purchase")).toMatchObject({ postedDate: "2026-08-10", remainingMinor: 600000 });
  expect(byEvent("Instalment 1 of 12")).toMatchObject({ dueDate: "2026-09-07", postedDate: "2026-09-07", remainingMinor: 550000 });
  expect(byEvent("Instalment 2 of 12")).toMatchObject({ remainingMinor: 500000 });
  // Still to come: projected from the schedule, with no posted date.
  expect(byEvent("Instalment 3 of 12")).toMatchObject({ postedDate: null, remainingMinor: 450000 });
  expect(byEvent("Instalment 12 of 12").remainingMinor).toBe(0);
});

it("plan account: the booking sets the principal and each transfer back to the card lowers it", () => {
  const plan = laptopPlanScenario();
  const { rows } = planTimeline(plan.workspace().plans[0], plan.card(), plan.workspace(), plan.snapshot, plan.today, 2500000);
  expect(rows.filter((entry) => entry.source === "owned").map((entry) => [entry.event, entry.remainingMinor]))
    .toEqual([["Booked", 3000000], ["Instalment", 2500000]]);
});

it("flags a plan-account transfer whose plan-account side is not cleared, and keeps the plan tag from that side's notes", () => {
  const test = setup({});
  const conversion = transfer("conversion", "2026-09-11", 1051300, "plan-shared", { peerCleared: false, peerNotes: "#EMI_A conversion" });
  const read = snapshot([conversion.card], { from: "2026-08-01", to: "2026-10-16", planAccounts: { "plan-shared": { rows: [conversion.peer] } } });
  test.store.getState().savePlan("budget", null, read, {
    id: "plan", cardId: test.cardId, revision: 1, name: "School", recordedAs: "plan-account", planAccountId: "plan-shared", planAccountTag: "#EMI_A",
    originalAmountMinor: 1051300, startDate: "2026-09-01",
  }, []);
  const { rows } = planTimeline(test.workspace().plans[0], test.card(), test.workspace(), read, "2026-10-16", 1051300);
  expect(rows[0]).toMatchObject({ event: "Booked", notes: "#EMI_A conversion", remainingMinor: 1051300, status: { line: "Plan account side not cleared" } });
});
