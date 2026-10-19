import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import { getBudgetFileSyncCapabilities } from "@/lib/sync/capabilities";
import { activityCategoryLabel, normalizeActivity, readCardActivity } from "./activity";
import { asOfCardBalance, cardBalance } from "./financialAdapter";
import { safeIntegerSum } from "./minor";
import { cycleDates, minimumEstimate, recentClosings } from "./cycles";
import { portfolio } from "./history";
import { netActivitySinceStatement } from "./insights";
import { cardSchema } from "./models";
import { statementDrafts, statementReview, statementTags, sumMinor } from "./statements";
import { BANK_ACCOUNT, CARD_ACCOUNT, CARD_INPUT, facts, row, setup, snapshot, source, transfer } from "./fixtures/testKit";

const card = cardSchema.parse({
  ...CARD_INPUT, id: "c", revision: 1, closingDay: 31, dueRule: { kind: "days-after-close", value: 21 },
  minimumPercentBps: 250, minimumFloorMinor: 2500,
});

it("clamps short months without losing the recurring day, and rolls due days forward", () => {
  expect(recentClosings(card, "2024-03-15", 3)).toEqual(["2024-02-29", "2024-01-31", "2023-12-31"]);
  expect(cycleDates(card, "2024-02-29")).toEqual({ periodStart: "2024-02-01", closingDate: "2024-02-29", dueDate: "2024-03-21" });
  expect(cycleDates({ ...card, dueRule: { kind: "day-of-month", value: 5 } }, "2024-02-29").dueDate).toBe("2024-03-05");
  expect(minimumEstimate(card, 10001)).toBe(2500);
  expect(minimumEstimate(card, 100)).toBe(100);
  expect(minimumEstimate({ ...card, minimumFloorMinor: 0 }, 10020)).toBe(251);
});

it("estimates a closed cycle by reversing later Actual activity, and never with incomplete reads (§7.1 #20)", () => {
  const read = snapshot([row({ id: "spend", date: "2026-11-01", amount: -5000 }), row({ id: "pay", date: "2026-11-04", amount: 2000 })], { from: "2026-08-01", to: "2026-11-10" });
  const [latest] = statementDrafts(card, "2026-11-10", 3, read, -13000);
  expect(latest).toMatchObject({ closingDate: "2026-10-31", balanceMinor: 10000, minimumKnown: true });
  expect(statementDrafts(card, "2026-11-10", 6, { ...read, issues: ["missing split"] }, -13000)).toEqual([]);
});

it("moves a single-tagged row across the cut-off in estimates, but never a transfer", () => {
  const read = snapshot([
    row({ id: "tagged", date: "2026-11-02", amount: -5000, notes: "#2026-10" }),
    transfer("pay", "2026-11-03", 2000, BANK_ACCOUNT, { notes: "#2026-10" }).card,
  ], { from: "2026-08-01", to: "2026-11-10" });
  const [latest] = statementDrafts(card, "2026-11-10", 1, read, -13000);
  expect(latest.balanceMinor).toBe(15000);
});

it("counts split children once and refuses missing structural amounts", () => {
  const parent = source({
    id: "parent", date: "2026-10-01", amount: -100, payeeName: "Shop", isParent: true,
    splitLines: [
      { id: "a", amount: -40, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, transferId: null },
      { id: "b", amount: -60, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null },
    ],
  });
  const result = normalizeActivity([parent, { ...parent, id: "a", amount: -40, isParent: false, isChild: true, parentId: "parent", splitLines: [] }]);
  expect(result.rows.map((entry) => entry.amountMinor)).toEqual([-40, -60]);
  expect(result.rows[1].cleared).toBeNull();
  expect(result.rows[0].label).toBe("Shop");
  expect(normalizeActivity([{ ...parent, splitLines: [] }]).issues).toHaveLength(1);
});

it("gives a row the same identity through clearing, category and notes edits, and a new one on a sign change", () => {
  const before = row({ id: "spend", date: "2026-10-01", amount: -5000, cleared: false });
  const after = row({ id: "spend", date: "2026-10-01", amount: -5000, cleared: true, categoryId: "food", notes: "lunch" });
  expect(after.fingerprint).toBe(before.fingerprint);
  expect(after.identity).toBe(before.identity);
  expect(after.evidenceFingerprint).not.toBe(before.evidenceFingerprint);
  expect(row({ id: "spend", date: "2026-10-02", amount: -5100 }).identity).toBe(before.identity);
  expect(row({ id: "spend", date: "2026-10-01", amount: 5000 }).identity).not.toBe(before.identity);
});

it.each(["browser-api", "http-api"] as const)("reads bounded transactions with counterpart evidence through %s", async (mode) => {
  const card = source({ id: "p", date: "2026-10-10", amount: 1000, payeeName: "Transfer", transferId: "peer" });
  const list = jest.fn().mockResolvedValue([card]);
  const query = jest.fn().mockResolvedValue([{ ...card, id: "peer", accountId: "bank", amount: -1000, transferId: "p" }]);
  const read = await readCardActivity({
    getSyncCapabilities: () => getBudgetFileSyncCapabilities({ mode }),
    listTransactionsForSync: list,
    queryTransactionsForSync: query,
    canVerifyTransferLinks: async () => true,
  }, CARD_ACCOUNT, "2026-10-01", "2026-10-31");
  expect(list).toHaveBeenCalledWith({ accountId: CARD_ACCOUNT, startDate: "2026-10-01" });
  expect(query).toHaveBeenCalledWith({ ids: ["peer"], resolveNames: false });
  expect(read.counterparts[0].amountMinor).toBe(-1000);
});

it("refuses reads without split support, and keeps reads when funding details fail", async () => {
  const list = jest.fn().mockResolvedValue([]);
  const http = getBudgetFileSyncCapabilities({ mode: "http-api" });
  const unsupported = { ...http, capabilities: { ...http.capabilities, readSplitLines: false } };
  await expect(readCardActivity({ getSyncCapabilities: () => unsupported, listTransactionsForSync: list }, CARD_ACCOUNT, "2026-10-01", "2026-10-31"))
    .rejects.toThrow("complete card activity");
  expect(list).not.toHaveBeenCalled();
  const payment: SyncSourceTransaction = source({ id: "payment", date: "2026-10-10", amount: 10000, transferId: "peer" });
  const read = await readCardActivity({
    getSyncCapabilities: () => http,
    listTransactionsForSync: jest.fn().mockResolvedValue([payment]),
    queryTransactionsForSync: jest.fn().mockRejectedValue(new Error("unavailable")),
    canVerifyTransferLinks: async () => true,
  }, CARD_ACCOUNT, "2026-10-01", "2026-10-31");
  expect(read.rows).toHaveLength(1);
  expect(read.counterparts).toEqual([]);
  expect(read.issues).toEqual([]);
});

it("aligns Direct's local cutoff to a different requested card day without adjusting future entries twice", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  // Pin the runtime's own time zone, so the native date is 16 Oct on any host (UTC+12 and later included).
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  const zone = jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockImplementation(function (this: Intl.DateTimeFormat) { return { ...resolved.call(this), timeZone: "UTC" }; });
  try {
    const transaction = source({ id: "boundary", accountId: "card-a", date: "2026-10-17", amount: -10000 });
    const transport = {
      getSyncCapabilities: () => ({ mode: "browser-api", capabilities: { listTransactions: true, readSplitLines: true } }),
      listTransactionsForSync: async () => [transaction],
      canVerifyTransferLinks: async () => true,
    } as unknown as ActualBenchTransport;
    const ahead = await readCardActivity(transport, "card-a", "2026-01-01", "2026-10-17");
    expect(asOfCardBalance(cardBalance(-1000), ahead.futureDeltaMinor, true, ahead.directBalanceAdjustmentMinor).debtMinor).toBe(110000);
    const yesterday = { ...transport, listTransactionsForSync: async () => [{ ...transaction, date: "2026-10-16" }] } as unknown as ActualBenchTransport;
    const behind = await readCardActivity(yesterday, "card-a", "2026-01-01", "2026-10-15");
    expect(asOfCardBalance(cardBalance(-1100), behind.futureDeltaMinor, true, behind.directBalanceAdjustmentMinor).debtMinor).toBe(100000);
  } finally {
    zone.mockRestore();
    jest.useRealTimers();
  }
});

it("matches complete month tags only and deduplicates them", () => {
  expect(statementTags("#2026-09 #2026-09 #2026-13 x#2026-08 #2026-07a (#2026-06)")).toEqual(["2026-09", "2026-06"]);
});

it("reviews tags across the cut-off: one tag decides, conflicting tags ask", () => {
  const { workspace, saved } = setup({}, [facts("2026-03-10", 0, { previousBalanceMinor: 0 })]);
  const read = snapshot([
    row({ id: "tagged-in", date: "2026-03-12", amount: -100, notes: "#2026-03" }),
    row({ id: "tagged-out", date: "2026-03-09", amount: -100, notes: "#2026-04" }),
    row({ id: "conflict", date: "2026-03-05", amount: -100, notes: "#2026-03 #2026-04" }),
    row({ id: "boundary", date: "2026-03-10", amount: -100 }),
  ]);
  const review = statementReview(saved[0], workspace(), read);
  const decision = (id: string) => review.memberships[review.rows.findIndex((entry) => entry.id === id)].decision;
  expect([decision("tagged-in"), decision("tagged-out"), decision("conflict"), decision("boundary")]).toEqual(["included", "excluded", "review", "review"]);
});

it("explains new activity since the statement, excluding rows the bank already billed", () => {
  const { store, workspace, saved, card } = setup({}, [facts("2026-03-10", 50000, { previousBalanceMinor: 0 })]);
  const late = row({ id: "late", date: "2026-03-10", amount: -50000 });
  const after = row({ id: "after", date: "2026-03-15", amount: -2000, cleared: false });
  const pay = transfer("pay", "2026-03-20", 50000, BANK_ACCOUNT);
  const read = snapshot([late, after, pay.card]);
  store.getState().saveReview("budget", saved[0].id, 1, read, [{ transactionId: "late", decision: "included", bankPostingDate: null, note: null }]);
  const bridge = netActivitySinceStatement(card(), workspace().statements[0], workspace(), read, 48000 - 50000, "2026-03-31");
  expect(bridge.rows.map((entry) => entry.id)).toEqual(["after", "pay"]);
  expect(bridge).toMatchObject({ netMinor: -48000, pendingCount: 1, covered: true });
});

it("labels reciprocal on-budget transfers without inventing an expense category", () => {
  const pay = transfer("pay", "2026-03-20", 50000, BANK_ACCOUNT);
  const read = snapshot([pay.card, pay.peer]);
  expect(activityCategoryLabel(read.rows[0], read)).toBe("Transfer");
  expect(activityCategoryLabel(row({ id: "x", date: "2026-03-01", amount: -1 }), read)).toBe("Uncategorized");
});

it("weights APR by debt only over cards with a rate, never inventing one", () => {
  const cards = [card, { ...card, id: "d", accountId: "d", purchaseAprBps: null }];
  const balances = new Map([[card.accountId, { debtMinor: 10000, creditMinor: 0 }], ["d", { debtMinor: 30000, creditMinor: 0 }]]);
  expect(portfolio(cards, balances)).toMatchObject({ debtMinor: 40000, weightedAprBps: 2400, aprCoveredDebtMinor: 10000, balanceCoverage: 2 });
});

it("sums minor amounts exactly on the fast path and falls back to BigInt when a running total leaves the safe range", () => {
  const values = Array.from({ length: 5000 }, (_, index) => (index % 2 ? -1 : 1) * (index * 7919 % 1_000_000));
  const bigint = Number(values.reduce((total, value) => total + BigInt(value), BigInt(0)));
  expect(sumMinor(values)).toBe(bigint);
  expect(safeIntegerSum([Number.MAX_SAFE_INTEGER, 1, -2])).toBeNull();
  expect(sumMinor([Number.MAX_SAFE_INTEGER, 1, -2])).toBe(Number.MAX_SAFE_INTEGER - 1);
  expect(() => sumMinor([0.5])).toThrow();
  expect(sumMinor([])).toBe(0);
});
