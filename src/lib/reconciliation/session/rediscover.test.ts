import { DEFAULT_MATCH_CONFIG } from "../match/config";
import type { ActualTransactionSnapshot, ReconciliationItem, StatementRow } from "../types";
import { REASON } from "./build";
import { rediscoverStatementMatches } from "./rediscover";

const row: StatementRow = {
  id: "s1", sourceRowNumber: 1, postedDate: "2026-03-10", amount: -2500,
  importedPayee: "CAREEM RIDE", raw: {}, fingerprint: "f1",
};
const fresh: ActualTransactionSnapshot = {
  id: "t-new", accountId: "a", date: "2026-03-10", amount: -2500, payeeId: "p", payeeName: "Careem Ride",
  importedPayee: null, categoryId: null, categoryName: null, notes: null, cleared: false, reconciled: false,
  importedId: null, transferId: null, scheduleId: null, isParent: false, isChild: false, parentId: null, splitLines: [],
};
const statementOnly = (disposition: ReconciliationItem["disposition"]): ReconciliationItem => ({
  id: "i1", statementRowIds: ["s1"], actualTransactionIds: [], disposition, reasonCode: REASON.noActualCandidate,
  guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
});

function run(items: ReconciliationItem[], newTransactions = [fresh], frozen: string[] = []) {
  let next = 0;
  return rediscoverStatementMatches({
    items, statementRows: new Map([["s1", row]]), newTransactions, config: DEFAULT_MATCH_CONFIG,
    transfersReported: true, statementPeriod: { start: "2026-03-01", end: "2026-03-31" },
    reconsider: new Set(["unresolved", "create"]), frozenItemIds: new Set(frozen), makeId: () => `new-${next++}`,
  });
}

describe("relating new Actual transactions to open statement rows", () => {
  it("reopens a row marked Create when its transaction appears, instead of listing it as Actual only", () => {
    const result = run([statementOnly("create")]);
    expect(result.reopened).toBe(1);
    expect(result.added).toBe(0);
    expect(result.items).toEqual([expect.objectContaining({
      id: "i1", disposition: "unresolved", actualTransactionIds: ["t-new"], reasonCode: REASON.newInActual,
    })]);
  });

  it("adds an unrelated new transaction as its own row", () => {
    const result = run([statementOnly("unresolved")], [{ ...fresh, amount: -9999, payeeName: "Other" }]);
    expect(result.reopened).toBe(0);
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ statementRowIds: [], actualTransactionIds: ["t-new"], reasonCode: REASON.notOnStatement });
  });

  it("never touches an applied row", () => {
    const result = run([statementOnly("create")], [fresh], ["i1"]);
    expect(result.reopened).toBe(0);
    expect(result.items[0]).toMatchObject({ id: "i1", disposition: "create" });
  });
});
