import { portfolioInterestTrend, portfolioStatementTrend, paymentTotalsDetail } from "./portfolioView";
import { creditCardStore } from "./memory";
import type { ActivitySnapshot } from "./activity";

beforeEach(() => creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} }));
function fixture(count: number) {
  const store = creditCardStore.getState();
  const cards = Array.from({ length: count }, (_, index) => store.register({ budgetSyncId: "budget", accountId: `account-${index}`, nickname: `Card ${index + 1}`, issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, interestCategoryId: "interest", bankTimeZone: "UTC", status: "active" }));
  const statements = cards.flatMap((card, index) => {
    const first = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-07-01", closingDate: "2026-07-31", dueDate: "2026-08-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
    const second = store.recordStatement("budget", card.id, 2, { periodStart: "2026-08-01", closingDate: index % 2 ? "2026-08-25" : "2026-08-31", dueDate: "2026-09-20", officialBalanceMinor: 12000, minimumDueMinor: 1000 }, true);
    return [first, second];
  });
  const sources: ActivitySnapshot[] = cards.map((card) => ({ accountId: card.accountId, from: "2026-07-01", to: "2026-08-31", rows: ["2026-07-12", "2026-08-12"].map((date, index) => ({ id: `${card.id}-${index}`, accountId: card.accountId, date, amountMinor: -250, cleared: true, categoryId: "interest", categoryName: "Interest", label: "Interest charge", notes: null, transferId: null, transferKnown: true, parentId: null, fingerprint: `${card.id}-${index}` })), counterparts: [], issues: [], fetchedAt: "now", signature: "source" }));
  return { cards, statements, sources, workspace: creditCardStore.getState().workspaces.budget };
}

it.each([1, 10])("labels monthly snapshots truthfully and reconciles observed interest for %i cards", (count) => {
  const { cards, statements, sources, workspace } = fixture(count);
  const debt = portfolioStatementTrend(cards, statements);
  expect(debt.map((point) => point.label)).toEqual(["Jul 2026", "Aug 2026"]);
  expect(debt.map((point) => point.value)).toEqual([10000 * count, 12000 * count]);
  expect(debt[1].breakdown[0].label).toContain("31 Aug 2026");
  if (count > 1) expect(debt[1].breakdown[1].label).toContain("25 Aug 2026");
  const interest = portfolioInterestTrend(cards, workspace, sources, cards.map(() => "2026-09-01"));
  expect(interest.map((point) => point.value)).toEqual([250 * count, 250 * count]);
  expect(interest.reduce((sum, point) => sum + point.value!, 0)).toBe(500 * count);
});

it("shows identified charges with explicit partial coverage instead of hiding them for missing cards", () => {
  const { cards, statements, sources, workspace } = fixture(2);
  expect(portfolioStatementTrend(cards, statements.filter((entry) => entry.id !== statements[3].id))[1].value).toBeNull();
  const missing = portfolioInterestTrend(cards, workspace, [sources[0], undefined], ["2026-09-01", "2026-09-01"]);
  expect(missing.map((point) => point.value)).toEqual([250, 250]);
  expect(missing[0].source).toContain("1 of 2 cards classified; partial coverage");
  expect(missing[0].breakdown[1].value).toBeNull();
  expect(portfolioInterestTrend(cards, workspace, [undefined, undefined], ["2026-09-01", "2026-09-01"])).toEqual([]);
  const partial = portfolioInterestTrend(cards, workspace, [sources[0], { ...sources[1], from: "2026-07-15", to: "2026-08-20" }], ["2026-09-01", "2026-09-01"]);
  expect(partial.map((point) => point.value)).toEqual([250, 500]);
  const separate = portfolioInterestTrend(cards, workspace, [{ ...sources[0], to: "2026-07-31" }, { ...sources[1], from: "2026-08-01" }], ["2026-09-01", "2026-09-01"]);
  expect(separate.map((point) => point.value)).toEqual([250, 250]);
  expect(separate.every((point) => point.source.includes("partial coverage"))).toBe(true);
  expect(partial[0].breakdown[1].label).toContain("15 Jul 2026");
  expect(partial[1].breakdown[1].label).toContain("20 Aug 2026");
  expect(portfolioInterestTrend(cards, workspace, [sources[0], { ...sources[1], issues: ["Incomplete"] }], ["2026-09-01", "2026-09-01"])[0].value).toBe(250);
});

it("omits zero KPI noise while exposing incomplete coverage and pending minimums", () => {
  const totals = { minimumMinor: 0, overdueMinimumMinor: 0, pendingMinor: 0, remainingMinor: 10000, coverage: 10, total: 10 };
  expect(paymentTotalsDetail(totals)).toBe("No minimum payment outstanding");
  expect(paymentTotalsDetail({ ...totals, coverage: 9 })).toBe("9 of 10 cards confirmed; total is partial");
  expect(paymentTotalsDetail({ ...totals, minimumMinor: 2500, overdueMinimumMinor: 2500, pendingMinor: 1000 })).toBe("Minimum remaining 25.00 · Overdue minimum 25.00 · Pending 10.00");
});

it("combines explicit and description-based interest classifications with coverage detail", () => {
  const { cards, workspace, sources } = fixture(1);
  const card = { ...cards[0], interestCategoryId: null };
  const charge = sources[0].rows[0];
  const source = { ...sources[0], rows: [...sources[0].rows, { ...charge, id: "unknown", fingerprint: "unknown", categoryId: null }] };
  const classified = { ...workspace, classifications: [{ cardId: card.id, transactionId: charge.id, fingerprint: charge.fingerprint, kind: "interest" as const, reason: "Confirmed interest charge" }] };
  const points = portfolioInterestTrend([card], classified, [source], ["2026-09-01"]);
  expect(points[0].value).toBe(500);
  expect(points[0].source).toContain("1 of 1 cards classified");
  expect(points[0].breakdown[0].label).not.toContain("classification incomplete");
  expect(points[1].value).toBe(250);
});
