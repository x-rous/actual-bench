import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { deriveOffsetHistory, mergeOffsetHistories, readOffsetHistories } from "./offsetHistoryService";

const row = (id: string, date: string, amount: number, patch: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction => ({
  id, accountId: "offset", date, amount, payeeId: null, payeeName: null, categoryId: null, categoryName: null,
  notes: null, cleared: false, reconciled: false, importedId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...patch,
});

describe("Actual-linked offset history", () => {
  it("derives exact total and cleared closes, counts split parents once and emits the inclusive cutoff", () => {
    const result = deriveOffsetHistory("offset", [
      row("open", "2026-01-01", 100_000, { cleared: true }),
      row("pending", "2026-01-02", -10_000),
      row("split", "2026-01-03", -2_000, { isParent: true, reconciled: true }),
      row("child", "2026-01-03", -2_000, { isChild: true, parentId: "split" }),
      row("future", "2026-02-01", 9_999, { cleared: true }),
    ], "2026-01-31");
    expect(result.points).toEqual([
      { date: "2026-01-01", totalBalanceMinor: 100_000, clearedBalanceMinor: 100_000 },
      { date: "2026-01-02", totalBalanceMinor: 90_000, clearedBalanceMinor: 100_000 },
      { date: "2026-01-03", totalBalanceMinor: 88_000, clearedBalanceMinor: 98_000 },
      { date: "2026-01-31", totalBalanceMinor: 88_000, clearedBalanceMinor: 98_000 },
    ]);
  });

  it("refuses missing and incomplete histories instead of falling back", async () => {
    const transport = {
      getAccounts: jest.fn().mockResolvedValue([{ id: "offset" }]),
      listTransactionsForSync: jest.fn().mockResolvedValue([row("a", "2026-01-01", 1), row("b", "2026-01-02", 1)]),
    } as never;
    const incomplete = await readOffsetHistories(transport, { accountIds: ["offset"], asOfDate: "2026-01-31", maxTransactionsPerAccount: 1 });
    expect(incomplete).toMatchObject({ ok: false, failures: [{ reason: "incomplete-history" }] });
    expect(await readOffsetHistories(transport, { accountIds: ["missing"], asOfDate: "2026-01-31" })).toMatchObject({ ok: false, failures: [{ reason: "account-not-found" }] });
  });

  it("reads each distinct mapped account once and keeps account histories separate", async () => {
    const transactions = jest.fn(async ({ accountId }: { accountId: string }) => [row(`open-${accountId}`, "2026-01-01", accountId === "offset" ? 100 : 200, { accountId, cleared: true })]);
    const transport = { getAccounts: jest.fn().mockResolvedValue([{ id: "offset" }, { id: "second" }]), listTransactionsForSync: transactions } as never;
    const result = await readOffsetHistories(transport, { accountIds: ["offset", "second", "offset"], asOfDate: "2026-01-31" });
    expect(result).toMatchObject({ ok: true, snapshots: [{ accountId: "offset" }, { accountId: "second" }] });
    expect(transactions).toHaveBeenCalledTimes(2);
    expect(transactions).toHaveBeenNthCalledWith(1, { accountId: "offset", endDate: "2026-01-31" });
    expect(transactions).toHaveBeenNthCalledWith(2, { accountId: "second", endDate: "2026-01-31" });
  });

  it("suppresses observed-period assumptions and resumes recurring events strictly after cutoff", () => {
    const model = {
      offsets: [{ id: "link", accountId: "offset", effectiveFrom: "2026-01-01", effectiveTo: null, percentageBps: 10_000, basis: "total", capMinor: null, useActualBalance: true, fundScheduledRepayments: true }],
      assumptions: [
        { kind: "offset-balance", date: "2026-01-01", accountId: "offset", balanceMinor: 50_000 },
        { kind: "offset-deposit", date: "2026-01-15", accountId: "offset", amountMinor: 1_000, recurrence: { frequency: "monthly", until: "2026-04-15" } },
        { kind: "offset-withdrawal", date: "2026-03-20", accountId: "offset", amountMinor: 500 },
      ],
    } as LoanModelSnapshot;
    const merged = mergeOffsetHistories(model, [{ accountId: "offset", asOfDate: "2026-02-28", transactionCount: 1, points: [{ date: "2026-02-28", totalBalanceMinor: 60_000, clearedBalanceMinor: 59_000 }] }]);
    expect(merged.model.assumptions).toEqual([
      expect.objectContaining({ kind: "offset-deposit", date: "2026-03-15" }),
      expect.objectContaining({ kind: "offset-withdrawal", date: "2026-03-20" }),
    ]);
    expect(merged.events).toEqual([{ kind: "offset-balance", date: "2026-02-28", accountId: "offset", balanceMinor: 60_000, clearedBalanceMinor: 59_000 }]);
    expect(merged.model.offsets[0].fundScheduledRepaymentsFrom).toBe("2026-03-01");
  });
});
