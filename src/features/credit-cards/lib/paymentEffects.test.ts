import { createCreditCardStore } from "./memory";
import { paymentEffects } from "./paymentEffects";
import { settlements } from "./repayments";
import type { ActivityRow, ActivitySnapshot } from "./activity";

function scenario(entries: { date: string; amount: number; cleared?: boolean | null; credit?: boolean }[], from = "2026-08-01") {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC", closingDay: 31, cashbackCategoryId: "rewards" });
  store.getState().recordOpeningStatement("budget", card.id, card.revision, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  const rows: ActivityRow[] = entries.map((entry, index) => ({ id: `r${index}`, fingerprint: `r${index}`, accountId: "card", date: entry.date, amountMinor: entry.amount, cleared: entry.cleared === undefined ? true : entry.cleared, label: "Funding account", notes: null, categoryId: entry.credit ? "rewards" : null, categoryName: null, transferId: entry.credit ? null : `peer${index}`, transferKnown: true, parentId: null }));
  const snapshot: ActivitySnapshot = { accountId: "card", from, to: "2026-09-30", rows, counterparts: [], issues: [], fetchedAt: "now", signature: "rows" };
  const workspace = store.getState().workspaces.budget;
  const windows = settlements(card, workspace, snapshot, "2026-09-30");
  return { store, card, workspace, snapshot, windows, effects: paymentEffects(card, workspace, snapshot, windows, "2026-09-30") };
}

it.each([[500, "Partial payment", "Minimum still short 5.00"], [1000, "Minimum payment", "Minimum covered"], [2000, "Partial payment", "Minimum covered"], [10000, "Completes statement", "Minimum covered"], [11000, "Excess payment", "Minimum covered"]])("describes a confirmed %i transfer without inferring payment intent", (amount, label, minimum) => {
  const { effects } = scenario([{ date: "2026-09-10", amount: Number(amount) }]);
  expect(effects.get("r0")).toMatchObject({ label, minimum });
});

it("uses earlier confirmed payments while ignoring pending transfers", () => {
  const { effects } = scenario([{ date: "2026-09-01", amount: 500 }, { date: "2026-09-02", amount: 500 }, { date: "2026-09-03", amount: 9000, cleared: false }, { date: "2026-09-04", amount: 9000 }]);
  expect(effects.get("r1")).toMatchObject({ label: "Partial payment", minimum: "Minimum covered" });
  expect(effects.get("r2")).toMatchObject({ label: "Pending" });
  expect(effects.get("r3")).toMatchObject({ label: "Completes statement" });
});

it("counts credits toward the full balance but never the minimum", () => {
  const { effects } = scenario([{ date: "2026-09-01", amount: 10000, credit: true }, { date: "2026-09-02", amount: 500 }, { date: "2026-09-03", amount: 500 }]);
  expect(effects.has("r0")).toBe(false);
  expect(effects.get("r1")).toMatchObject({ label: "Partial payment", minimum: "Minimum still short 5.00" });
  expect(effects.get("r2")).toMatchObject({ label: "Completes statement", minimum: "Minimum covered" });
});

it("does not claim a within-day sequence for multiple payments or credits", () => {
  const grouped = scenario([{ date: "2026-09-01", amount: 1000 }, { date: "2026-09-01", amount: 9000 }]);
  expect([...grouped.effects.values()].map((effect) => effect.label)).toEqual(["Same-day payments", "Same-day payments"]);
  expect(grouped.effects.get("r0")?.detail).toContain("within-day sequence is unknown");
  const credited = scenario([{ date: "2026-09-01", amount: 3000, credit: true }, { date: "2026-09-01", amount: 7000 }]);
  expect(credited.effects.get("r1")).toMatchObject({ label: "Payment + credits", minimum: "Minimum covered" });
});

it("leaves incomplete, unmatched, future, unknown-clearing and estimated evidence explicit", () => {
  const data = scenario([{ date: "2026-08-31", amount: 1000 }, { date: "2026-09-10", amount: 1000, cleared: null }, { date: "2026-10-01", amount: 1000 }]);
  expect(data.effects.get("r0")?.label).toBe("Unmatched");
  expect(data.effects.get("r1")?.label).toBe("Clearing unknown");
  expect(data.effects.get("r2")?.label).toBe("Future dated");
  expect(scenario([{ date: "2026-09-10", amount: 1000 }], "2026-09-01").effects.get("r0")?.label).toBe("Effect unavailable");
  const estimated = { ...data.workspace, statements: data.workspace.statements.map((statement) => ({ ...statement, bankConfirmed: false })) };
  const rows = { ...data.snapshot, rows: [{ ...data.snapshot.rows[1], cleared: true }] };
  expect(paymentEffects(data.card, estimated, rows, data.windows, "2026-09-30").get("r1")?.label).toBe("Not confirmed");
});

it("does not call a later transfer a minimum payment when earlier payments already reduced the minimum", () => {
  const { effects } = scenario([{ date: "2026-09-01", amount: 500 }, { date: "2026-09-02", amount: 1000 }]);
  expect(effects.get("r1")).toMatchObject({ label: "Partial payment", minimum: "Minimum covered" });
});
