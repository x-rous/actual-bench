import { balanceImpact, type ApplyOperation, type ApplyPlan } from "./operations";

function planOf(operations: ApplyOperation[]): ApplyPlan {
  return { operations, alreadyApplied: 0, noWriteMatches: 0, unresolved: 0, blocked: [] };
}

const create = (amount: number, id = "c"): ApplyOperation => ({
  id: `create:${id}`,
  kind: "create",
  itemId: id,
  statementRowId: "s",
  accountId: "acct",
  date: "2026-07-01",
  amount,
  payeeId: null,
  payeeName: null,
  importedPayee: null,
  categoryId: null,
  notes: null,
  marker: `recon:${id}`,
});

const remove = (amount: number, id = "d"): ApplyOperation => ({
  id: `delete:${id}`,
  kind: "delete",
  itemId: id,
  transactionId: `t${id}`,
  accountId: "acct",
  date: "2026-07-01",
  amount,
});

const correct = (from: number, to: number, id = "u"): ApplyOperation => ({
  id: `update:${id}`,
  kind: "update",
  itemId: id,
  transactionId: `t${id}`,
  accountId: "acct",
  date: "2026-07-01",
  amount: from,
  patch: { amount: { original: from, staged: to, source: "manual" } },
});

describe("what applying does to the balance", () => {
  it("is zero when nothing changes", () => {
    expect(balanceImpact(planOf([]))).toBe(0);
  });

  it("adds a created transaction's amount", () => {
    expect(balanceImpact(planOf([create(-6850)]))).toBe(-6850);
  });

  it("reverses a deleted transaction's amount", () => {
    // Removing an outflow gives money back to the account.
    expect(balanceImpact(planOf([remove(-6850)]))).toBe(6850);
  });

  it("counts only the difference on a corrected amount", () => {
    // -24.38 becoming -66.15 costs the account the 41.77 difference, not 66.15.
    expect(balanceImpact(planOf([correct(-2438, -6615)]))).toBe(-4177);
  });

  it("ignores an update that does not touch the amount", () => {
    const notesOnly: ApplyOperation = {
      id: "update:n",
      kind: "update",
      itemId: "n",
      transactionId: "tn",
      accountId: "acct",
      date: "2026-07-01",
      amount: -1000,
      patch: { notes: { original: "a", staged: "b", source: "transform" } },
    };
    expect(balanceImpact(planOf([notesOnly]))).toBe(0);
  });

  it("nets everything together", () => {
    const plan = planOf([
      create(-6850, "a"),
      create(5000, "b"),
      remove(-1000, "c"),
      correct(-2438, -6615, "d"),
    ]);
    // -6850 + 5000 + 1000 - 4177
    expect(balanceImpact(plan)).toBe(-5027);
  });

  it("keeps whole minor units, with no rounding", () => {
    expect(balanceImpact(planOf([create(-1), create(-2, "b")]))).toBe(-3);
  });
});
