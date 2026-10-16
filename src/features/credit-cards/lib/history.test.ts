import { cardInputSchema, type Workspace } from "./models";
import { normalizeActivity, type ActivitySnapshot } from "./activity";
import { statementDrafts } from "./statements";
import { observedChargeTotals, observedInterestTotals, statementHistory, statementMovement, cumulativeInterestCharges } from "./history";
import { settlements } from "./repayments";

const card = { ...cardInputSchema.parse({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC", closingDay: 31, dueRule: { kind: "day-of-month", day: 1 } }), id: "c", revision: 1 };
const statement = { id: "s", cardId: card.id, periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-01", officialBalanceMinor: 82500, minimumDueMinor: 2500, bankConfirmed: true, revision: 1, lifecycle: "recorded" as const, verification: "recorded" as const, coverage: "bounded" as const, openingAnchor: true, reviewedSnapshot: null };
const workspace: Workspace = { cards: [card], statements: [statement], memberships: [], classifications: [], allocations: [] };
function source(): ActivitySnapshot {
  const normalized = normalizeActivity([
    { id: "spend", accountId: "card", date: "2026-09-10", amount: -80000, categoryId: "purchases", cleared: true, notes: "#2026-09" },
    { id: "interest", accountId: "card", date: "2026-09-20", amount: -2500, categoryId: "interest", cleared: true, notes: "#2026-09" },
    { id: "pay", accountId: "card", date: "2026-10-04", amount: 82500, transferId: "funding", cleared: true, notes: "#2026-01" },
  ].map((row) => ({ payeeId: null, payeeName: null, categoryName: null, reconciled: false, importedId: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], categoryId: null, ...row })));
  return { ...normalized, accountId: "card", from: "2025-01-01", to: "2026-10-10", counterparts: [], fetchedAt: "2026-10-10", signature: "snapshot" };
}

it("omits fabricated zero periods before first activity, while retaining zero cycles in known history", () => {
  const snapshot = source();
  const drafts = statementDrafts(card, "2026-10-10", 24, snapshot, 0);
  expect(drafts.map((entry) => entry.closingDate)).toEqual(["2026-09-30"]);
  const later = statementDrafts(card, "2026-11-10", 24, { ...snapshot, to: "2026-11-10" }, 0);
  expect(later[0]).toMatchObject({ closingDate: "2026-10-31", officialBalanceMinor: 0 });
  expect(statementDrafts(card, "2026-10-10", 24, { ...snapshot, rows: [] }, 0)).toEqual([]);
});

it("keeps inferred opening debt but respects an explicit date opened", () => {
  expect(statementDrafts(card, "2026-10-10", 3, source(), -10000)).toHaveLength(3);
  expect(statementDrafts({ ...card, openedDate: "2026-09-01" }, "2026-10-10", 3, source(), -10000)).toHaveLength(1);
});

it("uses directional defaults until an interest category or correction identifies a cost", () => {
  expect(observedInterestTotals(card, workspace, source(), "2026-10-10").classificationKnown).toBe(true);
  const history = statementHistory(card, workspace, source(), "2026-10-10");
  expect(history[0]).toMatchObject({ covered: true, interestMinor: 0, feesMinor: 0, spendingMinor: 82500 });
  const configured = { ...card, interestCategoryId: "interest", feeCategoryId: "fees" };
  expect(observedInterestTotals(configured, workspace, source(), "2026-10-10")).toMatchObject({ classificationKnown: true, totalMinor: 2500, from: "2025-01-01", to: "2026-10-10" });
  expect(observedInterestTotals(configured, workspace, { ...source(), issues: ["Incomplete source"] }, "2026-10-10").classificationKnown).toBe(false);
  expect(statementHistory(configured, workspace, source(), "2026-10-10")[0]).toMatchObject({ interestMinor: 2500, feesMinor: 0, spendingMinor: 80000 });
});

it("recognizes complete individual classification without category mappings", () => {
  const snapshot = source();
  const classified = { ...workspace, classifications: snapshot.rows.filter((row) => row.amountMinor < 0).map((row) => ({ cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, kind: row.id === "interest" ? "interest" as const : "purchase" as const, reason: "Reviewed" })) };
  expect(observedInterestTotals(card, classified, snapshot, "2026-10-10")).toMatchObject({ classificationKnown: true, totalMinor: 2500 });
  const changed = { ...snapshot, rows: snapshot.rows.map((row) => ({ ...row, fingerprint: "changed" })) };
  expect(observedInterestTotals(card, classified, changed, "2026-10-10").classificationKnown).toBe(true);
});

it("preserves lateness after full settlement, including in debt history", () => {
  expect(settlements(card, workspace, source(), "2026-10-10")[0]).toMatchObject({ status: "Paid late", delayDays: 3, fullRemainingMinor: 0 });
  expect(statementHistory(card, workspace, source(), "2026-10-10")[0].settlement.status).toBe("Paid late");
});

it("accumulates observed charges chronologically and refuses unknown coverage", () => {
  const mapped = { ...card, interestCategoryId: "interest", feeCategoryId: "fees" };
  const history = statementHistory(mapped, workspace, source(), "2026-10-10");
  const older = { ...history[0], statement: { ...statement, id: "older", closingDate: "2026-08-31" }, interestMinor: 1000 };
  expect(cumulativeInterestCharges([...history, older])).toEqual([{ date: "2026-08-31", value: 1000 }, { date: "2026-09-30", value: 3500 }]);
  expect(cumulativeInterestCharges([...history, { ...older, interestMinor: null }])).toEqual([{ date: "2026-08-31", value: null }, { date: "2026-09-30", value: null }]);
});

it("keeps post-closing repayments out of the billing-cycle balance bridge", () => {
  const mapped = { ...card, interestCategoryId: "interest", feeCategoryId: "fees" };
  const snapshot = source();
  const movement = statementMovement(mapped, statement, workspace, snapshot);
  expect(movement).toMatchObject({ openingMinor: null, purchasesMinor: 80000, interestMinor: 2500, feesMinor: 0, paymentsMinor: 0, refundsMinor: 0 });
  const changed = { ...snapshot, rows: snapshot.rows.map((row) => row.id === "pay" ? { ...row, date: "2026-09-15", fingerprint: "cycle-payment" } : row) };
  expect(statementMovement(mapped, statement, workspace, changed).paymentsMinor).toBe(-82500);
});

it("reconciles the cycle bridge from the preceding bank balance and preserves pending classification uncertainty", () => {
  const mapped = { ...card, interestCategoryId: "interest", feeCategoryId: "fees" };
  const prior = { ...statement, id: "prior", periodStart: "2026-08-01", closingDate: "2026-08-31" };
  const continuous = { ...workspace, statements: [prior, statement] };
  const snapshot = { ...source(), rows: source().rows.map((row) => row.id === "pay" ? { ...row, date: "2026-09-15", fingerprint: "cycle-pay" } : row) };
  expect(statementMovement(mapped, statement, continuous, snapshot)).toMatchObject({ openingMinor: 82500, purchasesMinor: 80000, interestMinor: 2500, paymentsMinor: -82500, calculatedMinor: 82500, varianceMinor: 0 });
  const pending = { ...snapshot, rows: snapshot.rows.map((row) => row.amountMinor < 0 ? { ...row, cleared: false } : row) };
  expect(statementMovement(card, statement, continuous, pending)).toMatchObject({ interestMinor: 0, purchasesMinor: 82500, unclassifiedMinor: 0 });
});

 it("reports only the available posting-date range, including cross-year history", () => {
  const configured = { ...card, interestCategoryId: "interest" };
  const snapshot = source();
  const original = snapshot.rows.find((row) => row.id === "interest")!;
  const rows = [{ ...original, id: "old", date: "2025-12-20" }, { ...original, date: "2026-01-20" }, { ...original, id: "future", date: "2026-03-20" }];
  expect(observedInterestTotals(configured, workspace, { ...snapshot, rows, from: "2025-12-01", to: "2026-02-01" }, "2026-02-10")).toMatchObject({ totalMinor: 5000, from: "2025-12-01", to: "2026-02-01" });
  expect(observedInterestTotals(configured, workspace, { ...snapshot, rows, from: "2026-01-01", to: "2026-02-01" }, "2026-02-10").totalMinor).toBe(2500);
});

it("keeps unclassified transfer charges in arithmetic without affecting bank verification", () => {
  const ambiguous = { ...source(), rows: source().rows.filter((row) => row.id !== "pay").map((row) => ({ ...row, transferId: "unknown-peer", notes: null })) };
  const starting = { ...statement, openingBalanceMinor: 0 };
  const state = { ...workspace, statements: [starting] };
  const movement = statementMovement(card, starting, state, ambiguous);
  expect(movement).toMatchObject({ purchasesMinor: 0, unclassifiedMinor: 0, otherMinor: 82500, calculatedMinor: 82500, varianceMinor: 0, unavailableReason: null });
});

it("keeps the explicitly tracked empty opening cycle without inventing earlier history", () => {
  const tracked = { ...card, firstTrackedStatementDate: "2026-08-31" };
  const drafts = statementDrafts(tracked, "2026-10-10", undefined, source(), 0);
  expect(drafts.map((entry) => entry.closingDate)).toEqual(["2026-09-30", "2026-08-31"]);
  expect(drafts[1].officialBalanceMinor).toBe(0);
  expect(statementDrafts(tracked, "2026-10-10", undefined, { ...source(), rows: [] }, 0)).toEqual([expect.objectContaining({ closingDate: "2026-08-31", officialBalanceMinor: 0 })]);
});

it("retains an explicitly tracked bank closing-date exception as the opening cycle", () => {
  const tracked = { ...card, firstTrackedStatementDate: "2026-08-30" };
  const drafts = statementDrafts(tracked, "2026-10-10", undefined, source(), 0);
  expect(drafts.some((entry) => entry.closingDate === "2026-08-30")).toBe(true);
  expect(drafts.some((entry) => entry.closingDate < "2026-08-30")).toBe(false);
});


it("includes plan instalments and other charges in new charges without counting fees twice", () => {
  const snapshot = source();
  const spending = snapshot.rows.find((row) => row.id === "spend")!;
  const configured = { ...card, interestCategoryId: "interest", feeCategoryId: "fees" };
  const planWorkspace: Workspace = { ...workspace, cards: [configured], planLinks: [{ planId: "plan", transactionId: spending.id, fingerprint: spending.fingerprint, role: "instalment-billed", instalment: 1 }] };
  expect(statementHistory(configured, planWorkspace, snapshot, "2026-10-10")[0]).toMatchObject({ spendingMinor: 0, interestMinor: 2500, feesMinor: 0 });
});


it("uses the same reporting window and cleared evidence for interest and fees", () => {
  const base = source();
  const configured = { ...card, interestCategoryId: "interest", feeCategoryId: "fees" };
  const fee = { ...base.rows[0], id: "fee", fingerprint: "fee", amountMinor: -500, categoryId: "fees", date: "2026-09-15" };
  const snapshot = { ...base, from: "2026-09-01", to: "2026-09-30", rows: [...base.rows, fee, { ...fee, id: "earlier", date: "2026-08-31" }, { ...fee, id: "later", date: "2026-10-01" }, { ...fee, id: "pending", cleared: false }] };
  expect(observedChargeTotals(configured, workspace, snapshot, "2026-10-10", "fee")).toMatchObject({ totalMinor: 500, classificationKnown: true, from: "2026-09-01", to: "2026-09-30" });
  expect(observedInterestTotals(configured, workspace, snapshot, "2026-10-10").totalMinor).toBe(2500);
  expect(observedChargeTotals(configured, workspace, { ...snapshot, issues: ["Incomplete source"] }, "2026-10-10", "fee").classificationKnown).toBe(false);
});
