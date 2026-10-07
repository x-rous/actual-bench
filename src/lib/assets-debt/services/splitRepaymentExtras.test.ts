import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { insertDebtTransactionLink, listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { ACCOUNTS, CATEGORIES, byKind, createScenario } from "../testing/postingScenario";
import { getDebtDetail, saveBaselineAssumptions } from "./debtConfigService";
import { followRecordedExtraPayments, recordExtraPayment, splitRepaymentCounterparts } from "./extraPaymentService";
import { indexReadRows } from "./snapshot";
import { listDebtPostings } from "./proposalService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

describe.each(["direct", "http"] as const)("split repayment counterpart ownership (%s)", (mode) => {
  const window = { from: "2024-02-01", to: "2024-02-29" };
  const scenario = () => createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });

  async function existingSplit() {
    const probe = scenario();
    probe.seedPayment("2024-02-01");
    const [proposal] = byKind((await probe.preview(window)).postings, "repayment-split");
    if (proposal.output.kind !== "restructure") throw new Error("Expected repayment split");
    const interest = proposal.output.components.find((c) => c.kind === "interest")!.amountMinor;
    resetAppDbForTests();
    const s = scenario();
    const parent = s.seedPayment("2024-02-01");
    s.fake.editInActual(parent, { subtransactions: [
      { amount: -(242915 - interest), payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), category: CATEGORIES.loan },
      { amount: -interest, category: CATEGORIES.interest },
    ] });
    const child = s.fake.rows().find((r) => r.parent_id === parent && r.transfer_id)!;
    const counterpart = child.transfer_id as string;
    return { s, parent, counterpart };
  }

  it("recognizes an existing split once, without recording its principal counterpart as extra", async () => {
    const { s, parent } = await existingSplit();
    const before = structuredClone(s.fake.rows());
    const result = await s.preview(window);
    expect(result.unscheduled).toEqual([]);
    expect(result.recordedExtraPayments ?? []).toEqual([]);
    expect(result.paymentOptions.map((p) => p.id)).not.toContain(s.fake.rows().find((r) => r.account === ACCOUNTS.mortgage)!.id);
    expect(byKind(listDebtPostings(s.db, s.debtId), "repayment-split")).toEqual([
      expect.objectContaining({ status: "applied", output: expect.objectContaining({ kind: "claim", recordedSplit: expect.objectContaining({ parent: expect.objectContaining({ id: parent }) }) }) }),
    ]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
    expect(s.fake.rows()).toEqual(before);
  });

  it("a split created by Bench also excludes its principal counterpart", async () => {
    const s = scenario();
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    await s.apply(split);
    const result = await s.preview(window);
    expect(result.unscheduled).toEqual([]);
    expect(result.recordedExtraPayments ?? []).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
  });

  it("uses the transfer structure when the existing split parent does not match the repayment rule", async () => {
    const { s, parent, counterpart } = await existingSplit();
    s.fake.editInActual(parent, { payee: null, imported_payee: null });
    const result = await s.preview(window);
    expect(result.unscheduled).toEqual([]);
    expect(result.recordedExtraPayments ?? []).toEqual([]);
    expect(result.paymentOptions.map((p) => p.id)).not.toContain(counterpart);
    expect(byKind(listDebtPostings(s.db, s.debtId), "repayment-split").some((p) => p.status === "applied" && p.output.kind === "claim" && p.output.recordedSplit?.parent.id === parent)).toBe(true);
  });

  it("respects the positive-is-debt sign convention without guessing from amount magnitude", async () => {
    const { s, counterpart } = await existingSplit();
    const rows = indexReadRows([...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.checking })), ...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage }))]);
    for (const row of rows.values()) row.amountMinor = -row.amountMinor;
    const detail = getDebtDetail(s.db, s.debtId)!;
    expect(splitRepaymentCounterparts(detail, rows)).toEqual(new Set());
    expect(splitRepaymentCounterparts({ ...detail, debt: { ...detail.debt, signConvention: "positive-is-debt" } }, rows)).toEqual(new Set([counterpart]));
  });

  it("keeps the counterpart out of extras while an existing split awaits Review", async () => {
    const { s, parent, counterpart } = await existingSplit();
    const principal = s.fake.rows().find((r) => r.parent_id === parent && r.transfer_id)!;
    const interest = s.fake.rows().find((r) => r.parent_id === parent && !r.transfer_id)!;
    s.fake.editInActual(principal.id as string, { amount: (principal.amount as number) + 500 });
    s.fake.editInActual(interest.id as string, { amount: (interest.amount as number) - 500 });
    const result = await s.preview(window);
    expect(result.unscheduled).toEqual([]);
    expect(result.recordedExtraPayments ?? []).toEqual([]);
    expect(byKind(result.postings, "repayment-split")[0]).toMatchObject({ classification: "review", output: { kind: "claim", recordedSplit: { counterpart: { id: counterpart } } } });
  });

  it("a genuine independent transfer remains an extra payment alongside an existing split", async () => {
    const { s, counterpart } = await existingSplit();
    await s.preview(window);
    const extra = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: 20_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const bank = s.fake.seed({ account: ACCOUNTS.checking, date: "2024-02-10", amount: -20_000, payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: extra });
    s.fake.row(extra)!.transfer_id = bank;
    const result = await s.preview(window);
    expect(result.unscheduled).toEqual([expect.objectContaining({ id: extra, recorded: true, inSchedule: true })]);
    expect(result.recordedExtraPayments).toEqual([extra]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment").map((l) => l.actualTransactionId)).toEqual([extra]);
    expect(result.unscheduled.map((p) => p.id)).not.toContain(counterpart);
  });

  it("repairs a previously recorded counterpart before planning, without changing Actual or matching settings", async () => {
    const { s, parent, counterpart } = await existingSplit();
    const amountMinor = Math.abs(s.fake.row(counterpart)!.amount as number);
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: counterpart, date: "2024-02-01", amountMinor });
    const revision = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    const rules = s.db.prepare("SELECT * FROM debt_match_rules WHERE debt_id = ?").all(s.debtId);
    const before = structuredClone(s.fake.rows());
    const result = await s.preview(window);
    expect(result.followedExtraPayments).toEqual([expect.objectContaining({ transactionId: counterpart, change: "repayment" })]);
    expect(result.unscheduled).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(revision + 1);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment")).toEqual([]);
    expect(byKind(listDebtPostings(s.db, s.debtId), "repayment-split").some((p) => p.status === "applied" && p.output.kind === "claim" && p.output.recordedSplit?.parent.id === parent)).toBe(true);
    expect(s.fake.rows()).toEqual(before);
    expect(s.db.prepare("SELECT * FROM debt_match_rules WHERE debt_id = ?").all(s.debtId)).toEqual(rules);
    expect((await s.preview(window)).followedExtraPayments).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(revision + 1);
  });

  it("defers repair while Terms & Schedule has unsaved edits", async () => {
    const { s, counterpart } = await existingSplit();
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: counterpart, date: "2024-02-01", amountMinor: Math.abs(s.fake.row(counterpart)!.amount as number) });
    const revision = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    const result = await s.preview(window, { followExtraPayments: false });
    expect(result.followedExtraPayments).toEqual([]);
    expect(result.notices).toContainEqual(expect.objectContaining({ code: "split-extra-correction-pending" }));
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(revision);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toHaveLength(1);
    expect((await s.preview(window)).followedExtraPayments).toEqual([expect.objectContaining({ change: "repayment" })]);
  });

  it("never guesses a repair from a partial read or non-reciprocal transfer", async () => {
    const { s, counterpart } = await existingSplit();
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: counterpart, date: "2024-02-01", amountMinor: Math.abs(s.fake.row(counterpart)!.amount as number) });
    const loanRows = await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage });
    expect(followRecordedExtraPayments(s.db, s.debtId, indexReadRows(loanRows), null)).toEqual([]);
    s.fake.row(counterpart)!.transfer_id = "different-child";
    const rows = indexReadRows([...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.checking })), ...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage }))]);
    expect(followRecordedExtraPayments(s.db, s.debtId, rows, null)).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toHaveLength(1);
  });

  it("preserves a manually entered extra event when removing a stale link", async () => {
    const { s, counterpart } = await existingSplit();
    const amountMinor = Math.abs(s.fake.row(counterpart)!.amount as number);
    saveBaselineAssumptions(s.db, s.debtId, [{ kind: "extra-repayment", effectiveFrom: "2024-02-01", recurrence: null, amountMinor, feeTreatment: null, offsetAccountId: null, note: "My own event" }], "Manual event");
    insertDebtTransactionLink(s.db, { debtId: s.debtId, budgetSyncId: "budget-1", actualTransactionId: counterpart, role: "extra-repayment", periodKey: "2024-02-01", linkSource: "user" });
    const assumptions = getDebtDetail(s.db, s.debtId)!.assumptions;
    await s.preview(window);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual(assumptions);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment")).toEqual([]);
  });

  it("preserves ambiguous same-day generated events and reports the pending correction", async () => {
    const { s, counterpart } = await existingSplit();
    const amountMinor = Math.abs(s.fake.row(counterpart)!.amount as number);
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: counterpart, date: "2024-02-01", amountMinor });
    const extra = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-01", amount: 123, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-01", amountMinor: 123 });
    const before = getDebtDetail(s.db, s.debtId)!;
    const result = await s.preview(window);
    expect(result.followedExtraPayments).toEqual([]);
    expect(result.notices).toContainEqual(expect.objectContaining({ code: "split-extra-correction-pending" }));
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual(before.assumptions);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(before.debt.currentRevision);
  });
});
