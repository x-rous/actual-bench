import { planBankReads } from "./scopedReads";

const row = (id: string, date: string, payeeId: string | null, transferId: string | null) => ({ id, accountId: "loan", date, amount: 100, payeeId, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, transferId, scheduleId: null, isParent: false, isChild: false, parentId: null, splitLines: [] }) as never;

/** The loan account is the main ledger; the other side is read only where it matters (owner decision 2026-10-07). */
describe("what a refresh reads", () => {
  const base = { liabilityAccountId: "loan", accountByTransferPayee: { "tp-bank": "bank", "tp-savings": "savings" }, paymentAccountId: "bank", window: { from: "2024-01-01", to: "2024-06-30" } };

  it("transfers: only their own days, on whichever account they came from; nearby days merge", () => {
    const plan = planBankReads({
      ...base, applied: [], ruleIdentifies: false, lastSplitDate: null,
      loanRows: [row("a", "2024-01-29", "tp-bank", "x"), row("b", "2024-01-30", "tp-bank", "y"), row("c", "2024-03-01", "tp-bank", "z"), row("d", "2024-04-02", "tp-savings", "w"), row("e", "2024-05-01", null, null)],
    });
    expect(plan).toEqual([
      { accountId: "bank", from: "2024-01-29", to: "2024-01-30" },
      { accountId: "bank", from: "2024-03-01", to: "2024-03-01" },
      { accountId: "savings", from: "2024-04-02", to: "2024-04-02" },
    ]);
  });

  it("applied payments are read on their days; repayments that are not transfers add the repayment account from before the last split", () => {
    const plan = planBankReads({ ...base, loanRows: [], applied: [{ accountId: "bank", date: "2024-02-01" }], ruleIdentifies: true, lastSplitDate: "2024-05-01" });
    expect(plan).toEqual([
      { accountId: "bank", from: "2024-02-01", to: "2024-02-01" },
      { accountId: "bank", from: "2024-03-02", to: "2024-07-31" },
    ]);
  });
});
