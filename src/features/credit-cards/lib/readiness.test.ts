import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { activityKind, normalizeActivity, paymentEvidence, type ActivityRow } from "./activity";
import { transferPlanScenario } from "./planTracking.fixture";
import { createCreditCardStore } from "./memory";
import { repaymentPlanSchema, type PlanLink } from "./models";
import { currentPlanLink, planHealth, planProgress, planProjection, planSchedule, refundEvidenceSignature, suggestPlanLink } from "./plans";
import { trackedCardDebt, trackedDebtPoints } from "./planTracking";
import { repaymentLedger, settlements } from "./repayments";
import { confirmedPaymentProgress } from "./paymentTargets";
import { paymentEffects } from "./paymentEffects";
import { asOfCardBalance, cardBalance } from "./financialAdapter";
import { cardReadSnapshot } from "./readModel";
import { statementDrafts, statementReview } from "./statements";
import { dailyBalanceHistory } from "./balanceHistory";
import { statementScenario } from "./statementScenarios.fixture";

function normalized(row: ActivityRow, patch: Partial<SyncSourceTransaction> = {}) {
  return normalizeActivity([{
    id: row.id, accountId: row.accountId, date: row.date, amount: row.amountMinor,
    notes: row.notes, payeeId: null, payeeName: row.label, categoryId: row.categoryId, categoryName: row.categoryName,
    cleared: row.cleared ?? false, transferId: row.transferId, parentId: row.parentId, splitLines: [],
    isParent: false, isChild: false, reconciled: false, importedId: null, importedPayee: null, ...patch,
  }]).rows[0];
}

it("uses one payment interpretation even when a funding transfer mentions annual fees", () => {
  const { cards, sources, workspace } = transferPlanScenario();
  const source = sources[0], card = cards[0];
  const original = source.rows.find((row) => row.id === "cash-a-10")!;
  const payment = normalized(original, { notes: "Annual fee payment", categoryId: "fees" });
  const snapshot = { ...source, rows: source.rows.map((row) => row.id === payment.id ? payment : row) };
  const configured = { ...card, feeCategoryId: "fees" };
  const candidate = { ...workspace, cards: [configured, cards[1]] };
  expect(activityKind(payment, configured, candidate, snapshot)).toBe("payment");
  expect(paymentEvidence(payment, snapshot, candidate)).toBe("confirmed");
  const statuses = settlements(configured, candidate, snapshot, "2026-10-16");
  expect(statuses.find((row) => row.statementId === "s-a-3")?.confirmedPaidMinor).toBe(800000);
  expect(paymentEffects(configured, candidate, snapshot, statuses, "2026-10-16").get(payment.id)?.label).toBe("Completes statement");
  expect(dailyBalanceHistory(configured, candidate, snapshot, -450000, "2026-10-16").events.find((event) => event.id === payment.id)).toMatchObject({ kind: "payment", pending: false });
  expect(activityKind({ ...payment, id: "refund", transferId: null }, configured, candidate, snapshot)).toBe("fee-refund");
});

it("retains classifications and explicit principal links when pending entries clear, but rejects changed money", () => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const source = sources[0], card = cards[0];
  const pending = normalized(source.rows.find((row) => row.id === "pending")!);
  const cleared = normalized(pending, { cleared: true });
  expect(cleared.fingerprint).toBe(pending.fingerprint);
  expect(cleared.evidenceFingerprint).not.toBe(pending.evidenceFingerprint);
  const classification = { cardId: card.id, transactionId: pending.id, fingerprint: pending.fingerprint, kind: "payment" as const, reason: "My confirmed source" };
  const candidate = { ...workspace, classifications: [classification] };
  const before = { ...source, rows: source.rows.map((row) => row.id === pending.id ? pending : row) };
  const after = { ...source, rows: source.rows.map((row) => row.id === pending.id ? cleared : row) };
  expect(activityKind(cleared, card, candidate, after)).toBe("payment");
  expect(confirmedPaymentProgress(workspace.statements[4], settlements(card, candidate, before, "2026-10-16")[4]).toPayMinor).toBe(500000);
  expect(confirmedPaymentProgress(workspace.statements[4], settlements(card, candidate, after, "2026-10-16")[4]).toPayMinor).toBe(400000);
  const principal = normalized(source.rows.find((row) => row.id === "instalment-a-10")!, { cleared: false });
  const link: PlanLink = { planId: plans[0].id, transactionId: principal.id, fingerprint: principal.fingerprint, role: "instalment-billed", instalment: 4 };
  expect(currentPlanLink({ ...workspace, planLinks: [link] }, normalized(principal, { cleared: true }))).toEqual(link);
  expect(currentPlanLink({ ...workspace, planLinks: [link] }, normalized(principal, { amount: principal.amountMinor - 1 }))).toBeUndefined();
  const merchant = normalized({ ...principal, transferId: null }, { notes: "private bank reference" });
  const updated = normalized(merchant, { notes: "edited reference", categoryId: "groceries" });
  expect(updated.fingerprint).toBe(merchant.fingerprint);
  expect(updated.evidenceFingerprint).not.toBe(merchant.evidenceFingerprint);
  expect(merchant.fingerprint).toMatch(/^cc-v1:[a-f0-9]{16}$/);
  expect(merchant.evidenceFingerprint).not.toContain("private bank reference");
});

it.each([{ date: "2026-08-09" }, { cleared: false }])("does not turn conflicting copies of principal transfers into known debt: %j", (patch) => {
  const { cards, sources, workspace } = transferPlanScenario();
  const source = sources[0];
  const mixed = { ...source, trackingAccounts: source.trackingAccounts!.map((account) => ({ ...account, rows: account.rows.map((row) => row.id === "instalment-a-8-peer" ? { ...row, ...patch } : row) })) };
  expect(trackedCardDebt(cards[0], workspace, mixed, -450000, "2026-10-16").known).toBe(false);
  expect(trackedDebtPoints(cards[0], workspace, mixed, -450000, ["2026-08-08", "2026-08-09"]).map((row) => row.value)).toEqual([null, null]);
});

it("skips earlier plan periods at an opening without inventing original amounts or schedule facts", () => {
  const { cards, plans, workspace, sources } = transferPlanScenario();
  const plan = repaymentPlanSchema.parse({ ...plans[0], sourceMode: "existing", sourceTransactions: [], opening: { date: "2026-10-08", principalMinor: 1000000 } });
  const progress = planProgress(plan, cards[0], []);
  expect(progress).toMatchObject({ earlier: 3, billedCount: 0, next: { date: "2026-11-02" } });
  expect(planHealth(plan, { ...workspace, plans: [plan], planLinks: [] }, sources[0], "2026-10-16").reasons).toEqual([]);
  const unknown = repaymentPlanSchema.parse({ ...plan, amountMinor: null, balanceOnly: true });
  expect(unknown).toMatchObject({ amountMinor: null, firstDueDate: null, months: null, monthlyMinor: null });
  expect(unknown).not.toHaveProperty("transactionId");
  expect(unknown.tracking).not.toHaveProperty("opening");
  expect(planProjection(unknown, cards[0]).rows).toEqual([]);
  expect(repaymentPlanSchema.parse(unknown)).toEqual(unknown);
});

it("uses revised totals consistently and never matches obsolete component amounts", () => {
  const { cards, plans, sources } = transferPlanScenario();
  const card = cards[0], base = { ...plans[0], tracking: undefined, recording: "instalments" as const, reference: "", monthlyFeeMinor: 5000, includesCosts: false };
  const links: PlanLink[] = [{ planId: base.id, transactionId: "refund", fingerprint: "refund", role: "refund", instalment: null }];
  const remaining = planProjection(base, card).rows.map((row) => ({ index: row.index, date: row.date, amountMinor: row.amountMinor - 20000 }));
  const revised = { ...base, refundReview: { treatment: "revised" as const, signature: refundEvidenceSignature(links), remaining } };
  const schedule = planSchedule(revised, card, links);
  expect(planProgress(revised, card, links).totalMinor).toBe(remaining.reduce((sum, row) => sum + row.amountMinor, 0));
  expect(schedule.every((row) => row.principalMinor === null && row.interestMinor === null && row.feeMinor === null)).toBe(true);
  const posting = { ...sources[0].rows[0], id: "new-bill", label: "Monthly purchase", notes: null, transferId: null, date: schedule[0].date, amountMinor: -500000 };
  expect(suggestPlanLink(posting, revised, card, links)).toBeNull();
  expect(suggestPlanLink({ ...posting, amountMinor: -schedule[0].amountMinor }, revised, card, links)?.instalment).toBe(1);
});

it("offsets every original in a multi-source conversion without residual origin debt or invented credit", () => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const card = cards[0], source = sources[0];
  const first = { ...source.rows[0], id: "first", date: "2026-06-10", amountMinor: -10000, transferId: null };
  const second = { ...first, id: "second", amountMinor: -20000 };
  const conversion = { ...first, id: "conversion", amountMinor: 30000 };
  const plan = { ...plans[0], amountMinor: 30000, sourceTransactions: [first, second].map((row) => ({ transactionId: row.id, fingerprint: row.fingerprint })) };
  const link: PlanLink = { planId: plan.id, transactionId: conversion.id, fingerprint: conversion.fingerprint, role: "conversion-credit", instalment: null };
  const result = repaymentLedger(card, { ...workspace, plans: [plan], planLinks: [link] }, { ...source, rows: [first, second, conversion] });
  expect(result.origins.map((origin) => origin.remainingMinor)).toEqual([0, 0]);
  expect(result.creditMinor).toBe(0);
});

it("rejects impossible allocations, cross-card plan moves and stale saves atomically", () => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const store = createCreditCardStore();
  const withoutAnchor = { ...workspace, statements: [] };
  store.setState({ workspaces: { test: withoutAnchor } });
  const payment = sources[0].rows.find((row) => row.id === "cash-a-10")!;
  const allocation = { cardId: cards[0].id, transactionId: payment.id, fingerprint: payment.fingerprint, originId: "nonexistent", amountMinor: 1, provenance: "manual", reason: "test" };
  expect(() => store.getState().allocate("test", cards[0].id, 1, sources[0], payment.id, [allocation])).toThrow("eligible debt origins");
  expect(store.getState().workspaces.test).toBe(withoutAnchor);
  store.setState({ workspaces: { test: workspace } });
  expect(() => store.getState().allocate("test", cards[0].id, 1, sources[0], payment.id, [allocation])).toThrow("eligible debt origins");
  expect(store.getState().workspaces.test).toBe(workspace);
  expect(() => store.getState().savePlan("test", cards[1].id, 1, sources[1], { ...plans[0], cardId: cards[1].id }, [])).toThrow("another card");
  expect(() => store.getState().savePlan("test", cards[0].id, 2, sources[0], plans[0], [])).toThrow("record changed");
  expect(store.getState().workspaces.test).toBe(workspace);
});

it("refuses session Undo after external workspace replacement instead of discarding newer records", () => {
  const store = createCreditCardStore();
  const { cards, workspace } = transferPlanScenario();
  store.setState({ workspaces: { test: workspace } });
  const { id, revision, ...input } = cards[0];
  store.getState().updateCard("test", id, revision, { ...input, nickname: "Updated" });
  const current = store.getState().workspaces.test;
  const external = { ...current, cards: current.cards.map((card) => ({ ...card, nickname: "External update" })) };
  store.setState({ workspaces: { test: external } });
  store.getState().undo("test");
  expect(store.getState().workspaces.test).toBe(external);
  expect(store.getState().notices.test).toContain("current records were kept");
});

it("reuses pure derivations only for the same immutable evidence and lets confirmed plan end dates restore shading", () => {
  const scenario = statementScenario("full");
  const { card, workspace, snapshot } = scenario;
  const first = settlements(card, workspace, snapshot, "2026-10-15");
  expect(settlements(card, workspace, snapshot, "2026-10-15")).toBe(first);
  expect(settlements({ ...card, feeCategoryId: "new" }, workspace, snapshot, "2026-10-15")).not.toBe(first);
  expect(settlements(card, workspace, { ...snapshot }, "2026-10-15")).not.toBe(first);
  expect(statementReview(workspace.statements[1], workspace, snapshot)).toBe(statementReview(workspace.statements[1], workspace, snapshot));
  const { plans } = transferPlanScenario();
  const plan = { ...plans[0], cardId: card.id, recording: "instalments" as const, tracking: undefined, status: "completed" as const, aprBps: 1200 };
  const build = (settledDate?: string) => dailyBalanceHistory(card, { ...workspace, plans: [{ ...plan, settledDate }] }, snapshot, 0, "2026-10-15");
  expect(build().bands.some((band) => band.kind === "free" && band.to >= plan.startDate)).toBe(false);
  expect(build("2026-08-01").bands.some((band) => band.kind === "free" && band.from >= "2026-08-01")).toBe(true);
});

it.each([true, false])("shares cutoff-normalized balances for detail and portfolio estimates (Direct=%s)", (direct) => {
  const { cards, sources } = transferPlanScenario();
  const card = { ...cards[0], closingDay: 16, firstTrackedStatementDate: "2026-10-16" };
  const source = { ...sources[0], rows: [], to: "2026-10-17", futureDeltaMinor: 2000, directBalanceAdjustmentMinor: -1000 };
  const live = cardBalance(direct ? -100 : -90);
  const normalized = asOfCardBalance(live, source.futureDeltaMinor, direct, source.directBalanceAdjustmentMinor);
  const portfolio = statementDrafts(card, "2026-10-17", undefined, source, normalized.rawSignedBalanceMinor);
  const detail = statementDrafts(card, "2026-10-17", undefined, source, normalized.rawSignedBalanceMinor);
  expect(portfolio).toEqual(detail);
  expect(portfolio[0].officialBalanceMinor).toBe(11000);
  const balances = new Map([["tracking", live]]);
  const snapshot = cardReadSnapshot(source, undefined, [source], balances, direct);
  expect(cardReadSnapshot(source, undefined, [source], balances, direct)).toBe(snapshot);
  expect(cardReadSnapshot(source, undefined, [undefined], balances, direct).trackingAccounts).toEqual([]);
});
