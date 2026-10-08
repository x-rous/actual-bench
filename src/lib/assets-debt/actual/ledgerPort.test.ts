import type { SyncSourceTransaction } from "@/lib/actual/transport";
import {
  actualUnitsToMinor,
  budgetStatus,
  crossesBudgetBoundary,
  fromDebtMagnitude,
  readAccountDirectory,
  datedBalanceFromTransactions,
  readDatedBalance,
  toDebtMagnitude,
  type LedgerReadTransport,
} from "./ledgerPort";

function row(date: string, amount: number, extra: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id: `${date}-${amount}`, accountId: "acc", date, amount, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null,
    cleared: true, reconciled: false, importedId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...extra,
  };
}

/** The same fake answers in both modes: the port only sees the transport contract (Direct and HTTP alike). */
function fake(rows: SyncSourceTransaction[], balance = -3990.5): LedgerReadTransport & { lastInput?: unknown } {
  const t: LedgerReadTransport & { lastInput?: unknown } = {
    getAccounts: async () => [
      { id: "acc", name: "Home loan", offBudget: true, closed: false },
      { id: "chk", name: "Everyday", offBudget: false, closed: false },
    ],
    getAccountBalances: async () => new Map([["acc", balance]]),
    getCategoryGroups: async () => ({
      groups: [{ id: "g", name: "Bills", isIncome: false, hidden: false, categoryIds: ["c"] }],
      categories: [{ id: "c", name: "Loan payments", groupId: "g", isIncome: false, hidden: false }],
    }),
    listTransactionsForSync: async (input) => {
      t.lastInput = input;
      return rows;
    },
  };
  return t;
}

describe("ledger port (read side)", () => {
  it("reads the account directory labelled with its budget", async () => {
    const dir = await readAccountDirectory(fake([]), "b1");
    expect(dir).toEqual({
      budgetSyncId: "b1",
      accounts: [
        { id: "acc", name: "Home loan", offBudget: true, closed: false },
        { id: "chk", name: "Everyday", offBudget: false, closed: false },
      ],
      categories: [{ id: "c", name: "Loan payments", groupName: "Bills", isIncome: false, hidden: false }],
    });
  });

  it("derives budget status and whether a relationship crosses the boundary", () => {
    expect(budgetStatus({ offBudget: true })).toBe("off-budget");
    expect(crossesBudgetBoundary({ offBudget: true }, { offBudget: false })).toBe(true);
    expect(crossesBudgetBoundary({ offBudget: false }, { offBudget: false })).toBe(false);
  });

  it("converts the ledger sign to a positive debt magnitude and back", () => {
    expect(toDebtMagnitude(-399050, "negative-is-debt")).toBe(399050);
    expect(toDebtMagnitude(399050, "positive-is-debt")).toBe(399050);
    expect(fromDebtMagnitude(399050, "negative-is-debt")).toBe(-399050);
  });

  it("converts Actual's decimal units to exact minor units", () => {
    expect(actualUnitsToMinor(-3990.5)).toBe(-399050);
    expect(actualUnitsToMinor(0.1 + 0.2)).toBe(30);
    expect(() => actualUnitsToMinor(1.001)).toThrow();
  });

  it("derives a dated balance from one read of the account, counting each split once and never reading every account's balance", async () => {
    const t = fake([row("2024-01-01", -500000), row("2024-03-01", 100), row("2024-03-02", 120000), row("2024-03-15", -2000, { isParent: true }), row("2024-03-15", -1500, { isChild: true, parentId: "p" }), row("2024-03-15", -500, { isChild: true, parentId: "p" })]);
    const balances = jest.spyOn(t, "getAccountBalances");
    const result = await readDatedBalance(t, { accountId: "acc", date: "2024-03-01" });
    expect(t.lastInput).toEqual({ accountId: "acc" });
    expect(result).toEqual({ ok: true, accountId: "acc", date: "2024-03-01", balanceMinor: -499900, transactionsRead: 6 });
    expect(datedBalanceFromTransactions("acc", [row("2024-03-15", -2000, { isParent: true }), row("2024-03-15", -1500, { isChild: true })], "2024-03-15").balanceMinor).toBe(-2000);
    expect(balances).not.toHaveBeenCalled();
  });

  it("refuses rather than truncates an unbounded read, and reports an unknown account", async () => {
    expect(await readDatedBalance(fake([row("2024-03-02", 1), row("2024-03-03", 1)]), { accountId: "acc", date: "2024-03-01", maxTransactions: 1 })).toMatchObject({ ok: false, reason: "too-many-transactions" });
    expect(await readDatedBalance(fake([]), { accountId: "nope", date: "2024-03-01" })).toMatchObject({ ok: false, reason: "account-not-found" });
  });
});
