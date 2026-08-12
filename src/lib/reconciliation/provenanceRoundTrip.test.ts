/**
 * The end-to-end claim the whole imported-payee work exists for
 * (analysis doc §29.6, RD-072 §6).
 *
 * Every link in this chain is unit-tested on its own: the planner derives the
 * bank text, the executor forwards it, the adapter maps it onto the shared
 * transport input, the transports write it, the read side maps it back, and the
 * matcher can score against it. What nothing tested was the chain *as a chain* —
 * and a field that survives six hops and is dropped at the seventh is worth
 * exactly as much as one that was never written.
 *
 * So this runs the real planner, the real executor and the real adapter over a
 * fake `ActualBenchTransport` that only stores what it is given, then reads the
 * account back and matches next month's statement against it. It fails if any
 * hop loses `imported_payee`, and it is the test that says why the field is
 * written at all: provenance is *evidence*, reusable in a later session, not a
 * decoration on a transaction nobody will look at again.
 */

import type {
  ActualBenchTransport,
  SyncSourceTransaction,
  SyncTargetTransactionInput,
} from "@/lib/actual/transport";
import { executeApplyPlan } from "./apply/executor";
import { DEFAULT_MATCH_CONFIG, TEXT_TARGET_PRESETS } from "./match/config";
import { match } from "./match/matcher";
import { buildApplyPlan } from "./session/plan";
import { createReconciliationTransport } from "./transportAdapter";
import type { MatchConfig, ReconciliationItem, StatementRow } from "./types";

/** The raw bank text, as a card statement really prints it. */
const BANK_TEXT = "AMZN Mktp AE*82K39 DUBAI";
/** What the user calls it in Actual. */
const CURATED_PAYEE = "Amazon";

function statementRow(overrides: Partial<StatementRow> & Pick<StatementRow, "id">): StatementRow {
  return {
    sourceRowNumber: 1,
    postedDate: "2026-08-01",
    amount: -12550,
    importedPayee: BANK_TEXT,
    raw: {},
    fingerprint: `fp-${overrides.id}`,
    ...overrides,
  };
}

/**
 * A budget that stores transactions and hands them back.
 *
 * Deliberately dumb: it resolves payees by name and records the fields it is
 * given, exactly as far as Actual's own model does, so anything this test
 * observes is a property of *our* pipeline rather than of the fake.
 */
function fakeBudget() {
  const payees = new Map<string, string>([[CURATED_PAYEE, "payee-amazon"]]);
  const rows: SyncSourceTransaction[] = [];
  let nextId = 1;

  const transport: Partial<ActualBenchTransport> = {
    async createOrResolvePayee({ name }: { name: string }) {
      const existing = payees.get(name);
      if (existing) return { id: existing, name, created: false };
      const id = `payee-${payees.size + 1}`;
      payees.set(name, id);
      return { id, name, created: true };
    },

    async createTransactionsForSync(inputs: SyncTargetTransactionInput[]) {
      return {
        created: inputs.map((input, requestIndex) => {
          // Mirrors both transports: a name is resolved to an id before the
          // write, which is exactly why `imported_payee` has to travel
          // separately — no `payee_name` survives for Actual to derive it from.
          let payeeId = input.payeeId ?? null;
          let payeeName: string | null =
            [...payees].find(([, id]) => id === payeeId)?.[0] ?? null;
          if (!payeeId && input.payeeName) {
            const resolved = payees.get(input.payeeName) ?? `payee-${payees.size + 1}`;
            payees.set(input.payeeName, resolved);
            payeeId = resolved;
            payeeName = input.payeeName;
          }

          const id = `txn-${nextId++}`;
          rows.push({
            id,
            accountId: input.accountId,
            date: input.date,
            amount: input.amount,
            payeeId,
            payeeName,
            categoryId: input.categoryId ?? null,
            categoryName: null,
            notes: input.notes ?? null,
            cleared: input.cleared ?? false,
            reconciled: false,
            importedId: input.importedId ?? null,
            importedPayee: input.importedPayee ?? null,
            transferId: null,
            scheduleId: null,
            isParent: false,
            isChild: false,
            parentId: null,
            splitLines: [],
          });

          return {
            requestIndex,
            transactionId: id,
            importedId: input.importedId ?? null,
            resolvedPayeeId: payeeId,
            applied: null,
          };
        }),
      };
    },

    async listTransactionsForSync() {
      return rows;
    },
  };

  return { transport: transport as ActualBenchTransport, rows };
}

/** Apply a single create decision for `row`, with an optional staged payee. */
async function applyCreate(
  budget: ReturnType<typeof fakeBudget>,
  row: StatementRow,
  stagedPayeeId?: string
) {
  const item: ReconciliationItem = {
    id: "i1",
    statementRowIds: [row.id],
    actualTransactionIds: [],
    disposition: "create",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    ...(stagedPayeeId
      ? {
          stagedChanges: {
            payeeId: { original: null, staged: stagedPayeeId, source: "manual" as const },
          },
        }
      : {}),
  };

  const plan = buildApplyPlan({
    sessionId: "sess-1",
    budgetSyncId: "budget-1",
    accountId: "acct-1",
    items: [item],
    statementRows: new Map([[row.id, row]]),
    transactions: new Map(),
  });

  const result = await executeApplyPlan({
    plan,
    transport: createReconciliationTransport(budget.transport),
  });

  expect(result.failed).toBe(0);
  return plan;
}

/** Load the account the way a new session does, and match `rows` against it. */
async function rematch(
  budget: ReturnType<typeof fakeBudget>,
  rows: StatementRow[],
  config: MatchConfig
) {
  const window = await createReconciliationTransport(budget.transport).loadTransactions({
    accountId: "acct-1",
    startDate: "2026-08-01",
    endDate: "2026-09-30",
  });

  return match({ statementRows: rows, actualTransactions: window.transactions, config });
}

describe("bank provenance survives the write and is evidence next month", () => {
  it("keeps the curated payee and the bank's text on the created transaction", async () => {
    const budget = fakeBudget();
    await applyCreate(budget, statementRow({ id: "s1" }), "payee-amazon");

    expect(budget.rows).toHaveLength(1);
    expect(budget.rows[0]).toMatchObject({
      payeeId: "payee-amazon",
      payeeName: CURATED_PAYEE,
      importedPayee: BANK_TEXT,
      importedId: expect.stringMatching(/^recon:/),
    });
  });

  it("matches next month's statement against the imported payee", async () => {
    const budget = fakeBudget();
    await applyCreate(budget, statementRow({ id: "s1" }), "payee-amazon");

    // A later session, same merchant, same amount, a month on. The curated payee
    // says "Amazon" and the statement says "AMZN Mktp AE*82K39 DUBAI" — so only
    // the imported payee can carry this match.
    const graph = await rematch(
      budget,
      [statementRow({ id: "s2", postedDate: "2026-08-03" })],
      { ...DEFAULT_MATCH_CONFIG, text: TEXT_TARGET_PRESETS["imported-payee"] }
    );

    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].tier).toBe("amount-date-text");
    expect(graph.matched[0].reasons).toContainEqual(
      expect.objectContaining({ kind: "text", field: "importedPayee" })
    );
  });

  it("matches on the curated payee when the statement uses that name instead", async () => {
    const budget = fakeBudget();
    await applyCreate(budget, statementRow({ id: "s1" }), "payee-amazon");

    const graph = await rematch(
      budget,
      [statementRow({ id: "s2", postedDate: "2026-08-03", importedPayee: CURATED_PAYEE })],
      { ...DEFAULT_MATCH_CONFIG, text: TEXT_TARGET_PRESETS["payee-only"] }
    );

    // Both channels are live evidence; which one carries a session depends on
    // what the bank prints, not on which one we wrote.
    expect(graph.matched).toHaveLength(1);
    expect(graph.matched[0].reasons).toContainEqual(
      expect.objectContaining({ kind: "text", field: "payeeName" })
    );
  });

  it("resolves a payee from the bank text when the user staged none, and still records it raw", async () => {
    const budget = fakeBudget();
    await applyCreate(budget, statementRow({ id: "s1" }));

    // The payee is created from the merchant string, and the merchant string is
    // *also* kept as provenance — the two are not alternatives (RD-072 §2).
    expect(budget.rows[0].payeeName).toBe(BANK_TEXT);
    expect(budget.rows[0].importedPayee).toBe(BANK_TEXT);
  });
});
