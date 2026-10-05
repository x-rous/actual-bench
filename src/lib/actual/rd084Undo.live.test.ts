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
/** Direct writes that left the row unchanged. */
const noChangeWrites: { id: string; fields: string[] }[] = [];

/** Progress on stderr: console is silenced, and a live run is slow enough to want it. */
function trace(message: string): void {
  process.stderr.write(`[rd084-undo] ${message}\n`);
}

live("RD-084 P1.6 undo and transfer write shapes (disposable budgets)", () => {
  jest.setTimeout(600_000);
  let root: string;
  let modes: Mode[];
  const saved = { key: env.ACTUAL_BENCH_VAULT_KEY, db: env.ACTUAL_BENCH_DB_PATH };

  function flatten(rows: RawRow[]): RawRow[] {
    return rows.flatMap((r) => [r, ...(r.subtransactions ?? [])]);
  }

  async function find(mode: Mode, accountId: string, id: string): Promise<RawRow | undefined> {
    return flatten(await mode.rows(accountId)).find((r) => r.id === id);
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
    return `2025-0${1 + Math.floor(seq / 28)}-${String(1 + (seq % 28)).padStart(2, "0")}`;
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

    root = mkdtempSync(join(tmpdir(), "rd084-undo-"));
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
    const httpConn: HttpApiConnection = {
      id: "rd084-spike-http", label: "RD084 spike HTTP", mode: "http-api",
      baseUrl: env.RD084_SPIKE_HTTP_URL!, apiKey: env.RD084_SPIKE_HTTP_KEY!,
      budgetSyncId: httpBudget.budgetSyncId,
    };

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
        // A write that changes nothing is a finding here, not a failure: record it and move on.
        while (JSON.stringify(await readRow(api, id)) === before) {
          if (Date.now() - started > 5_000) {
            noChangeWrites.push({ id, fields: Object.keys(fields) });
            trace(`direct: update of ${id} (${Object.keys(fields).join(",")}) changed nothing`);
            return;
          }
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
    evidence.direct.noChangeWrites = noChangeWrites;
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


  /** The fields an exact restoration must bring back, as Actual stores them. */
  const FIELDS = ["id", "account", "date", "amount", "payee", "category", "notes", "cleared", "reconciled", "imported_id", "imported_payee", "transfer_id", "is_parent", "is_child", "parent_id"] as const;
  function pick(row: RawRow | undefined): Record<string, unknown> | null {
    if (!row) return null;
    return Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? null]));
  }
  function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Record<string, [unknown, unknown]> {
    const out: Record<string, [unknown, unknown]> = {};
    for (const f of FIELDS) {
      const b = before?.[f] ?? null;
      const a = after?.[f] ?? null;
      if (JSON.stringify(b) !== JSON.stringify(a)) out[f] = [b, a];
    }
    return out;
  }
  /** Direct writes resolve before they land (R-18): wait until two reads of the budget agree. */
  async function settleDirect(mode: Mode): Promise<void> {
    if (mode.name !== "direct") return;
    let last = "";
    for (let i = 0; i < 40; i++) {
      const now = JSON.stringify(await Promise.all(Object.values(mode.budget.accounts).map((a) => mode.rows(a))));
      if (now === last) return;
      last = now;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  async function ids(mode: Mode, accountId: string): Promise<string[]> {
    return flatten(await mode.rows(accountId)).map((r) => r.id).sort();
  }
  async function lender(mode: Mode): Promise<string> {
    const name = `RD084 Undo Lender ${mode.name} ${run}`;
    const resolved = await mode.transport.createOrResolvePayee({ name });
    return resolved.id;
  }

  it("T276a: a restructured split (principal as a transfer) can be restored to the original row", async () => {
    for (const mode of modes) {
      const { accounts, categories } = mode.budget;
      const lenderId = await lender(mode);
      const date = day();
      const id = await create(mode, { accountId: accounts.checking, date, amount: -8300, payeeId: lenderId, categoryId: categories.loanPayment, notes: "bank note", importedPayee: "HOME LENDER 123", cleared: true, importedId: `undo:a:${mode.name}:${run}` });
      const before = pick(await find(mode, accounts.checking, id));
      const liabilityBefore = await ids(mode, accounts.mortgage);
      const checkingBefore = await ids(mode, accounts.checking);
      await mode.update(id, { subtransactions: [
        { amount: -5000, category: categories.loanPayment, payee: await mode.transferPayee(accounts.mortgage), notes: "Principal" },
        { amount: -3300, category: categories.interest, payee: lenderId, notes: "Interest" },
      ] });
      const split = await find(mode, accounts.checking, id);
      const counterpart = (await mode.rows(accounts.mortgage)).find((r) => !liabilityBefore.includes(r.id));
      // Undo: delete the split lines one at a time (deleting the last one makes the parent a normal
      // row again; deleting the transfer line removes the counterpart Actual made), then restore the
      // row's own fields.
      const childIds = (split?.subtransactions ?? []).map((c) => c.id);
      const afterEach: unknown[] = [];
      for (const childId of childIds) {
        await mode.transport.deleteTransactionForSync({ transactionId: childId });
        await settleDirect(mode);
        const now = await find(mode, accounts.checking, id);
        afterEach.push({ isParent: now?.is_parent ?? null, children: (now?.subtransactions ?? []).length, amount: now?.amount });
      }
      const afterEmpty = pick(await find(mode, accounts.checking, id));
      await mode.update(id, { payee: before!.payee, category: before!.category, notes: before!.notes });
      const after = pick(await find(mode, accounts.checking, id));
      const liabilityAfter = await ids(mode, accounts.mortgage);
      const checkingAfter = await ids(mode, accounts.checking);
      evidence[mode.name].t276a = {
        split: { isParent: split?.is_parent, children: (split?.subtransactions ?? []).length, counterpartCreated: !!counterpart, counterpartTransferId: counterpart?.transfer_id ?? null },
        afterEachChildDelete: afterEach,
        afterChildrenDeleted: { isParent: afterEmpty?.is_parent, diffFromBefore: diff(before, afterEmpty) },
        restoredDiff: diff(before, after),
        liabilityRowsUnchanged: JSON.stringify(liabilityAfter) === JSON.stringify(liabilityBefore),
        checkingRowsUnchanged: JSON.stringify(checkingAfter) === JSON.stringify(checkingBefore),
      };
      trace(`${mode.name} t276a ${JSON.stringify(evidence[mode.name].t276a)}`);
    }
  });

  it("T276b: a two-call link (plain row and split child) can be undone, restoring both rows", async () => {
    for (const mode of modes) {
      const { accounts, categories } = mode.budget;
      const lenderId = await lender(mode);
      const out: Record<string, unknown> = {};
      for (const shape of ["plain", "split-child"] as const) {
        const date = day();
        const bank = await create(mode, { accountId: accounts.checking, date, amount: -8300, payeeId: lenderId, categoryId: categories.loanPayment, notes: "bank note", importedPayee: "HOME LENDER", cleared: true, importedId: `undo:b:${shape}:bank:${mode.name}:${run}` });
        const bankOriginal = pick(await find(mode, accounts.checking, bank));
        let source = bank;
        let sourceAmount = -8300;
        if (shape === "split-child") {
          await mode.update(bank, { subtransactions: [
            { amount: -5000, category: categories.loanPayment, payee: lenderId, notes: "Principal" },
            { amount: -3300, category: categories.interest, payee: lenderId, notes: "Interest" },
          ] });
          const parent = await find(mode, accounts.checking, bank);
          source = parent!.subtransactions![0].id;
          sourceAmount = -5000;
        }
        const lenderRow = await create(mode, { accountId: accounts.mortgage, date, amount: -sourceAmount, payeeId: lenderId, notes: "lender import", importedPayee: "LENDER FEED", cleared: true, importedId: `undo:b:${shape}:lender:${mode.name}:${run}` });
        const srcBefore = pick(await find(mode, accounts.checking, source));
        const lenderBefore = pick(await find(mode, accounts.mortgage, lenderRow));
        const liabilityBefore = await ids(mode, accounts.mortgage);
        const checkingBefore = await ids(mode, accounts.checking);
        // The link, exactly as Bench applies it (source first, then the counterpart).
        const srcRaw = await find(mode, accounts.checking, source);
        await mode.update(source, { amount: srcRaw!.amount, category: srcRaw!.category ?? null, payee: await mode.transferPayee(accounts.mortgage), notes: lenderBefore!.notes, transfer_id: lenderRow });
        await mode.update(lenderRow, { transfer_id: source });
        const linkedSrc = pick(await find(mode, accounts.checking, source));
        const linkedLender = pick(await find(mode, accounts.mortgage, lenderRow));
        // Undo: detach the counterpart first (no transfer id, its own payee), then the source.
        await mode.update(lenderRow, { transfer_id: null, payee: lenderBefore!.payee, notes: lenderBefore!.notes, category: lenderBefore!.category });
        const midSrc = pick(await find(mode, accounts.checking, source));
        const midLender = pick(await find(mode, accounts.mortgage, lenderRow));
        await mode.update(source, { amount: srcBefore!.amount, payee: srcBefore!.payee, category: srcBefore!.category, notes: srcBefore!.notes, transfer_id: null });
        const srcAfter = pick(await find(mode, accounts.checking, source));
        const lenderAfter = pick(await find(mode, accounts.mortgage, lenderRow));
        out[shape] = {
          linked: { source: { transfer_id: linkedSrc?.transfer_id === lenderRow, payeeIsTransfer: linkedSrc?.payee === (await mode.transferPayee(accounts.mortgage)) }, lender: { transfer_id: linkedLender?.transfer_id === source, payee: linkedLender?.payee === lenderBefore?.payee ? "unchanged" : "changed", diff: diff(lenderBefore, linkedLender) } },
          afterDetachCounterpart: { sourceDiff: diff(srcBefore, midSrc), lenderDiff: diff(lenderBefore, midLender), lenderExists: midLender !== null },
          restored: { sourceDiff: diff(srcBefore, srcAfter), lenderDiff: diff(lenderBefore, lenderAfter) },
          liabilityRowsUnchanged: JSON.stringify(await ids(mode, accounts.mortgage)) === JSON.stringify(liabilityBefore),
          checkingRowsUnchanged: JSON.stringify(await ids(mode, accounts.checking)) === JSON.stringify(checkingBefore),
        };
        if (shape === "split-child") {
          // Then undo the split itself, back to the original bank row.
          for (const child of (await find(mode, accounts.checking, bank))?.subtransactions ?? []) {
            await mode.transport.deleteTransactionForSync({ transactionId: child.id });
            await settleDirect(mode);
          }
          await mode.update(bank, { payee: bankOriginal!.payee, category: bankOriginal!.category, notes: bankOriginal!.notes });
          (out[shape] as Record<string, unknown>).bankRestoredDiff = diff(bankOriginal, pick(await find(mode, accounts.checking, bank)));
        }
      }
      evidence[mode.name].t276b = out;
      trace(`${mode.name} t276b ${JSON.stringify(out)}`);
    }
  });

  it("T277: an existing repayment becomes the loan transfer by changing its payee, and changing it back undoes it", async () => {
    for (const mode of modes) {
      const { accounts, categories } = mode.budget;
      const lenderId = await lender(mode);
      const date = day();
      const id = await create(mode, { accountId: accounts.checking, date, amount: -8300, payeeId: lenderId, categoryId: categories.loanPayment, notes: "bank note", importedPayee: "HOME LENDER", cleared: true, importedId: `undo:c:${mode.name}:${run}` });
      const before = pick(await find(mode, accounts.checking, id));
      const liabilityBefore = await ids(mode, accounts.mortgage);
      await mode.update(id, { payee: await mode.transferPayee(accounts.mortgage) });
      const converted = pick(await find(mode, accounts.checking, id));
      const created = (await mode.rows(accounts.mortgage)).filter((r) => !liabilityBefore.includes(r.id));
      // Undo: the original payee back.
      await mode.update(id, { payee: before!.payee, category: before!.category, notes: before!.notes });
      const after = pick(await find(mode, accounts.checking, id));
      evidence[mode.name].t277 = {
        converted: { diff: diff(before, converted), counterparts: created.length, counterpart: pick(created[0]) && { amount: created[0].amount, payeeIsTransfer: created[0].payee === (await mode.transferPayee(accounts.checking)), notes: created[0].notes ?? null, cleared: created[0].cleared ?? null, category: created[0].category ?? null, transferMatches: created[0].transfer_id === id, importedId: created[0].imported_id ?? null } },
        restoredDiff: diff(before, after),
        liabilityRowsUnchanged: JSON.stringify(await ids(mode, accounts.mortgage)) === JSON.stringify(liabilityBefore),
      };
      trace(`${mode.name} t277 ${JSON.stringify(evidence[mode.name].t277)}`);
    }
  });

  it("T279: restructuring a payment that is already a full transfer (Actual-made and lender-linked counterpart)", async () => {
    for (const mode of modes) {
      const { accounts, categories } = mode.budget;
      const lenderId = await lender(mode);
      const out: Record<string, unknown> = {};
      for (const shape of ["actual-counterpart", "lender-counterpart"] as const) {
        const date = day();
        const liabilityStart = await ids(mode, accounts.mortgage);
        const bank = await create(mode, { accountId: accounts.checking, date, amount: -8300, payeeId: lenderId, categoryId: categories.loanPayment, notes: "bank note", importedPayee: "HOME LENDER", cleared: true, importedId: `undo:d:${shape}:bank:${mode.name}:${run}` });
        let counterpartId: string;
        if (shape === "actual-counterpart") {
          await mode.update(bank, { payee: await mode.transferPayee(accounts.mortgage) });
          counterpartId = (await mode.rows(accounts.mortgage)).find((r) => !liabilityStart.includes(r.id))!.id;
        } else {
          counterpartId = await create(mode, { accountId: accounts.mortgage, date, amount: 8300, payeeId: lenderId, notes: "lender import", importedPayee: "LENDER FEED", cleared: true, importedId: `undo:d:${shape}:lender:${mode.name}:${run}` });
          const raw = await find(mode, accounts.checking, bank);
          await mode.update(bank, { amount: raw!.amount, category: raw!.category ?? null, payee: await mode.transferPayee(accounts.mortgage), notes: "lender import", transfer_id: counterpartId });
          await mode.update(counterpartId, { transfer_id: bank });
        }
        const bankBefore = pick(await find(mode, accounts.checking, bank));
        const cpBefore = pick(await find(mode, accounts.mortgage, counterpartId));
        const liabilityBefore = await ids(mode, accounts.mortgage);
        await mode.update(bank, { subtransactions: [
          { amount: -5000, category: categories.loanPayment, payee: await mode.transferPayee(accounts.mortgage), notes: "Principal" },
          { amount: -3300, category: categories.interest, payee: lenderId, notes: "Interest" },
        ] });
        const parent = await find(mode, accounts.checking, bank);
        const liabilityAfter = flatten(await mode.rows(accounts.mortgage));
        out[shape] = {
          before: { bankTransfer: bankBefore?.transfer_id === counterpartId, counterpart: cpBefore && { amount: cpBefore.amount, cleared: cpBefore.cleared, imported_id: cpBefore.imported_id } },
          afterRestructure: {
            isParent: parent?.is_parent ?? null,
            children: (parent?.subtransactions ?? []).map((c) => ({ amount: c.amount, transfer: c.transfer_id !== null && c.transfer_id !== undefined })),
            originalCounterpartStillExists: liabilityAfter.some((r) => r.id === counterpartId),
            originalCounterpartNow: pick(liabilityAfter.find((r) => r.id === counterpartId)),
            newLiabilityRows: liabilityAfter.filter((r) => !liabilityBefore.includes(r.id)).map((r) => ({ amount: r.amount, cleared: r.cleared, imported_id: r.imported_id ?? null })),
          },
        };
        // Undo attempt: delete the split lines, as for an ordinary split, and see what Actual leaves.
        for (const child of parent?.subtransactions ?? []) {
          await mode.transport.deleteTransactionForSync({ transactionId: child.id });
          await settleDirect(mode);
        }
        const bankAfterUndo = pick(await find(mode, accounts.checking, bank));
        const liabilityAfterUndo = flatten(await mode.rows(accounts.mortgage)).filter((r) => !liabilityStart.includes(r.id));
        const recreated = liabilityAfterUndo.find((r) => r.id !== counterpartId && r.transfer_id === bank);
        (out[shape] as Record<string, unknown>).afterUndo = {
          bankDiff: diff(bankBefore, bankAfterUndo),
          originalCounterpartBack: liabilityAfterUndo.some((r) => r.id === counterpartId),
          recreatedCounterpart: recreated ? { diffFromOriginalIgnoringId: diff({ ...cpBefore!, id: null, transfer_id: null }, { ...pick(recreated)!, id: null, transfer_id: null }) } : null,
          liabilityRowsNow: liabilityAfterUndo.length,
        };
      }
      evidence[mode.name].t279 = out;
      trace(`${mode.name} t279 ${JSON.stringify(out)}`);
    }
  });

  it("R-18 for deletes: is a delete visible to the very next read once the call returns?", async () => {
    const out: Record<string, unknown[]> = {};
    for (const mode of modes) {
      const { accounts, categories } = mode.budget;
      const lenderId = await lender(mode);
      const samples: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await create(mode, { accountId: accounts.checking, date: day(), amount: -8300, payeeId: lenderId, categoryId: categories.loanPayment, importedId: `undo:r18:${mode.name}:${run}:${i}`, cleared: true });
        await mode.update(id, { subtransactions: [
          { amount: -5000, category: categories.loanPayment, payee: await mode.transferPayee(accounts.mortgage), notes: "Principal" },
          { amount: -3300, category: categories.interest, payee: lenderId, notes: "Interest" },
        ] });
        const children = ((await find(mode, accounts.checking, id))?.subtransactions ?? []).map((c) => c.id);
        await mode.transport.deleteTransactionForSync({ transactionId: children[0] });
        const afterFirst = await find(mode, accounts.checking, id);
        await settleDirect(mode);
        await mode.transport.deleteTransactionForSync({ transactionId: children[1] });
        const afterLast = await find(mode, accounts.checking, id);
        await settleDirect(mode);
        const settled = await find(mode, accounts.checking, id);
        samples.push({
          immediatelyAfterFirst: { children: (afterFirst?.subtransactions ?? []).length },
          immediatelyAfterLast: { isParent: afterLast?.is_parent ?? null, children: (afterLast?.subtransactions ?? []).length },
          settled: { isParent: settled?.is_parent ?? null },
        });
      }
      out[mode.name] = samples;
      trace(`${mode.name} r18-delete ${JSON.stringify(samples)}`);
    }
    evidence.direct.r18Delete = out.direct;
    evidence.http.r18Delete = out.http;
  });
});
