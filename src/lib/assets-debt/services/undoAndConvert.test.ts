import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { actualRowsToPreviewRows, renderPreviewRows, type PreviewDirectory, type PreviewRow } from "@/features/assets-debt/components/preview/renderPreviewRows";
import { HARNESS_MODES } from "../testing/transportHarness";
import { ACCOUNTS, CATEGORIES, LENDER, byKind, createScenario, type Scenario } from "../testing/postingScenario";
import type { PostingView } from "./proposalService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/**
 * T276, T277, T279 through Bench's real Direct and HTTP transports against the
 * live-calibrated fake (behaviours 5–7). Every Undo restores the original rows
 * exactly (a re-created counterpart differs only in its id), each new shape
 * has preview parity (SC-019), and no Bench link outlives the rows it named.
 */

const FIELDS = ["account", "date", "amount", "payee", "category", "notes", "cleared", "reconciled", "imported_id", "imported_payee", "transfer_id", "is_parent", "is_child", "parent_id"];
const state = (s: Scenario, id: string) => {
  const row = s.fake.row(id);
  return row ? Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? null])) : null;
};
const window = { from: "2024-02-01", to: "2024-02-29" };

function directoryOf(s: Scenario): PreviewDirectory {
  return {
    accounts: s.directory.accounts,
    categories: s.directory.categories,
    payeeNames: { [LENDER]: "Home Lender" },
    transferAccountByPayee: Object.fromEntries(Object.entries(s.transferPayees).map(([account, payee]) => [payee, account])),
  };
}

/** SC-019 for the new shapes: rows shown before apply equal the rows Actual holds after. */
async function parity(s: Scenario, posting: PostingView, applied: PostingView) {
  const shown = renderPreviewRows(posting.output, directoryOf(s), 2);
  const read = [
    ...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.checking, startDate: "2024-01-01" })),
    ...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage, startDate: "2024-01-01" })),
  ];
  const ids = applied.actualIds ?? [];
  const back = actualRowsToPreviewRows(shown, read, directoryOf(s), 2, (row: PreviewRow) => (row.key.endsWith("counterpart") ? ids[1] ?? null : row.key));
  expect(back).toEqual(shown);
}

const mortgageRows = (s: Scenario) => s.fake.rows().filter((r) => r.account === ACCOUNTS.mortgage).map((r) => r.id).sort();
const deadLinks = (s: Scenario) => listDebtTransactionLinks(s.db, s.debtId).filter((l) => !s.fake.row(l.actualTransactionId));

describe.each(HARNESS_MODES)("Undo and transfer conversion (%s)", (mode) => {
  it("T276: undoing a split restores the original payment exactly and removes the loan-side row", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const payment = s.seedPayment("2024-02-01", -242915, { category: CATEGORIES.loan, notes: "bank note" });
    const before = state(s, payment);
    const liabilityBefore = mortgageRows(s);
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    const applied = await s.apply(split);
    expect(applied.posting.status).toBe("applied");
    const reversal = s.undo(applied.posting);
    expect(reversal).toMatchObject({ classification: "review", output: expect.objectContaining({ kind: "restore-split" }) });
    const undone = await s.apply(reversal);
    expect(undone.posting.status).toBe("applied");
    expect(state(s, payment)).toEqual(before);
    expect(mortgageRows(s)).toEqual(liabilityBefore);
    await parity(s, reversal, undone.posting);
    expect(deadLinks(s)).toEqual([]);
  });

  it("T276: with a lender feed the link is undone first, then the split; both rows come back exactly", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    const payment = s.seedPayment("2024-02-01", -242915, { category: CATEGORIES.loan });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    const lenderRow = s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor);
    const paymentBefore = state(s, payment);
    const lenderBefore = state(s, lenderRow);
    const appliedSplit = (await s.apply(split)).posting;
    const [link] = byKind((await s.preview(window)).postings, "repayment-link");
    const appliedLink = (await s.apply(link)).posting;
    expect(appliedLink.status).toBe("applied");

    expect(s.undo(appliedSplit)).toMatchObject({ classification: "blocked", reasons: [expect.objectContaining({ code: "undo-link-first" })] });
    const unlink = s.undo(appliedLink);
    expect(unlink.output.kind).toBe("unlink");
    const unlinked = (await s.apply(unlink)).posting;
    expect(unlinked.status).toBe("applied");
    expect(state(s, lenderRow)).toEqual(lenderBefore);
    await parity(s, unlink, unlinked);

    const restore = (await s.apply(s.undo(appliedSplit))).posting;
    expect(restore.status).toBe("applied");
    expect(state(s, payment)).toEqual(paymentBefore);
    expect(state(s, lenderRow)).toEqual(lenderBefore);
    expect(deadLinks(s)).toEqual([]);
  });

  it("T277: without a lender feed an existing repayment becomes the loan transfer, and Undo reverts it exactly", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const payment = s.seedPayment("2024-02-01", -242915, { category: CATEGORIES.loan, notes: "bank note" });
    const before = state(s, payment);
    const liabilityBefore = mortgageRows(s);
    const [convert] = byKind((await s.preview(window)).postings, "repayment-link");
    expect(convert).toMatchObject({ classification: "review", output: expect.objectContaining({ kind: "convert" }) });
    expect(convert.reasons.map((r) => r.code)).toContain("converts-payment-to-transfer");
    const applied = (await s.apply(convert)).posting;
    expect(applied.status).toBe("applied");
    const counterparts = s.fake.rows().filter((r) => r.account === ACCOUNTS.mortgage && r.transfer_id === payment);
    expect(counterparts).toHaveLength(1);
    expect(state(s, payment)).toMatchObject({ category: CATEGORIES.loan, cleared: true, imported_id: "bank:2024-02-01", transfer_id: counterparts[0].id });
    await parity(s, convert, applied);
    // A second preview does not convert it again.
    expect(byKind((await s.preview(window)).postings, "repayment-link").filter((p) => p.output.kind === "convert" && p.status === "proposed")).toEqual([]);

    const revert = s.undo(applied);
    expect(revert.output.kind).toBe("revert-convert");
    const reverted = (await s.apply(revert)).posting;
    expect(reverted.status).toBe("applied");
    expect(state(s, payment)).toEqual(before);
    expect(mortgageRows(s)).toEqual(liabilityBefore);
    await parity(s, revert, reverted);
    expect(deadLinks(s)).toEqual([]);
  });

  it("T279: a payment that is already a transfer to an untouched Actual-made row is split, and Undo re-creates that row", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    const payment = s.seedPayment("2024-02-01", -242915, { category: CATEGORIES.loan, notes: "bank note" });
    s.fake.editInActual(payment, { payee: s.transferPayees[ACCOUNTS.mortgage] });
    const original = s.fake.row(s.fake.row(payment)!.transfer_id as string)!;
    const originalState = state(s, original.id);
    const paymentBefore = state(s, payment);
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split.classification).toBe("safe");
    expect(split.reasons.map((r) => r.code)).toContain("replaces-transfer-counterpart");
    const applied = (await s.apply(split)).posting;
    expect(applied.status).toBe("applied");
    expect(s.fake.row(original.id)).toBeUndefined();
    // One loan-side row, for the principal only.
    if (split.output.kind !== "restructure") throw new Error("restructure");
    expect(s.fake.rows().filter((r) => r.account === ACCOUNTS.mortgage).map((r) => r.amount)).toEqual([-split.output.expectedPostState.children[0].amountMinor]);

    const reversal = s.undo(applied);
    expect(reversal.reasons.map((r) => r.code)).toContain("recreates-counterpart");
    const undone = (await s.apply(reversal)).posting;
    expect(undone.status).toBe("applied");
    const recreatedId = s.fake.row(payment)!.transfer_id as string;
    expect(recreatedId).not.toBe(original.id);
    expect(undone.actualIds).toEqual([payment, recreatedId]);
    // Everything but the ids is as it was.
    expect({ ...state(s, payment), transfer_id: null }).toEqual({ ...paymentBefore, transfer_id: null });
    expect({ ...state(s, recreatedId), transfer_id: null }).toEqual({ ...originalState, transfer_id: null });
    expect(state(s, recreatedId)!.transfer_id).toBe(payment);
    await parity(s, reversal, undone);
    expect(deadLinks(s)).toEqual([]);
  });

  it("T279: a transfer whose loan-side row was imported (the lender's) or edited stays Blocked with the reason", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    const payment = s.seedPayment("2024-02-01", -242915);
    const lenderRow = s.seedLenderRow("2024-02-01", 242915);
    s.fake.editInActual(payment, { payee: s.transferPayees[ACCOUNTS.mortgage], transfer_id: lenderRow });
    s.fake.editInActual(lenderRow, { transfer_id: payment });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split).toMatchObject({ classification: "blocked" });
    expect(split.reasons.map((r) => r.code)).toContain("imported-counterpart-protected");

    resetAppDbForTests();
    const t = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    const other = t.seedPayment("2024-02-01", -242915);
    t.fake.editInActual(other, { payee: t.transferPayees[ACCOUNTS.mortgage] });
    // Reconciled on the loan side: Bench never touches it.
    t.fake.editInActual(t.fake.row(other)!.transfer_id as string, { reconciled: true });
    const [edited] = byKind((await t.preview(window)).postings, "repayment-split");
    expect(edited).toMatchObject({ classification: "blocked", reasons: expect.arrayContaining([expect.objectContaining({ code: "counterpart-edited", text: expect.stringContaining("it is reconciled") })]) });
  });

  it("a cleared loan-side row is no reason to refuse: it stays cleared after the split and after Undo (owner decision 2026-10-07)", async () => {
    const t = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    const payment = t.seedPayment("2024-02-01", -242915);
    t.fake.editInActual(payment, { payee: t.transferPayees[ACCOUNTS.mortgage] });
    t.fake.editInActual(t.fake.row(payment)!.transfer_id as string, { cleared: true });
    const [split] = byKind((await t.preview(window)).postings, "repayment-split");
    expect(split.classification).not.toBe("blocked");
    expect((await t.apply(split)).posting.status).toBe("applied");
    const principal = t.fake.rows().find((r) => r.parent_id === payment && r.transfer_id)!;
    expect(t.fake.row(principal.transfer_id as string)).toMatchObject({ account: ACCOUNTS.mortgage, cleared: true });
    const { listDebtPostings } = await import("./proposalService");
    const undo = t.undo(listDebtPostings(t.db, t.debtId).find((p) => p.id === split.id)!);
    expect((await t.apply(undo)).posting.status).toBe("applied");
    expect(t.fake.row(t.fake.row(payment)!.transfer_id as string)).toMatchObject({ account: ACCOUNTS.mortgage, amount: 242915, cleared: true });
  });

  it("an Undo refuses, writing nothing, when the rows changed in Actual after the change was applied", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    const applied = (await s.apply(split)).posting;
    const reversal = s.undo(applied);
    const childId = applied.actualIds![1];
    s.fake.editInActual(childId, { amount: -1, category: null, payee: null, notes: "edited" });
    const writes = s.fake.writes().length;
    await expect(s.apply(reversal)).rejects.toThrow();
    expect(s.fake.writes().length).toBe(writes);
  });
});
