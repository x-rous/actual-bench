import { discoverPlans } from "./derive/planDiscovery";
import { setup, snapshot, transfer } from "./fixtures/testKit";

const LOANS = "loans";

/** A booking moves principal off the card into the plan account; billing moves it back. */
const booking = (id: string, date: string, amount: number, notes: string) => transfer(id, date, amount, LOANS, { notes });
const billing = (id: string, date: string, amount: number, notes: string) => transfer(id, date, -amount, LOANS, { notes });

function scenario(legs: ReturnType<typeof transfer>[]) {
  const test = setup({});
  test.store.getState().setPlanAccounts("budget", [LOANS]);
  const read = snapshot(legs.map((leg) => leg.card), { from: "2024-01-01", to: "2026-10-16", planAccounts: { [LOANS]: { rows: legs.map((leg) => leg.peer) } } });
  return { ...test, read };
}

it("finds one plan per tag in a shared plan account, ignoring month and umbrella tags", () => {
  const legs = [
    booking("bt", "2025-08-09", 3864000, "#2025-09 #EMI_38K_BT #DF BALANCE TRANSFER"),
    billing("bt-1", "2025-09-06", 193200, "#2025-09 #EMI_38K_BT #DF BT 5% Payment"),
    billing("bt-2", "2025-11-25", 3670800, "#2025-11 #EMI_38K_BT #DF BT Remaining Payment"),
    booking("qc", "2024-12-10", 6000000, "#2025-01 #EMI_60K #DF QUICK CASH BOOKING"),
    ...Array.from({ length: 12 }, (_, index) => billing(`qc-${index}`, `2025-${String(index + 1).padStart(2, "0")}-07`, 500000, "#EMI_60K #DF QC 12 M")),
    booking("cash", "2025-12-30", 5000000, "#2025-12 #EMI_50KCash25 #DF QUICK CASH BOOKING"),
  ];
  const { card, workspace, read } = scenario(legs);
  const { candidates, ambiguous } = discoverPlans(card(), workspace(), read);
  expect(ambiguous).toEqual([]);
  expect(candidates.map((entry) => [entry.tag, entry.name, entry.originalMinor, entry.remainingMinor, entry.finished, entry.transfers])).toEqual([
    ["#EMI_50KCash25", "QUICK CASH BOOKING", 5000000, 5000000, false, 1],
    ["#EMI_38K_BT", "BALANCE TRANSFER", 3864000, 0, true, 3],
    ["#EMI_60K", "QUICK CASH BOOKING", 6000000, 0, true, 13],
  ]);
  expect(candidates[1]).toMatchObject({ startDate: "2025-08-09", lastDate: "2025-11-25", accountId: LOANS, bookings: 1, alternativeTags: [] });
});

it("skips transfers a plan already owns, and flags a transfer carrying two plan tags", () => {
  const legs = [
    booking("a", "2025-01-10", 100000, "#PLAN_A"), billing("a-1", "2025-02-10", 50000, "#PLAN_A"),
    booking("b", "2025-03-10", 200000, "#PLAN_B"),
    billing("mixed", "2025-04-10", 10000, "#PLAN_A #PLAN_B"),
  ];
  const { card, workspace, read, store } = scenario(legs);
  store.getState().savePlan("budget", null, read, {
    id: "plan-a", cardId: card().id, revision: 1, name: "A", recordedAs: "plan-account", planAccountId: LOANS, planAccountTag: "#PLAN_A",
  }, []);
  const { candidates, ambiguous } = discoverPlans(card(), workspace(), read);
  expect(candidates.map((entry) => entry.tag)).toEqual(["#PLAN_B"]);
  // With #PLAN_A in use, the mixed transfer is #PLAN_A's (owned) or carries only #PLAN_B; never both counted.
  expect(ambiguous.map((row) => row.id)).toEqual([]);
});

it("treats an account with no plans and no tags as one plan, and tags that always travel together as one choice", () => {
  const whole = scenario([booking("x", "2025-05-01", 90000, "Laptop instalments"), billing("x-1", "2025-06-01", 30000, "")]);
  const [one] = discoverPlans(whole.card(), whole.workspace(), whole.read).candidates;
  expect(one).toMatchObject({ tag: null, name: "Laptop instalments", originalMinor: 90000, remainingMinor: 60000, finished: false });

  const pair = scenario([booking("y", "2025-05-01", 90000, "#EMI_LAPTOP #DF Laptop"), billing("y-1", "2025-06-01", 30000, "#EMI_LAPTOP #DF")]);
  const { candidates, ambiguous } = discoverPlans(pair.card(), pair.workspace(), pair.read);
  expect(ambiguous).toEqual([]);
  expect(candidates).toHaveLength(1);
  expect([candidates[0].tag, ...candidates[0].alternativeTags].sort()).toEqual(["#DF", "#EMI_LAPTOP"]);
});

it("reports two plan tags on one transfer as ambiguous when neither is in use", () => {
  const { card, workspace, read } = scenario([
    booking("a", "2025-01-10", 100000, "#PLAN_A"), booking("b", "2025-03-10", 200000, "#PLAN_B"), billing("mixed", "2025-04-10", 10000, "#PLAN_A #PLAN_B"),
  ]);
  const { candidates, ambiguous } = discoverPlans(card(), workspace(), read);
  expect(ambiguous.map((row) => row.id)).toEqual(["mixed-peer"]);
  expect(candidates.map((entry) => entry.tag).sort()).toEqual(["#PLAN_A", "#PLAN_B"]);
});

it("keeps a plan topped up with a second booking as one plan, while a bank tag across plans stays an umbrella", () => {
  const { card, workspace, read } = scenario([
    booking("a", "2025-01-10", 100000, "#EMI_A #BANK"), booking("a-top", "2025-03-10", 50000, "#EMI_A #BANK"),
    booking("b", "2025-04-10", 200000, "#EMI_B #BANK"), billing("a-1", "2025-05-10", 150000, "#EMI_A #BANK"),
  ]);
  const { candidates, ambiguous } = discoverPlans(card(), workspace(), read);
  expect(ambiguous).toEqual([]);
  expect(candidates.map((entry) => [entry.tag, entry.bookings, entry.originalMinor, entry.finished])).toEqual([
    ["#EMI_B", 1, 200000, false],
    ["#EMI_A", 2, 150000, true],
  ]);
});

it("searches again when the registered plan accounts change, with the same plans and snapshot", () => {
  const legs = [booking("a", "2025-01-10", 100000, "#PLAN_A")];
  const { card, workspace, read } = scenario(legs);
  const registered = workspace();
  expect(discoverPlans(card(), registered, read).candidates).toHaveLength(1);
  // Same plans array, snapshot and card; only the registered plan accounts differ.
  expect(discoverPlans(card(), { ...registered, planAccounts: [] }, read).candidates).toEqual([]);
});
