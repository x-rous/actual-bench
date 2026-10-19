import { commonCoverage, paymentTotalsDetail, portfolioInterestTrend, portfolioStatementTrend } from "./portfolioView";
import { createCreditCardStore } from "./store/store";
import { normalizeActivity, type ActivitySnapshot } from "./activity";
import { addStatement, addCard, source } from "./fixtures/testKit";

function fixture(count: number) {
  const store = createCreditCardStore();
  const cards = Array.from({ length: count }, (_, index) => addCard(store, {
    budgetSyncId: "budget", accountId: `account-${index}`, interestCategoryId: "interest", bankTimeZone: "UTC",
  }));
  const statements = cards.flatMap((card, index) => [
    addStatement(store, "budget", card.id, { periodStart: "2026-07-01", closingDate: "2026-07-31", dueDate: "2026-08-20", balanceMinor: 10000, minimumDueMinor: 1000 }),
    addStatement(store, "budget", card.id, { periodStart: "2026-08-01", closingDate: index % 2 ? "2026-08-25" : "2026-08-31", dueDate: "2026-09-20", balanceMinor: 12000, minimumDueMinor: 1000 }),
  ]);
  const sources: ActivitySnapshot[] = cards.map((card) => ({
    accountId: card.accountId, from: "2026-07-01", to: "2026-08-31",
    rows: normalizeActivity(["2026-07-12", "2026-08-12"].map((date, index) => source({
      id: `${card.id}-${index}`, accountId: card.accountId, date, amount: -250, categoryId: "interest", payeeName: "Interest charge",
    }))).rows,
    counterparts: [], issues: [], fetchedAt: "2026-09-01T00:00:00Z", signature: card.id,
  }));
  const names = new Map(cards.map((card, index) => [card.id, `Card ${index + 1}`]));
  return { cards, statements, sources, workspace: store.getState().workspaces.budget, nameOf: (card: { id: string }) => names.get(card.id)! };
}

it.each([1, 10])("labels monthly statements truthfully and reconciles observed interest for %i cards", (count) => {
  const { cards, statements, sources, workspace, nameOf } = fixture(count);
  const debt = portfolioStatementTrend(cards, statements, nameOf);
  expect(debt.map((point) => point.label)).toEqual(["Jul 2026", "Aug 2026"]);
  expect(debt.map((point) => point.value)).toEqual([10000 * count, 12000 * count]);
  expect(debt[1].breakdown[0].label).toBe("Card 1 · 31 Aug 2026");
  if (count > 1) expect(debt[1].breakdown[1].label).toContain("25 Aug 2026");
  const interest = portfolioInterestTrend(cards, workspace, sources, cards.map(() => "2026-09-01"), nameOf);
  expect(interest.map((point) => point.value)).toEqual([250 * count, 250 * count]);
});

it("keeps missing cards explicit and reports a common coverage range (CA-15)", () => {
  const { cards, statements, sources, workspace, nameOf } = fixture(2);
  expect(portfolioStatementTrend(cards, statements.filter((entry) => entry.id !== statements[3].id), nameOf)[1].value).toBeNull();
  const missing = portfolioInterestTrend(cards, workspace, [sources[0], undefined], ["2026-09-01", "2026-09-01"], nameOf);
  expect(missing.map((point) => point.value)).toEqual([250, 250]);
  expect(missing[0].source).toContain("1 of 2 cards · partial month");
  expect(missing[0].breakdown[1].value).toBeNull();
  const partial = [sources[0], { ...sources[1], from: "2026-07-15", to: "2026-08-20" }];
  expect(commonCoverage(partial, ["2026-09-01", "2026-09-01"])).toEqual({ from: "2026-07-15", to: "2026-08-20" });
  expect(commonCoverage([sources[0], undefined], ["2026-09-01", "2026-09-01"])).toBeNull();
});

it("omits zero KPI noise while exposing incomplete coverage and pending minimums", () => {
  const totals = { minimumMinor: 0, overdueMinimumMinor: 0, pendingMinor: 0, remainingMinor: 10000, coverage: 10, total: 10 };
  expect(paymentTotalsDetail(totals)).toBe("No minimum outstanding");
  expect(paymentTotalsDetail({ ...totals, coverage: 9 })).toBe("9 of 10 cards known; total is partial");
  expect(paymentTotalsDetail({ ...totals, minimumMinor: 2500, overdueMinimumMinor: 2500, pendingMinor: 1000 })).toBe("Minimum left 25.00 · Overdue 25.00 · Pending 10.00");
});
