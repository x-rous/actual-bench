import { readStructuralAccounts } from "./structuralTransactionReads";
import type { ActualApi, ActualQueryBuilder, ApiTransaction } from "./runtime/types";
import { preflightOf, restoreSplit, stateOf, verifySplit, type RawTxn } from "./transactionStructure";
import { verifySplitOutcome } from "../assets-debt/services/verify";

const date = "2026-06-01";
const row = (id: string, fields: Partial<ApiTransaction> = {}): ApiTransaction => ({
  id, account: "checking", date, amount: -10000, is_parent: false, is_child: false,
  payee: "lender", category: null, notes: "original", cleared: true, reconciled: false,
  transfer_id: null, ...fields,
});

function setup(responses: unknown[]) {
  const builders: Array<{
    filter: jest.Mock; select: jest.Mock; options: jest.Mock; orderBy: jest.Mock;
  }> = [];
  const q = jest.fn(() => {
    const builder = { filter: jest.fn(), select: jest.fn(), options: jest.fn(), orderBy: jest.fn() };
    for (const method of Object.values(builder)) method.mockReturnValue(builder);
    builders.push(builder);
    return builder as unknown as ActualQueryBuilder;
  });
  const runQuery = jest.fn();
  for (const response of responses) runQuery.mockResolvedValueOnce(response);
  const getTransactions = jest.fn();
  const api = { q, runQuery, getTransactions } as unknown as ActualApi;
  return { api, builders, runQuery, getTransactions };
}

describe("complete flat structural reads", () => {
  it("reads both watched accounts together and preserves all fields and complete split children", async () => {
    const parent = row("payment", { is_parent: true });
    const counterpart = row("counterpart", { account: "loan", amount: 9000, transfer_id: "principal" });
    const principal = row("principal", { is_child: true, parent_id: parent.id, amount: -9000, transfer_id: counterpart.id });
    const interest = row("interest", { is_child: true, parent_id: parent.id, amount: -1000, category: "interest" });
    // Include a zero-valued line outside BOTH the account and date scope. A sum check
    // or account/date filter on children would silently lose this preflight field.
    const moved = row("moved-line", { is_child: true, parent_id: parent.id, account: "other", date: "2026-07-01", amount: 0, reconciled: true });
    const { api, builders, runQuery, getTransactions } = setup([
      { data: [counterpart, parent] }, { data: [interest, moved, principal] },
    ]);
    const accounts = await readStructuralAccounts(api, ["checking", "loan", "checking"], date, date);
    expect(accounts.get("checking")).toEqual([{ ...parent, subtransactions: [moved, interest, principal] }]);
    expect(accounts.get("loan")).toEqual([{ ...counterpart, subtransactions: [] }]);
    expect(builders[0].filter).toHaveBeenCalledWith({ $and: [
      { account: { $oneof: ["checking", "loan"] } }, { is_child: false },
      { date: { $gte: date } }, { date: { $lte: date } },
    ] });
    expect(builders[1].filter).toHaveBeenCalledWith({ parent_id: { $oneof: ["counterpart", "payment"] } });
    for (const builder of builders) {
      expect(builder.select).toHaveBeenCalledWith("*");
      expect(builder.options).toHaveBeenCalledWith({ splits: "all" });
      expect(builder.orderBy).toHaveBeenCalledWith("id");
    }
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(getTransactions).not.toHaveBeenCalled();
  });

  it("includes attached children while a parent temporarily has its ordinary-row flag", async () => {
    const parent = row("payment");
    const child = row("remaining-line", { is_child: true, parent_id: parent.id });
    const { api } = setup([{ data: [parent] }, { data: [child] }]);
    expect((await readStructuralAccounts(api, ["checking"], date)).get("checking"))
      .toEqual([{ ...parent, subtransactions: [child] }]);
  });

  it.each([
    ["a-principal", "z-interest"], ["z-principal-after-undo", "a-interest-after-undo"],
  ])("preserves principal/interest order for exact verification regardless of generated IDs: %s / %s", async (principalId, interestId) => {
    const parent = row("payment", { is_parent: true });
    const principal = row(principalId, { is_child: true, parent_id: parent.id, sort_order: -1,
      amount: -9000, payee: "transfer-to-loan", transfer_id: "counterpart", notes: "principal marker" });
    const interest = row(interestId, { is_child: true, parent_id: parent.id, sort_order: -2,
      amount: -1000, payee: null, category: "interest", notes: "interest marker" });
    const childrenInIdOrder = [principal, interest].sort((a, b) => a.id < b.id ? -1 : 1);
    const { api } = setup([
      { data: [parent] }, { data: childrenInIdOrder },
      { data: [parent] }, { data: childrenInIdOrder },
    ]);
    const actual = (await readStructuralAccounts(api, ["checking"], date, date)).get("checking")![0];
    expect(actual.subtransactions?.map((child) => child.id)).toEqual([principalId, interestId]);
    const result = { parentId: parent.id, parentAmount: parent.amount, children: actual.subtransactions!.map((child) => ({
      id: child.id, amount: child.amount!, categoryId: child.category as string | null,
      payeeId: child.payee as string | null, notes: child.notes as string | null, transferId: child.transfer_id as string | null,
    })) };
    const expected = { parentId: parent.id, parentAmountMinor: parent.amount, children: [
      { economicKind: "principal" as const, amountMinor: -9000, categoryId: null, payeeId: null, notes: principal.notes!, transferAccountId: "loan" },
      { economicKind: "interest" as const, amountMinor: -1000, categoryId: "interest", payeeId: null, notes: interest.notes!, transferAccountId: null },
    ] };
    const before = { ...preflightOf(parent as RawTxn, null, "checking"), amountMinor: parent.amount,
      payeeName: null, cleared: true, importedId: null, importedPayee: null };
    const input = {
      expected, result, before,
      transferPayeeByAccount: { loan: "transfer-to-loan" },
      liabilityRows: [{ id: "counterpart", accountId: "loan", date, amount: 9000, transferId: principalId,
        payeeId: "transfer-to-checking", payeeName: null, categoryId: null, categoryName: null, notes: "principal marker",
        cleared: true, reconciled: false, importedId: null, isParent: false, isChild: false, parentId: null, splitLines: [] }],
    };
    expect(verifySplitOutcome(input)).toEqual([]);
    const recovered = await verifySplit({
      readAccount: async (accountId, since, until) => (await readStructuralAccounts(api, [accountId], since, until)).get(accountId)!,
      update: jest.fn(), remove: jest.fn(),
    }, {
      accountId: "checking", transactionId: parent.id, date,
      expected: { parentAmount: parent.amount, children: expected.children.map((child) => ({
        amount: child.amountMinor, categoryId: child.categoryId, payeeId: child.payeeId,
        notes: child.notes, transferAccountId: child.transferAccountId,
      })) },
      transferPayeeByAccount: input.transferPayeeByAccount,
    });
    expect(recovered.result).toBe("applied-exact");
    expect(verifySplitOutcome({ ...input, result: { ...result, children: result.children.map((child) =>
      child.id === principalId ? { ...child, amount: -8999 } : child) } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "split-mismatch" }),
    ]));
  });

  it("returns complete empty account snapshots without issuing a child query", async () => {
    const { api, runQuery } = setup([{ data: [] }]);
    expect(await readStructuralAccounts(api, ["checking", "loan"], date, date))
      .toEqual(new Map([["checking", []], ["loan", []]]));
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a prior read after Actual changes", async () => {
    const { api, runQuery } = setup([
      { data: [row("payment")] }, { data: [] },
      { data: [row("payment", { amount: -20000 })] }, { data: [] },
    ]);
    await readStructuralAccounts(api, ["checking"], date, date);
    expect((await readStructuralAccounts(api, ["checking"], date, date)).get("checking")?.[0].amount).toBe(-20000);
    expect(runQuery).toHaveBeenCalledTimes(4);
  });

  it.each([
    { date: "2026-07-01" }, { account: "other" }, { reconciled: true },
  ])("preserves Unsplit preflight refusal for an edited child: %j", async (change) => {
    const principal = row("principal", { is_child: true, parent_id: "payment", amount: -9000 });
    const interest = row("interest", { is_child: true, parent_id: "payment", amount: -1000 });
    const parent: RawTxn = { ...row("payment", { is_parent: true }), subtransactions: [principal as RawTxn, interest as RawTxn] };
    const { api } = setup([
      { data: [row("payment", { is_parent: true })] }, { data: [principal, { ...interest, ...change }] },
    ]);
    const update = jest.fn();
    const remove = jest.fn();
    await expect(restoreSplit({
      readAccount: async (accountId, since, until) => (await readStructuralAccounts(api, [accountId], since, until)).get(accountId)!,
      update, remove,
    }, {
      parent: preflightOf(parent, null, "checking"),
      children: [principal, interest].map((child) => preflightOf(child as RawTxn, parent, "checking")),
      counterpartAccountIds: [],
      restoreTo: stateOf(row("payment") as RawTxn, null, "checking"),
    })).rejects.toThrow(/Actual changed since the preview/);
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    undefined, { data: null }, { data: [{}] }, { data: [row("payment", { is_child: true })] },
    { data: [row("payment", { account: "other" })] }, { data: [row("payment", { date: "2026-07-01" })] },
    { data: [row("payment"), row("payment")] },
  ])("rejects incomplete or inconsistent parent evidence: %j", async (response) => {
    const { api, getTransactions } = setup([response]);
    await expect(readStructuralAccounts(api, ["checking"], date, date)).rejects.toThrow(/structural/);
    expect(getTransactions).not.toHaveBeenCalled();
  });

  it.each([
    undefined, { data: [row("ordinary")] },
    { data: [row("line", { is_child: true, parent_id: "unknown" })] },
    { data: [row("line", { is_child: true, parent_id: "payment" }), row("line", { is_child: true, parent_id: "payment" })] },
  ])("rejects incomplete or inconsistent child evidence: %j", async (response) => {
    const { api } = setup([{ data: [row("payment", { is_parent: true })] }, response]);
    await expect(readStructuralAccounts(api, ["checking"], date, date)).rejects.toThrow(/structural/);
  });

  it("propagates read errors instead of treating them as absence or switching readers", async () => {
    const { api, runQuery, getTransactions } = setup([]);
    runQuery.mockRejectedValue(new Error("read interrupted"));
    await expect(readStructuralAccounts(api, ["checking"], date, date)).rejects.toThrow("read interrupted");
    expect(getTransactions).not.toHaveBeenCalled();
  });

  it.each(["q", "runQuery"] as const)("retains the complete grouped fallback without %s", async (capability) => {
    const parent = { ...row("payment", { is_parent: true }), subtransactions: [row("line", { is_child: true })] };
    const { api, getTransactions, runQuery } = setup([]);
    api[capability] = undefined;
    getTransactions.mockResolvedValueOnce([parent]).mockResolvedValueOnce([]);
    expect(await readStructuralAccounts(api, ["checking", "loan"], date, date))
      .toEqual(new Map([["checking", [parent]], ["loan", []]]));
    expect(getTransactions.mock.calls).toEqual([["checking", date, date], ["loan", date, date]]);
    expect(runQuery).not.toHaveBeenCalled();
  });
});
