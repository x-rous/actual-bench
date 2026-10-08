import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { consolidateReadRanges, planBankReads, readRanges } from "./scopedReads";

const row = (id: string, date: string, payeeId: string | null, transferId: string | null) => ({ id, accountId: "loan", date, amount: 100, payeeId, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, transferId, scheduleId: null, isParent: false, isChild: false, parentId: null, splitLines: [] }) as SyncSourceTransaction;

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

  it("does not read transfer dates again when the repayment window already covers them", () => {
    const plan = planBankReads({ ...base, loanRows: [row("a", "2024-04-01", "tp-bank", "x")],
      applied: [{ accountId: "bank", date: "2024-04-05" }], ruleIdentifies: true, lastSplitDate: "2024-05-01" });
    expect(plan).toEqual([{ accountId: "bank", from: "2024-03-02", to: "2024-07-31" }]);
  });

  it("preserves the exact union per account without mutating the caller's coverage", () => {
    const ranges = [
      { accountId: "bank", from: "2024-01-05", to: "2024-01-10" },
      { accountId: "bank", from: "2024-01-01", to: "2024-01-06" },
      { accountId: "bank", from: "2024-01-02", to: "2024-01-03" },
      { accountId: "savings", from: "2024-01-03", to: "2024-01-15" },
      { accountId: "bank", from: "2024-01-12", to: "2024-01-12" },
    ];
    const original = structuredClone(ranges);
    expect(consolidateReadRanges(ranges)).toEqual([
      { accountId: "bank", from: "2024-01-01", to: "2024-01-10" },
      { accountId: "bank", from: "2024-01-12", to: "2024-01-12" },
      { accountId: "savings", from: "2024-01-03", to: "2024-01-15" },
    ]);
    expect(ranges).toEqual(original);
  });

  it("reduces calls while retaining fallback rows, inline splits and deterministic ordering", async () => {
    const ranges = [{ accountId: "bank", from: "2024-01-01", to: "2024-01-10" },
      { accountId: "bank", from: "2024-01-05", to: "2024-01-06" }];
    const parent = { ...row("parent", "2024-01-05", null, null), isParent: true, splitLines: [{ id: "child", amount: 100 } as SyncSourceTransaction["splitLines"][number]] };
    const rows = [row("late", "2024-01-10", null, null), parent, row("outside", "2024-01-20", null, null)];
    const listTransactionsForSync = jest.fn(async (input: { startDate?: string; endDate?: string }) =>
      rows.filter((r) => r.date >= input.startDate! && r.date <= input.endDate!));
    const fallback = await readRanges({ listTransactionsForSync }, ranges);
    expect(listTransactionsForSync).toHaveBeenCalledTimes(2);
    listTransactionsForSync.mockClear();
    expect(await readRanges({ listTransactionsForSync }, consolidateReadRanges(ranges))).toEqual(fallback);
    expect(listTransactionsForSync).toHaveBeenCalledTimes(1);
    expect(fallback[0].transactions.map((r) => r.id)).toEqual(["parent", "late"]);
    expect(fallback[0].transactions[0].splitLines).toEqual(parent.splitLines);
  });
});
