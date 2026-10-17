import { transferPlanScenario } from "./planTracking.fixture";
import { activityCategoryLabel, activityKind, readCardActivity, type ActivityRow } from "./activity";
import { cardBalance, asOfCardBalance } from "./financialAdapter";
import { observedChargeTotals } from "./history";
import { createCreditCardStore } from "./memory";
import { paymentEffects } from "./paymentEffects";
import { statementOutcome } from "./paymentSummary";
import { statementChargeBreakdown } from "./planReporting";
import { trackedCardDebt, trackedDebtPoints, trackingBalance } from "./planTracking";
import { settlements } from "./repayments";
import { statementReview } from "./statements";
import type { ActualBenchTransport } from "@/lib/actual/transport";

const scenario = () => transferPlanScenario();
const entry = (label: string, amountMinor = -1000): ActivityRow => ({ id: label, label, date: "2026-10-12", accountId: "card-a", amountMinor, fingerprint: label, notes: null, categoryId: null, categoryName: null, transferId: null, transferKnown: true, cleared: true, parentId: null });

it("recognizes useful bank families, preserves costs and always supplies a fallback without extending payment eligibility", () => {
  const { cards, sources, workspace } = scenario();
  const examples: [string, number, string][] = [
    ["POS retailer", -100, "purchase"], ["Streaming subscription", -100, "purchase"],
    ["ATM CASH", -100, "cash-advance"], ["CASH ON CARD", -100, "money-transfer"], ["FlexiPay", -100, "plan-instalment"], ["CARD TO BANK", -100, "money-transfer"],
    ["FINANCE CHARGE", -100, "interest"], ["PROFIT", -100, "interest"], ["JUROS", -100, "interest"],
    ["ANNUAL FEE", -100, "fee"], ["VAT ON FEE", -100, "fee"], ["CASH ADVANCE FEE", -100, "fee"],
    ["PAYMENT RECEIVED THANK YOU", 100, "refund"], ["RETURNED PAYMENT", -100, "adjustment"],
    ["REFUND CREDIT NOTE", 100, "refund"], ["PROVISIONAL CREDIT", 100, "dispute-credit"],
    ["CHARGEBACK REDEBIT", -100, "dispute-adjustment"], ["REWARDS CREDIT", 100, "cashback"],
    ["EMI 3/12", -100, "plan-instalment"], ["قسط", -100, "plan-instalment"],
    ["PARCELAMENTO DA FATURA", -100, "plan-instalment"], ["EPP CONVERSION", 100, "plan-conversion"],
    ["BALANCE TRANSFER TO PLAN", 100, "plan-conversion"], ["BTP", -100, "balance-transfer"],
    ["GOODWILL", 100, "adjustment"], ["FEE WAIVER", 100, "fee-refund"],
    ["INTEREST REFUND", 100, "interest-refund"], ["PAYMENT 03/12", -100, "purchase"],
    ["Original purchase zero-interest six-month plan", -3000000, "purchase"],
    ["Unknown merchant", -100, "purchase"], ["Unknown credit", 100, "refund"], ["Zero", 0, "adjustment"],
  ];
  for (const [label, amount, kind] of examples) expect([label, activityKind(entry(label, amount), cards[0], workspace, sources[0])]).toEqual([label, kind]);
  const conversion = { ...entry("Conversion; moves principal to off-budget account", 3000000), transferId: "plan-peer" };
  expect(activityKind(conversion, cards[0], workspace, sources[0])).toBe("plan-conversion");
  const incoming = { ...entry("PAYMENT RECEIVED", 100), transferId: "external" };
  expect(activityKind(incoming, cards[0], workspace, sources[0])).toBe("payment");
  const store = createCreditCardStore(); store.setState({ workspaces: { test: workspace } });
  const cash = entry("Teller payment", 100);
  expect(() => store.getState().classify("test", "a", 1, { ...sources[0], rows: [cash] }, { cardId: "a", transactionId: cash.id, fingerprint: cash.fingerprint, kind: "payment", reason: "Teller" })).toThrow("external Actual transfer");
});

it("nets cost refunds once, even with plan links, and keeps combined bills separate from new purchases", () => {
  const { cards, workspace, sources } = scenario();
  const rows = [entry("Groceries", -4500), entry("EMI 1/6", -20000), entry("PLAN INTEREST", -1000), entry("INTEREST REFUND", 200), entry("PLAN FEE", -500), entry("FEE WAIVER", 100), entry("Merchant refund", 300)];
  const statement = { ...workspace.statements[4], id: "costs", periodStart: "2026-10-01", closingDate: "2026-10-31", openingAnchor: true, openingBalanceMinor: 0, officialBalanceMinor: 25400 };
  const candidate = { ...workspace, statements: [statement], memberships: [], planLinks: [{ planId: "a", transactionId: "PLAN INTEREST", fingerprint: "PLAN INTEREST", role: "plan-interest" as const, instalment: null }] };
  const source = { ...sources[0], rows, to: "2026-10-31" };
  expect(statementChargeBreakdown(cards[0], statement, candidate, source)).toMatchObject({ newChargesMinor: 4500, planChargesMinor: 20000, otherCostsMinor: 1200, creditsMinor: 300 });
  expect(observedChargeTotals(cards[0], candidate, source, source.to, "interest")).toMatchObject({ totalMinor: 800, grossMinor: 1000, refundsMinor: 200 });
  expect(observedChargeTotals(cards[0], candidate, source, source.to, "fee")).toMatchObject({ totalMinor: 400, grossMinor: 500, refundsMinor: 100 });
});

it("pays a smaller monthly target without declaring remaining full debt overdue or paid off", () => {
  const { cards, workspace, sources } = scenario();
  const statement = { ...workspace.statements[4], officialBalanceMinor: 3000000, totalPaymentDueMinor: 500000, minimumDueMinor: 10000 };
  const payment = { ...entry("Checking", 500000), date: "2026-11-02", transferId: "cash" };
  const source = { ...sources[0], rows: [payment], to: "2026-11-05" };
  const candidate = { ...workspace, statements: [statement] };
  const statuses = settlements(cards[0], candidate, source, "2026-11-05");
  expect(statuses[0]).toMatchObject({ targetRemainingMinor: 0, fullRemainingMinor: 2500000, targetByDue: true });
  expect(statementOutcome(statement, statuses[0], "2026-11-05", true)).toMatchObject({ label: "Paid this month", overdue: false, carried: false });
  expect(paymentEffects(cards[0], candidate, source, statuses, "2026-11-05").get(payment.id)).toMatchObject({ label: "Meets monthly target", remainingMinor: 0 });
  const store = createCreditCardStore(); store.setState({ workspaces: { test: candidate } });
  store.getState().correctStatement("test", statement.id, statement.revision, { periodStart: statement.periodStart, closingDate: statement.closingDate, dueDate: statement.dueDate, officialBalanceMinor: statement.officialBalanceMinor, minimumDueMinor: statement.minimumDueMinor });
  const reset = store.getState().workspaces.test;
  expect(reset.statements[0].totalPaymentDueMinor).toBeUndefined();
  expect(settlements(cards[0], reset, source, "2026-11-05")[0].targetRemainingMinor).toBe(2500000);
});

it("keeps a matched bill valid as new cutoff rows appear, then offers them to the next bill once", () => {
  const { cards, sources } = scenario();
  const store = createCreditCardStore(); store.setState({ workspaces: { test: { cards: [{ ...cards[0], firstTrackedStatementDate: null }], statements: [], memberships: [], allocations: [], classifications: [] } } });
  const statement = store.getState().recordOpeningStatement("test", "a", 1, { periodStart: "2026-09-09", closingDate: "2026-10-08", dueDate: "2026-11-02", officialBalanceMinor: 5000, minimumDueMinor: 1000, openingBalanceMinor: 0 });
  const source = { ...sources[0], rows: [{ ...entry("Printed purchase", -5000), date: "2026-10-08", notes: "#2026-10" }], to: "2026-10-08" };
  store.getState().saveReview("test", statement.id, 1, source, [], true);
  const saved = store.getState().workspaces.test;
  const late = { ...source, to: "2026-10-10", rows: [...source.rows, { ...entry("Not on bill", -1500), date: "2026-10-07" }] };
  expect(statementReview(saved.statements[0], saved, late)).toMatchObject({ canVerify: true, stale: false, varianceMinor: 0 });
  const next = { ...saved.statements[0], id: "next", periodStart: "2026-10-09", closingDate: "2026-11-08", officialBalanceMinor: 6500, openingAnchor: false, verification: "recorded" as const, reviewedSnapshot: null };
  const decision = { statementId: statement.id, cardId: "a", transactionId: late.rows[1].id, fingerprint: late.rows[1].fingerprint, decision: "excluded" as const, provenance: "manual" as const, bankPostingDate: null, reason: "Not on bill" };
  const review = statementReview(next, { ...saved, statements: [...saved.statements, next], memberships: [decision] }, { ...late, to: "2026-11-08" });
  expect(review.memberships.find((row) => row.transactionId === late.rows[1].id)?.decision).toBe("included");
  expect(review.varianceMinor).toBe(0);
});

it("supports tag-free shared accounts and differently dated or cleared transfer legs without a duplicate debt jump", () => {
  const { cards, workspace, sources } = scenario();
  const plans = workspace.plans!.map((plan) => ({ ...plan, tracking: { ...plan.tracking!, tag: "" } }));
  const candidate = { ...workspace, plans };
  const source = sources[0];
  const changed = { ...source, trackingAccounts: source.trackingAccounts!.map((account) => ({ ...account, rows: account.rows.map((row) => row.id === "instalment-a-10-peer" ? { ...row, date: "2026-10-09", cleared: false } : row) })), counterparts: source.counterparts.map((row) => row.id === "instalment-a-10-peer" ? { ...row, date: "2026-10-09", cleared: false } : row) };
  expect(trackingBalance(plans[0], changed, "2026-10-16", candidate.planLinks)?.signedMinor).toBe(-1000000);
  const points = trackedDebtPoints(cards[0], candidate, changed, -450000, ["2026-10-07", "2026-10-08", "2026-10-09"]);
  expect(points.map((point) => point.value)).toEqual([1500000, 1500000, 1500000]);
  expect(trackedCardDebt(cards[0], candidate, changed, -450000, "2026-10-16")).toMatchObject({ known: true, debtMinor: 1450000, confirmedDebtMinor: 1550000, problems: [] });
});

it("saves existing balance-only plans and multiple originals while preserving principal and ownership guards", () => {
  const { cards, workspace, sources, plans } = scenario();
  const store = createCreditCardStore(); store.setState({ workspaces: { test: { ...workspace, plans: [], planLinks: [] } } });
  const source = sources[0];
  const opening = { date: "2026-10-08", principalMinor: 1000000 };
  const existing = { ...plans[0], transactionId: null, fingerprint: null, sourceTransactions: [], sourceMode: "existing", balanceOnly: true, monthlyMinor: null, reference: "Existing agreement", tracking: { accountId: "tracking", tag: "", opening } };
  store.getState().savePlan("test", "a", 1, source, existing, []);
  expect(trackedCardDebt(cards[0], store.getState().workspaces.test, source, -450000, "2026-10-16").debtMinor).toBe(1450000);
  expect(() => store.getState().deletePlan("test", "a", 1, 2, source)).toThrow("remaining plan principal");
  const originals = source.rows.filter((row) => row.id === "purchase-a" || row.id === "ordinary");
  const multi = { ...plans[0], id: "new", sourceTransactions: originals.map((row) => ({ transactionId: row.id, fingerprint: row.fingerprint })), sourceMode: "new", startDate: "2026-10-10", firstDueDate: "2026-11-02", amountMinor: 3050000, tracking: undefined };
  store.getState().savePlan("test", "a", 2, source, multi, []);
  expect(store.getState().workspaces.test.plans?.find((plan) => plan.id === "new")?.sourceTransactions).toHaveLength(2);
  expect(() => store.getState().savePlan("test", "a", 3, source, { ...multi, amountMinor: 9000000 }, [])).toThrow("original charges");
});

it.each(["browser-api", "http-api"] as const)("uses %s balance semantics once for future purchases and payments", async (mode) => {
  const futurePurchase = { id: "future", accountId: "card-a", date: "2027-01-10", amount: -10000, splitLines: [], payeeId: null, notes: null };
  const transport = { getSyncCapabilities: () => ({ mode, capabilities: { listTransactions: true, readSplitLines: true } }), listTransactionsForSync: async () => [futurePurchase], canVerifyTransferLinks: async () => true } as unknown as ActualBenchTransport;
  const source = await readCardActivity(transport, "card-a", "2026-01-01", "2026-10-16");
  const live = cardBalance(mode === "browser-api" ? -1000 : -1100);
  expect(asOfCardBalance(live, source.futureDeltaMinor, mode === "browser-api")).toMatchObject({ signedBalanceMinor: -100000, debtMinor: 100000 });
  expect(source.rows).toEqual([]);
  const paymentSource = { ...source, futureDeltaMinor: 20000 };
  expect(asOfCardBalance(cardBalance(mode === "browser-api" ? -1000 : -800), paymentSource.futureDeltaMinor, mode === "browser-api").debtMinor).toBe(100000);
});

it("aligns Direct’s local cutoff to a different requested card day without adjusting future entries twice", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  try {
    const transaction = { id: "boundary", accountId: "card-a", date: "2026-10-17", amount: -10000, splitLines: [], payeeId: null, notes: null };
    const transport = { getSyncCapabilities: () => ({ mode: "browser-api", capabilities: { listTransactions: true, readSplitLines: true } }), listTransactionsForSync: async () => [transaction], canVerifyTransferLinks: async () => true } as unknown as ActualBenchTransport;
    const ahead = await readCardActivity(transport, "card-a", "2026-01-01", "2026-10-17");
    expect(asOfCardBalance(cardBalance(-1000), ahead.futureDeltaMinor, true, ahead.directBalanceAdjustmentMinor).debtMinor).toBe(110000);
    const yesterdayTransport = { ...transport, listTransactionsForSync: async () => [{ ...transaction, date: "2026-10-16" }] } as unknown as ActualBenchTransport;
    const behind = await readCardActivity(yesterdayTransport, "card-a", "2026-01-01", "2026-10-15");
    expect(asOfCardBalance(cardBalance(-1100), behind.futureDeltaMinor, true, behind.directBalanceAdjustmentMinor).debtMinor).toBe(100000);
  } finally { jest.useRealTimers(); }
});

it("labels reciprocal on-budget transfers without inventing an expense category", () => {
  const { sources } = scenario();
  const source = sources[0];
  const row = source.rows.find((entry) => entry.id === "cash-a-10")!;
  const accounts = [{ id: "card-a", name: "Card", offBudget: false }, { id: "funding", name: "Checking", offBudget: false }];
  expect(activityCategoryLabel(row, { ...source, accounts })).toBe("Transfer");
  expect(activityCategoryLabel(row, { ...source, accounts: accounts.map((account) => ({ ...account, offBudget: account.id === "funding" })) })).toBe("Uncategorized");
  expect(activityCategoryLabel({ ...row, categoryName: "Real category" }, { ...source, accounts })).toBe("Real category");
});
