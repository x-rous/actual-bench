import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __configureNodeHostForTests, __resetNodeHostForTests, closeNodeRuntime, getNodeRuntime } from "./runtime/nodeHost";
import { openServerTransport } from "./serverTransport";
import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import type { ActualBenchTransport, SyncTargetTransactionInput } from "./transport";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";

/**
 * RD-084 P1.0 capability spike (tasks T009–T016): what Actual really does with
 * the transaction operations the debt features will depend on, in Direct and
 * HTTP mode, before any production posting code exists.
 *
 * **Writes to the budgets it is given.** It runs only when explicitly pointed
 * at disposable budgets, and refuses any budget whose name does not start with
 * "RD084 Spike":
 *
 *   RD084_SPIKE_DISPOSABLE=yes
 *   RD084_SPIKE_SERVER_URL, RD084_SPIKE_SERVER_PASSWORD   (Actual sync server, Direct)
 *   RD084_SPIKE_HTTP_URL, RD084_SPIKE_HTTP_KEY             (actual-http-api on that server)
 *   RD084_SPIKE_BUDGETS  path to a JSON file:
 *     { "RD084 Spike Direct": Budget, "RD084 Spike HTTP": Budget }
 *     Budget = { budgetSyncId, accounts: { checking, savings, mortgage, onLoan },
 *                categories: { loanPayment, interest, fees } }
 *     checking and savings on-budget, mortgage off-budget, onLoan an on-budget liability.
 *   RD084_SPIKE_EVIDENCE  optional path; the observed results are written there as JSON.
 *
 * Every scenario goes through Bench's own server transports (the same
 * `createTransactionsForSync` production uses) and, for the updates the
 * transport does not offer yet, through the primitive the production tasks
 * will use: the Direct runtime's `updateTransaction`, and HTTP
 * `PATCH /transactions/{id}` via `apiRequest`. Nothing here re-implements
 * Actual's behaviour; the assertions state what the approved plan expects
 * Actual to do (research R-06, R-07, R-17), so a failure is a finding.
 */

const env = process.env;
const live =
  env.RD084_SPIKE_DISPOSABLE === "yes" &&
  env.RD084_SPIKE_SERVER_URL &&
  env.RD084_SPIKE_SERVER_PASSWORD &&
  env.RD084_SPIKE_HTTP_URL &&
  env.RD084_SPIKE_HTTP_KEY &&
  env.RD084_SPIKE_BUDGETS
    ? describe
    : describe.skip;

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

type Budget = {
  budgetSyncId: string;
  accounts: { checking: string; savings: string; mortgage: string; onLoan: string };
  categories: { loanPayment: string; interest: string; fees: string };
};

type RawRow = Record<string, unknown> & { id: string; amount: number; subtransactions?: RawRow[] };

/** One mode's handle on its budget: Bench's transport plus the raw primitives. */
type Mode = {
  name: "direct" | "http";
  budget: Budget;
  transport: ActualBenchTransport;
  /** Actual `updateTransaction(id, fields)`: runtime call (Direct) or PATCH (HTTP). */
  update(id: string, fields: Record<string, unknown>): Promise<void>;
  /** Raw rows of one account as Actual returns them (split children inline). */
  rows(accountId: string): Promise<RawRow[]>;
  /** The transfer payee pointing at an account. */
  transferPayee(accountId: string): Promise<string>;
};

const evidence: Record<string, Record<string, unknown>> = { direct: {}, http: {} };
/** How long each Direct update took to become visible after `updateTransaction` resolved. */
const directSettleMs: number[] = [];

/** Progress on stderr: console is silenced, and a live run is slow enough to want it. */
function trace(message: string): void {
  process.stderr.write(`[rd084-spike] ${message}\n`);
}

live("RD-084 P1.0 transaction capability spike (disposable budgets)", () => {
  jest.setTimeout(600_000);
  let root: string;
  let modes: Mode[];
  let httpConnection: HttpApiConnection;
  const saved = { key: env.ACTUAL_BENCH_VAULT_KEY, db: env.ACTUAL_BENCH_DB_PATH };

  function flatten(rows: RawRow[]): RawRow[] {
    return rows.flatMap((r) => [r, ...(r.subtransactions ?? [])]);
  }

  async function find(mode: Mode, accountId: string, id: string): Promise<RawRow | undefined> {
    return flatten(await mode.rows(accountId)).find((r) => r.id === id);
  }

  /**
   * Finding (P1.0): Actual replaces a split child with exactly the fields sent, so
   * a partial update zeroes its amount and clears its category. Every child
   * update therefore carries the child's complete current fields.
   */
  function childFields(child: RawRow): Record<string, unknown> {
    return { amount: child.amount, category: child.category ?? null, payee: child.payee ?? null, notes: child.notes ?? null };
  }

  /**
   * Unique per run. Markers are recovered by equality, so reusing one across
   * runs makes recovery return an older row with the same marker: exactly the
   * hazard the posting generation counter exists for.
   */
  const run = Date.now().toString(36);

  let seq = 0;
  /** A unique day per scenario so rows never collide across scenarios. */
  function day(): string {
    seq += 1;
    return `2026-0${1 + Math.floor(seq / 28)}-${String(1 + (seq % 28)).padStart(2, "0")}`;
  }

  async function create(mode: Mode, input: SyncTargetTransactionInput): Promise<string> {
    trace(`${mode.name}: create ${input.importedId}`);
    const result = await mode.transport.createTransactionsForSync([input]);
    const id = result.created[0]?.transactionId;
    if (!id) throw new Error(`${mode.name}: created row not recovered by marker ${input.importedId}`);
    return id;
  }

  beforeAll(async () => {
    const all = JSON.parse(readFileSync(env.RD084_SPIKE_BUDGETS!, "utf8")) as Record<string, Budget>;
    for (const name of Object.keys(all)) {
      if (!name.startsWith("RD084 Spike")) throw new Error(`Refusing non-disposable budget "${name}"`);
    }
    const directBudget = all["RD084 Spike Direct"];
    const httpBudget = all["RD084 Spike HTTP"];
    if (!directBudget || !httpBudget) throw new Error("Both RD084 Spike Direct and RD084 Spike HTTP are required");

    root = mkdtempSync(join(tmpdir(), "rd084-spike-"));
    env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
    env.ACTUAL_BENCH_VAULT_KEY = "rd084-spike-operator-key";
    __configureNodeHostForTests({
      allowMainThread: true,
      snapshots: { lastSnapshotAt: () => new Date().toISOString(), recordSnapshot: () => {} },
      // RD084_SPIKE_TRACE_API=yes: log every Direct runtime call as it starts
      // and ends, to see which one a stalled run is waiting on.
      ...(env.RD084_SPIKE_TRACE_API === "yes"
        ? {
            loadApi: async () => {
              const actual = (await import("@actual-app/api")) as unknown as Record<string, unknown>;
              const traced: Record<string, unknown> = { ...actual };
              for (const [name, value] of Object.entries(actual)) {
                if (typeof value !== "function") continue;
                traced[name] = async (...args: unknown[]) => {
                  trace(`  api.${name} start`);
                  try {
                    return await (value as (...a: unknown[]) => unknown)(...args);
                  } finally {
                    trace(`  api.${name} end`);
                  }
                };
              }
              return traced as never;
            },
          }
        : {}),
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const directConn: BrowserApiConnection = {
      id: "rd084-spike-direct", label: "RD084 spike Direct", mode: "browser-api",
      baseUrl: env.RD084_SPIKE_SERVER_URL!, serverPassword: env.RD084_SPIKE_SERVER_PASSWORD!,
      budgetSyncId: directBudget.budgetSyncId,
    };
    const httpConn: HttpApiConnection = (httpConnection = {
      id: "rd084-spike-http", label: "RD084 spike HTTP", mode: "http-api",
      baseUrl: env.RD084_SPIKE_HTTP_URL!, apiKey: env.RD084_SPIKE_HTTP_KEY!,
      budgetSyncId: httpBudget.budgetSyncId,
    });

    /** Every row in the Direct budget's four accounts. */
    async function readAll(api: Awaited<ReturnType<typeof getNodeRuntime>>): Promise<unknown[]> {
      const out: unknown[] = [];
      for (const account of Object.values(directBudget.accounts)) {
        out.push(await api.getTransactions(account, "2000-01-01", "2100-01-01"));
      }
      return out;
    }

    /** The row with this id, wherever it is, including split children. */
    async function readRow(api: Awaited<ReturnType<typeof getNodeRuntime>>, id: string): Promise<unknown> {
      const accounts = Object.values(directBudget.accounts);
      for (const account of accounts) {
        const rows = (await api.getTransactions(account, "2000-01-01", "2100-01-01")) as unknown as RawRow[];
        const hit = flatten(rows).find((r) => r.id === id);
        if (hit) return hit;
      }
      return null;
    }

    const payeeCache = new Map<string, string>();
    async function transferPayeeFrom(list: Array<Record<string, unknown>>, accountId: string): Promise<string> {
      const found = list.find((p) => p.transfer_acct === accountId);
      if (!found) throw new Error(`no transfer payee for ${accountId}`);
      return String(found.id);
    }

    const direct: Mode = {
      name: "direct",
      budget: directBudget,
      transport: openServerTransport(directConn),
      async update(id, fields) {
        trace(`direct: update ${id}`);
        const api = await getNodeRuntime(directConn);
        // Finding (P1.0): Actual's `api/transaction-update` does not await its
        // batch write, so this resolves before the change exists. Settle it the
        // way production must: re-read until the change is visible, with a
        // deadline, before anything else touches the budget.
        // Settled means: the row changed, and then the whole budget read the same
        // twice across a quiet interval, so Actual's transfer processing for the
        // other leg (which runs after the row write) has finished too. Starting a
        // write inside that window deadlocks the Direct runtime (observed here).
        const before = JSON.stringify(await readRow(api, id));
        await api.updateTransaction(id, fields);
        const started = Date.now();
        const deadline = () => {
          if (Date.now() - started > 15_000) throw new Error(`direct: update of ${id} did not settle within 15s`);
        };
        while (JSON.stringify(await readRow(api, id)) === before) {
          deadline();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        let snapshot = JSON.stringify(await readAll(api));
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          const next = JSON.stringify(await readAll(api));
          if (next === snapshot) break;
          snapshot = next;
          deadline();
        }
        directSettleMs.push(Date.now() - started);
      },
      async rows(accountId) {
        const api = await getNodeRuntime(directConn);
        return (await api.getTransactions(accountId, "2000-01-01", "2100-01-01")) as unknown as RawRow[];
      },
      async transferPayee(accountId) {
        const key = `direct:${accountId}`;
        if (!payeeCache.has(key)) {
          const api = await getNodeRuntime(directConn);
          payeeCache.set(key, await transferPayeeFrom((await api.getPayees()) as unknown as Array<Record<string, unknown>>, accountId));
        }
        return payeeCache.get(key)!;
      },
    };
    const http: Mode = {
      name: "http",
      budget: httpBudget,
      transport: openServerTransport(httpConn),
      async update(id, fields) {
        trace(`http: update ${id}`);
        await apiRequest(httpConn, `/transactions/${id}`, { method: "PATCH", body: { transaction: fields } });
      },
      async rows(accountId) {
        const res = await apiRequest<{ data: RawRow[] }>(httpConn, `/accounts/${accountId}/transactions?since_date=2000-01-01`);
        return res.data;
      },
      async transferPayee(accountId) {
        const key = `http:${accountId}`;
        if (!payeeCache.has(key)) {
          const res = await apiRequest<{ data: Array<Record<string, unknown>> }>(httpConn, "/payees");
          payeeCache.set(key, await transferPayeeFrom(res.data, accountId));
        }
        return payeeCache.get(key)!;
      },
    };
    modes = [direct, http];
  });

  afterAll(async () => {
    evidence.direct.updateSettleMs = directSettleMs;
    if (env.RD084_SPIKE_EVIDENCE) writeFileSync(env.RD084_SPIKE_EVIDENCE, JSON.stringify(evidence, null, 2));
    await closeNodeRuntime();
    __resetNodeHostForTests();
    jest.restoreAllMocks();
    resetAppDbForTests();
    if (root) rmSync(root, { recursive: true, force: true });
    delete env.ACTUAL_BENCH_RUNTIME_DIR;
    for (const [name, value] of Object.entries({ ACTUAL_BENCH_VAULT_KEY: saved.key, ACTUAL_BENCH_DB_PATH: saved.db })) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  });

  /** A bank repayment of -8,300 in Checking, restructured into principal / interest / fee. */
  async function splitRepayment(mode: Mode, tag: string, principalPayee: string | null, principalCategory: string | null) {
    const { accounts, categories } = mode.budget;
    const date = day();
    const bankId = await create(mode, {
      accountId: accounts.checking, date, amount: -830000, payeeName: "Home Lender", importedId: `spike:${tag}:bank:${run}`,
    });
    await mode.update(bankId, {
      subtransactions: [
        { amount: -695000, payee: principalPayee, category: principalCategory, notes: "principal" },
        { amount: -130000, category: categories.interest, notes: "interest" },
        { amount: -5000, category: categories.fees, notes: "fee" },
      ],
    });
    const parent = (await mode.rows(accounts.checking)).find((r) => r.id === bankId)!;
    const children = parent.subtransactions ?? [];
    return { date, bankId, parent, children, principal: children.find((c) => c.notes === "principal")! };
  }

  it("T010 (a): updateTransaction with subtransactions restructures an existing row into a split", async () => {
    for (const mode of modes) {
      const { mortgage } = mode.budget.accounts;
      const before = (await mode.rows(mortgage)).length;
      const { parent, children, principal } = await splitRepayment(
        mode, "t010", await mode.transferPayee(mortgage), mode.budget.categories.loanPayment
      );
      const counterpart = principal.transfer_id ? await find(mode, mortgage, String(principal.transfer_id)) : undefined;
      evidence[mode.name].t010 = {
        isParent: parent.is_parent,
        childCount: children.length,
        childSum: children.reduce((s, c) => s + c.amount, 0),
        principalTransferId: principal.transfer_id ?? null,
        principalCategory: principal.category ?? null,
        counterpart: counterpart ? { amount: counterpart.amount, category: counterpart.category ?? null, transfer_id: counterpart.transfer_id } : null,
        mortgageRowsAdded: (await mode.rows(mortgage)).length - before,
      };
      expect(parent.is_parent).toBe(true);
      expect(children).toHaveLength(3);
      expect(children.reduce((s, c) => s + c.amount, 0)).toBe(-830000);
      expect(counterpart).toMatchObject({ amount: 695000, transfer_id: principal.id });
      expect((await mode.rows(mortgage)).length - before).toBe(1);
    }
  });

  it("T010b: a partial update of a split child replaces it (amount zeroed, category cleared)", async () => {
    for (const mode of modes) {
      const { checking } = mode.budget.accounts;
      const { bankId, children } = await splitRepayment(mode, "t010b", null, mode.budget.categories.loanPayment);
      const principal = children.find((c) => c.notes === "principal")!;
      await mode.update(principal.id, { notes: "principal (partial update)" });
      const parent = (await mode.rows(checking)).find((r) => r.id === bankId)!;
      const after = (parent.subtransactions ?? []).find((c) => c.id === principal.id)!;
      evidence[mode.name].t010b = {
        childAmountAfterPartialUpdate: after.amount,
        childCategoryAfterPartialUpdate: after.category ?? null,
        parentError: parent.error ?? null,
      };
      expect(after.amount).toBe(0);
      expect(after.category ?? null).toBeNull();
    }
  });

  /** A lender row already in the Mortgage account, as bank sync would import it. */
  async function lenderRow(mode: Mode, tag: string, date: string, amount: number, extra: Record<string, unknown> = {}) {
    const id = await create(mode, {
      accountId: mode.budget.accounts.mortgage, date, amount, payeeName: "Home Lender",
      importedPayee: "LENDER REPAYMENT RECEIVED", notes: "lender import", cleared: true, importedId: `lender:${tag}:${run}`,
    });
    if (Object.keys(extra).length > 0) await mode.update(id, extra);
    return id;
  }

  it("T011 (b): the two-call link reuses the lender row as the counterpart, inserting nothing", async () => {
    for (const mode of modes) {
      const { mortgage, checking } = mode.budget.accounts;
      const { date, principal } = await splitRepayment(mode, "t011", null, mode.budget.categories.loanPayment);
      const lenderId = await lenderRow(mode, "t011", date, 695000);
      const lenderBefore = (await find(mode, mortgage, lenderId))!;
      const mortgageCountBefore = (await mode.rows(mortgage)).length;

      await mode.update(principal.id, { ...childFields(principal), payee: await mode.transferPayee(mortgage), transfer_id: lenderId, notes: lenderBefore.notes ?? null });
      const afterCall1 = { child: (await find(mode, checking, principal.id))!, lender: (await find(mode, mortgage, lenderId))! };
      const countAfterCall1 = (await mode.rows(mortgage)).length;

      await mode.update(lenderId, { transfer_id: principal.id });
      const child = (await find(mode, checking, principal.id))!;
      const lender = (await find(mode, mortgage, lenderId))!;

      evidence[mode.name].t011 = {
        mortgageRowsAddedByCall1: countAfterCall1 - mortgageCountBefore,
        afterCall1: { childTransferId: afterCall1.child.transfer_id ?? null, lenderTransferId: afterCall1.lender.transfer_id ?? null, lenderPayee: afterCall1.lender.payee },
        final: {
          childTransferId: child.transfer_id, childPayee: child.payee, childCategory: child.category ?? null,
          lenderTransferId: lender.transfer_id, lenderPayee: lender.payee, lenderAmount: lender.amount,
          lenderCategory: lender.category ?? null, lenderNotes: lender.notes ?? null,
          lenderImportedId: lender.imported_id ?? null, lenderImportedPayee: lender.imported_payee ?? null,
          lenderCleared: lender.cleared, lenderDate: lender.date,
        },
        mortgageRowsAddedTotal: (await mode.rows(mortgage)).length - mortgageCountBefore,
      };

      expect(countAfterCall1).toBe(mortgageCountBefore);
      expect((await mode.rows(mortgage)).length).toBe(mortgageCountBefore);
      expect(child.transfer_id).toBe(lenderId);
      expect(lender.transfer_id).toBe(principal.id);
      expect(lender).toMatchObject({
        amount: 695000,
        imported_id: lenderBefore.imported_id,
        imported_payee: lenderBefore.imported_payee,
        cleared: lenderBefore.cleared,
        date: lenderBefore.date,
      });
    }
  });

  it("T012 (c): a half-linked pair is detectable and call 2 completes it without insertion", async () => {
    for (const mode of modes) {
      const { mortgage, checking } = mode.budget.accounts;
      const { date, principal } = await splitRepayment(mode, "t012", null, null);
      const lenderId = await lenderRow(mode, "t012", date, 695000);
      await mode.update(principal.id, { ...childFields(principal), payee: await mode.transferPayee(mortgage), transfer_id: lenderId });

      const child = (await find(mode, checking, principal.id))!;
      const lender = (await find(mode, mortgage, lenderId))!;
      const halfLinked = child.transfer_id === lenderId && !lender.transfer_id;
      const count = (await mode.rows(mortgage)).length;
      await mode.update(lenderId, { transfer_id: principal.id });
      const completed = (await find(mode, mortgage, lenderId))!;
      const mortgageRowsAddedByCompletion = (await mode.rows(mortgage)).length - count;

      // The risk the plan names: editing the lender row while half-linked.
      const risk = await splitRepayment(mode, "t012-risk", null, null);
      const riskLender = await lenderRow(mode, "t012-risk", risk.date, 695000);
      await mode.update(risk.principal.id, { ...childFields(risk.principal), payee: await mode.transferPayee(mortgage), transfer_id: riskLender });
      const checkingBefore = flatten(await mode.rows(checking)).length;
      await mode.update(riskLender, { notes: "edited while half-linked" });
      const checkingAfter = flatten(await mode.rows(checking)).length;

      evidence[mode.name].t012 = {
        halfLinkedDetectable: halfLinked,
        completedReciprocal: completed.transfer_id === principal.id,
        mortgageRowsAddedByCompletion,
        editWhileHalfLinkedInsertedRowsInChecking: checkingAfter - checkingBefore,
      };
      expect(halfLinked).toBe(true);
      expect(completed.transfer_id).toBe(principal.id);
      expect(mortgageRowsAddedByCompletion).toBe(0);
    }
  });

  it("T013 (d): transfer_id is returned on transaction reads (raw and through Bench's transport)", async () => {
    for (const mode of modes) {
      const { mortgage } = mode.budget.accounts;
      const raw = (await mode.rows(mortgage)).filter((r) => r.transfer_id);
      const viaTransport = (await mode.transport.listTransactionsForSync({ accountId: mortgage })).filter((r) => r.transferId);
      evidence[mode.name].t013 = { rawRowsWithTransferId: raw.length, transportRowsWithTransferId: viaTransport.length };
      expect(raw.length).toBeGreaterThan(0);
      expect(viaTransport.length).toBe(raw.length);
    }
  });

  it("T011b: linking overwrites a mismatched lender amount, and changes a reconciled lender row", async () => {
    for (const mode of modes) {
      const { mortgage } = mode.budget.accounts;
      const mismatch = await splitRepayment(mode, "t011b-amount", null, null);
      const offBy = await lenderRow(mode, "t011b-amount", mismatch.date, 695100);
      await mode.update(mismatch.principal.id, { ...childFields(mismatch.principal), payee: await mode.transferPayee(mortgage), transfer_id: offBy });
      const offByAfter = (await find(mode, mortgage, offBy))!;

      const rec = await splitRepayment(mode, "t011b-reconciled", null, null);
      const reconciledLender = await lenderRow(mode, "t011b-reconciled", rec.date, 695000, { reconciled: true });
      const recBefore = (await find(mode, mortgage, reconciledLender))!;
      await mode.update(rec.principal.id, { ...childFields(rec.principal), payee: await mode.transferPayee(mortgage), transfer_id: reconciledLender });
      const recAfter = (await find(mode, mortgage, reconciledLender))!;

      const restructuredReconciled = await create(mode, {
        accountId: mode.budget.accounts.checking, date: day(), amount: -1000, payeeName: "Reconciled Row", importedId: `spike:t011b:rec-bank:${run}`,
      });
      await mode.update(restructuredReconciled, { reconciled: true });
      let restructureRejected: string | null = null;
      try {
        await mode.update(restructuredReconciled, { subtransactions: [{ amount: -600 }, { amount: -400 }] });
      } catch (err) {
        restructureRejected = err instanceof Error ? err.message : String(err);
      }
      const recBank = (await mode.rows(mode.budget.accounts.checking)).find((r) => r.id === restructuredReconciled)!;

      evidence[mode.name].t011b = {
        mismatchedLenderAmountBefore: 695100,
        mismatchedLenderAmountAfterCall1: offByAfter.amount,
        reconciledLender: {
          reconciledBefore: recBefore.reconciled, reconciledAfter: recAfter.reconciled,
          payeeChanged: recBefore.payee !== recAfter.payee, notesBefore: recBefore.notes ?? null, notesAfter: recAfter.notes ?? null,
        },
        reconciledBankRowRestructure: { rejectedByActual: restructureRejected, isParentAfter: recBank.is_parent ?? false },
      };
      // Actual does not protect either row: Bench's preflight must (FR-013a, FR-072).
      expect(offByAfter.amount).toBe(695000);
      expect(recAfter.payee).not.toBe(recBefore.payee);
    }
  });

  it("T014 (e): categories are cleared in off-budget accounts and kept on the on-budget side of a boundary transfer", async () => {
    for (const mode of modes) {
      const { accounts, categories } = mode.budget;
      const offBudgetCharge = await create(mode, {
        accountId: accounts.mortgage, date: day(), amount: -125000, payeeName: "Home Lender", categoryId: categories.interest, importedId: `spike:t014:off:${run}`,
      });
      const onBudgetLiabilityCharge = await create(mode, {
        accountId: accounts.onLoan, date: day(), amount: -25000, payeeName: "Car Lender", categoryId: categories.interest, importedId: `spike:t014:on:${run}`,
      });
      const boundary = await create(mode, {
        accountId: accounts.checking, date: day(), amount: -400000, payeeId: await mode.transferPayee(accounts.mortgage),
        categoryId: categories.loanPayment, importedId: `spike:t014:boundary:${run}`,
      });
      const bothOn = await create(mode, {
        accountId: accounts.checking, date: day(), amount: -300000, payeeId: await mode.transferPayee(accounts.savings),
        categoryId: categories.loanPayment, importedId: `spike:t014:bothon:${run}`,
      });
      const drawFromOffBudget = await create(mode, {
        accountId: accounts.mortgage, date: day(), amount: -500000, payeeId: await mode.transferPayee(accounts.checking), importedId: `spike:t014:draw:${run}`,
      });

      const get = (acct: string, id: string) => find(mode, acct, id);
      const boundaryRow = (await get(accounts.checking, boundary))!;
      const bothOnRow = (await get(accounts.checking, bothOn))!;
      const drawRow = (await get(accounts.mortgage, drawFromOffBudget))!;
      const result = {
        offBudgetChargeCategory: (await get(accounts.mortgage, offBudgetCharge))!.category ?? null,
        onBudgetLiabilityChargeCategory: (await get(accounts.onLoan, onBudgetLiabilityCharge))!.category ?? null,
        boundaryOnBudgetSideCategory: boundaryRow.category ?? null,
        boundaryOffBudgetSideCategory: (await get(accounts.mortgage, String(boundaryRow.transfer_id)))?.category ?? null,
        bothOnBudgetSourceCategory: bothOnRow.category ?? null,
        bothOnBudgetCounterpartCategory: (await get(accounts.savings, String(bothOnRow.transfer_id)))?.category ?? null,
        drawCounterpartOnBudgetCategory: (await get(accounts.checking, String(drawRow.transfer_id)))?.category ?? null,
      };
      evidence[mode.name].t014 = result;

      expect(result.offBudgetChargeCategory).toBeNull();
      expect(result.onBudgetLiabilityChargeCategory).toBe(categories.interest);
      expect(result.boundaryOnBudgetSideCategory).toBe(categories.loanPayment);
      expect(result.boundaryOffBudgetSideCategory).toBeNull();
      expect(result.bothOnBudgetSourceCategory).toBeNull();
      expect(result.bothOnBudgetCounterpartCategory).toBeNull();
    }
  });

  it("T015 (R-08): a formula-mode rule with IPMT and a remainder split round-trips and runs", async () => {
    for (const mode of modes) {
      const { accounts } = mode.budget;
      // Finding (P1.0): over HTTP, `createOrResolvePayee` returns no id for a new
      // payee (actual-http-api answers `{ data: "<id>" }`, Bench reads an object).
      // Record it, then resolve the id by name so the formula check still runs.
      const payeeName = `Formula Lender ${mode.name} ${run}`;
      const createdPayeeId = (await mode.transport.createOrResolvePayee({ name: payeeName })).id ?? null;
      const payee = (await mode.transport.getPayees()).find((p) => p.name === payeeName)!.id;
      const rule = await mode.transport.createRule({
        stage: "default",
        conditionsOp: "and",
        conditions: [{ field: "payee", op: "is", value: payee, type: "id" }],
        actions: [
          { op: "set-split-amount", value: null, options: { splitIndex: 1, method: "formula", formula: "=IPMT(0.05/12, 1, 360, 300000)" } },
          { op: "set-split-amount", value: null, options: { splitIndex: 2, method: "remainder" } },
        ],
      } as never);
      const readBack = (await mode.transport.getRules()).find((r) => r.id === rule.id);

      const matched = await create(mode, {
        accountId: accounts.checking, date: day(), amount: -161000, payeeId: payee, importedId: `spike:t015:${mode.name}:${run}`,
      });
      const row = (await mode.rows(accounts.checking)).find((r) => r.id === matched)!;
      if (mode.name === "http") {
        const raw = await apiRequest<{ data: unknown }>(httpConnection, `/rules/${rule.id}`);
        trace(`http: stored rule ${JSON.stringify(raw.data)}`);
      }
      await mode.transport.deleteRule(rule.id);

      evidence[mode.name].t015PayeeCreate = { transportReturnedId: typeof createdPayeeId === "string" && createdPayeeId.length > 0 };
      evidence[mode.name].t015 = {
        ruleActionsReadBack: readBack?.actions ?? null,
        appliedSplit: row.is_parent ? (row.subtransactions ?? []).map((c) => c.amount) : null,
      };
      expect(readBack).toBeDefined();
    }
  });

  it("T010–T015 parity: Direct and HTTP observed the same behaviour", () => {
    // Ids, dates and accumulated row counts differ between two budgets by nature;
    // everything else must match.
    const strip = (v: unknown) =>
      JSON.parse(
        JSON.stringify(v, (k, val) => {
          if (/(Id|_id|Payee|payee|Category|category)$/.test(k) && typeof val === "string") return "<id>";
          if (/(Date|date)$/.test(k) && typeof val === "string") return "<date>";
          if (/WithTransferId$/.test(k) && typeof val === "number") return val > 0 ? "<some>" : 0;
          return val;
        })
      );
    for (const key of ["t010", "t010b", "t011", "t012", "t013", "t011b", "t014", "t015"]) {
      expect({ key, http: strip(evidence.http[key]) }).toEqual({ key, http: strip(evidence.direct[key]) });
    }
  });
});
