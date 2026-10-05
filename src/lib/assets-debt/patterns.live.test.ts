import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@/lib/app-db/canonicalJson";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { insertDebtMatchRule } from "@/lib/app-db/debtMatchRuleRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { __configureNodeHostForTests, __resetNodeHostForTests, closeNodeRuntime } from "@/lib/actual/runtime/nodeHost";
import { openServerTransport } from "@/lib/actual/serverTransport";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { actualRowsToPreviewRows, renderPreviewRows, type PreviewDirectory } from "@/features/assets-debt/components/preview/renderPreviewRows";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import { readAccountDirectory, readMatchingHistory } from "./actual/ledgerPort";
import { executeApprovedPosting } from "./services/applyService";
import { archiveDebtConfiguration, createDebtConfiguration } from "./services/debtConfigService";
import { approveAndBeginApply, proposeReversal, recordApplyOutcome, rowsToCheck } from "./services/postingWorkflowService";
import { previewDebtPostings, type PostingView } from "./services/proposalService";
import { indexReadRows, type RowSnapshot } from "./services/snapshot";
import { debtConfig, saveInput } from "./testing/debtFixtures";

/**
 * RD-084 P1.6 live integration tests (T139; SC-012, SC-019).
 *
 * **Writes to the budgets it is given.** Opt-in, disposable budgets only, the
 * same contract as the P1.0 spike (`src/lib/actual/rd084Spike.live.test.ts`):
 *
 *   RD084_SPIKE_DISPOSABLE=yes
 *   RD084_SPIKE_SERVER_URL, RD084_SPIKE_SERVER_PASSWORD   (Direct)
 *   RD084_SPIKE_HTTP_URL, RD084_SPIKE_HTTP_KEY             (HTTP)
 *   RD084_SPIKE_BUDGETS  JSON: { "RD084 Spike Direct": Budget, "RD084 Spike HTTP": Budget }
 *     Budget = { budgetSyncId, accounts: { checking, savings, mortgage, onLoan }, categories: { loanPayment, interest, fees } }
 *
 * Two paths, each in both modes, through the full chain the browser uses
 * (preview → server approval and preflight → executor → outcome):
 *
 * 1. Pattern A with a lender feed: restructure the bank payment, then link the
 *    principal child and the lender's row (no counterpart created);
 * 2. Pattern B without a lender feed: create the interest charge.
 *
 * Each asserts live preview parity: the previewed rows equal the rows Actual
 * holds after apply. Results must be identical in Direct and HTTP.
 */

const env = process.env;
const live =
  env.RD084_SPIKE_DISPOSABLE === "yes" && env.RD084_SPIKE_SERVER_URL && env.RD084_SPIKE_SERVER_PASSWORD && env.RD084_SPIKE_HTTP_URL && env.RD084_SPIKE_HTTP_KEY && env.RD084_SPIKE_BUDGETS
    ? describe
    : describe.skip;

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

type Budget = { budgetSyncId: string; accounts: { checking: string; mortgage: string }; categories: { loanPayment: string; interest: string } };
type Mode = { name: "direct" | "http"; budget: Budget; transport: ActualBenchTransport };

const run = Date.now().toString(36);
/** RD084_SPIKE_TRACE=yes: progress on stderr (console is mocked), to see where a slow live run is. */
const trace = (message: string) => {
  if (env.RD084_SPIKE_TRACE === "yes") process.stderr.write(`[p16-live] ${message}\n`);
};
const linkAction = canonicalJson({ format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] });
const conditions = (items: unknown[]) => canonicalJson({ format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [...items, { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }] });

live("RD-084 P1.6 manual apply on disposable budgets", () => {
  jest.setTimeout(900_000);
  let root: string;
  let db: SqliteDatabase;
  let modes: Mode[];
  const observed: Record<string, Record<string, unknown>> = { direct: {}, http: {} };
  const saved = { key: env.ACTUAL_BENCH_VAULT_KEY, db: env.ACTUAL_BENCH_DB_PATH };

  beforeAll(() => {
    const all = JSON.parse(readFileSync(env.RD084_SPIKE_BUDGETS!, "utf8")) as Record<string, Budget>;
    for (const name of Object.keys(all)) if (!name.startsWith("RD084 Spike")) throw new Error(`Refusing non-disposable budget "${name}"`);
    root = mkdtempSync(join(tmpdir(), "rd084-p16-live-"));
    env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
    env.ACTUAL_BENCH_VAULT_KEY = "rd084-p16-live-key";
    __configureNodeHostForTests({ allowMainThread: true, snapshots: { lastSnapshotAt: () => new Date().toISOString(), recordSnapshot: () => {} } });
    db = getAppDb(env.ACTUAL_BENCH_DB_PATH);
    const direct: BrowserApiConnection = { id: "p16-direct", label: "Direct", mode: "browser-api", baseUrl: env.RD084_SPIKE_SERVER_URL!, serverPassword: env.RD084_SPIKE_SERVER_PASSWORD!, budgetSyncId: all["RD084 Spike Direct"].budgetSyncId };
    const http: HttpApiConnection = { id: "p16-http", label: "HTTP", mode: "http-api", baseUrl: env.RD084_SPIKE_HTTP_URL!, apiKey: env.RD084_SPIKE_HTTP_KEY!, budgetSyncId: all["RD084 Spike HTTP"].budgetSyncId };
    modes = [
      { name: "direct", budget: all["RD084 Spike Direct"], transport: openServerTransport(direct) },
      { name: "http", budget: all["RD084 Spike HTTP"], transport: openServerTransport(http) },
    ];
  });

  afterAll(async () => {
    // RD084_SPIKE_EVIDENCE: the rows each mode showed and read back (parity evidence, no ids or secrets).
    if (env.RD084_SPIKE_EVIDENCE) writeFileSync(env.RD084_SPIKE_EVIDENCE, JSON.stringify({ observedAt: new Date().toISOString(), observed }, null, 2));
    await closeNodeRuntime();
    __resetNodeHostForTests();
    resetAppDbForTests();
    if (root) rmSync(root, { recursive: true, force: true });
    delete env.ACTUAL_BENCH_RUNTIME_DIR;
    for (const [name, value] of Object.entries({ ACTUAL_BENCH_VAULT_KEY: saved.key, ACTUAL_BENCH_DB_PATH: saved.db })) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  });

  /** One live debt per liability account: the previous scenario's debt is archived first. */
  const created: Record<string, string[]> = { direct: [], http: [] };

  /**
   * Each scenario starts from an empty preview window in the disposable budget, so rows left by an
   * earlier run can never be a second candidate. Only ever runs on an "RD084 Spike" budget.
   */
  async function clearWindow(mode: Mode) {
    const accounts = [mode.budget.accounts.checking, mode.budget.accounts.mortgage];
    const read = async () => JSON.stringify(await Promise.all(accounts.map((accountId) => mode.transport.listTransactionsForSync({ accountId, startDate: "2024-01-15", endDate: "2024-03-15" }))));
    // A Direct delete resolves before it lands, and a write started inside that window deadlocks the
    // runtime (P1.0 R-18): wait until two reads agree after each delete.
    const settle = async () => {
      if (mode.name !== "direct") return;
      let last = await read();
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const next = await read();
        if (next === last) return;
        last = next;
      }
    };
    // Never write while the budget just opened is still settling (R-18).
    await settle();
    for (const accountId of accounts) {
      for (;;) {
        const rows = await mode.transport.listTransactionsForSync({ accountId, startDate: "2024-01-15", endDate: "2024-03-15" });
        if (rows.length === 0) break;
        trace(`${mode.name}: clearing ${rows[0].id} (${rows.length} left in ${accountId === accounts[0] ? "checking" : "mortgage"})`);
        await mode.transport.deleteTransactionForSync({ transactionId: rows[0].id });
        trace(`${mode.name}: deleted ${rows[0].id}`);
        await settle();
      }
    }
  }

  async function setup(mode: Mode, pattern: "embedded-interest" | "separate-interest", options: { lenderFeed?: boolean; anyPayee?: boolean } = {}) {
    const { transport, budget } = mode;
    for (const id of created[mode.name].splice(0)) archiveDebtConfiguration(db, id);
    await clearWindow(mode);
    const directory = await readAccountDirectory(transport, budget.budgetSyncId);
    const lenderName = `RD084 Live Lender ${mode.name} ${pattern} ${run}`;
    await transport.createOrResolvePayee({ name: lenderName });
    const payees = await transport.getPayees();
    const lender = payees.find((p) => p.name === lenderName)!.id;
    const transferPayees = Object.fromEntries(payees.filter((p) => p.transferAccountId).map((p) => [p.transferAccountId!, p.id]));
    const base = debtConfig();
    const config = {
      ...base,
      profile: { ...(base.profile as Record<string, unknown>), accrual: "daily-simple", ...(pattern === "separate-interest" ? { chargeFrequency: "monthly", chargeDay: 28 } : { chargeFrequency: "at-repayment", chargeDay: null }) },
      components: [
        { economicKind: "principal", label: "Principal", destination: "transfer", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 0 },
        { economicKind: "interest", label: "Interest", destination: "category", categoryId: budget.categories.interest, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 1 },
      ],
    };
    const detail = createDebtConfiguration(db, saveInput({
      budgetSyncId: budget.budgetSyncId, name: `Live ${mode.name} ${pattern} ${run}`, lenderPattern: pattern, executionStrategy: "bench-daily",
      liabilityAccountId: budget.accounts.mortgage, paymentAccountId: budget.accounts.checking, loanPaymentCategoryId: budget.categories.loanPayment, config,
    }), directory);
    const debtId = detail.debt.id;
    created[mode.name].push(debtId);
    insertDebtMatchRule(db, debtId, { purpose: "repayment", ruleFormatVersion: 1, enabled: true, actionsJson: linkAction,
      conditionsJson: conditions([{ kind: "source-account", accountId: budget.accounts.checking }, ...(options.anyPayee ? [] : [{ kind: "payee", operator: "exact", payeeId: lender }]), { kind: "expected-date", daysBefore: 3, daysAfter: 3 }]) });
    if (pattern === "embedded-interest" && options.lenderFeed !== false) {
      insertDebtMatchRule(db, debtId, { purpose: "lender-repayment-row", ruleFormatVersion: 1, enabled: true, actionsJson: linkAction,
        conditionsJson: conditions([{ kind: "source-account", accountId: budget.accounts.mortgage }, { kind: "payee", operator: "exact", payeeId: lender }, { kind: "expected-date", daysBefore: 5, daysAfter: 5 }]) });
    }
    const previewDirectory: PreviewDirectory = { accounts: directory.accounts, categories: directory.categories, payeeNames: { [lender]: lenderName }, transferAccountByPayee: Object.fromEntries(Object.entries(transferPayees).map(([a, p]) => [p, a])) };
    const offBudget = new Set(directory.accounts.filter((a) => a.offBudget).map((a) => a.id));

    async function preview() {
      const snapshots = await readMatchingHistory(transport, { accountIds: [budget.accounts.checking, budget.accounts.mortgage], from: "2023-12-01", to: "2024-03-31" });
      const canVerifyTransferLinks = await transport.canVerifyTransferLinks!({ accountId: budget.accounts.mortgage, sinceDate: "2023-12-01" });
      const result = previewDebtPostings(db, debtId, { from: "2024-02-01", to: "2024-02-29", today: "2024-03-15", snapshots, accountDirectory: directory, transferPayees, capabilities: { canRestructure: true, canVerifyTransferLinks } });
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result.postings;
    }
    async function apply(posting: PostingView) {
      const targets: RowSnapshot[] = rowsToCheck(posting.output);
      const fresh: RowSnapshot[] = [];
      for (const t of targets) {
        const row = indexReadRows(await transport.listTransactionsForSync({ accountId: t.accountId, startDate: t.date })).get(t.id);
        if (row) fresh.push(row);
      }
      const ticket = approveAndBeginApply(db, posting.id, { fresh, decidedAt: new Date().toISOString() });
      const outcome = await executeApprovedPosting(ticket, { transport, transferPayeeByAccount: transferPayees, offBudgetAccountIds: offBudget, liabilityAccountId: budget.accounts.mortgage });
      return recordApplyOutcome(db, posting.id, outcome);
    }
    async function parity(posting: PostingView, applied: PostingView) {
      const shown = renderPreviewRows(posting.output, previewDirectory, 2);
      const read = [
        ...(await transport.listTransactionsForSync({ accountId: budget.accounts.checking, startDate: "2024-01-01" })),
        ...(await transport.listTransactionsForSync({ accountId: budget.accounts.mortgage, startDate: "2024-01-01" })),
      ];
      const ids = applied.actualIds ?? [];
      const output = posting.output;
      const back = actualRowsToPreviewRows(shown, read, previewDirectory, 2, (row, index) => {
        if (output.kind === "create") return read.find((r) => r.importedId === output.operations[index].importedId)?.id ?? null;
        if (output.kind === "link") return index === 0 ? output.sourceBefore.id : output.counterpartBefore.id;
        if (output.kind === "restructure") return ids[index] ?? null;
        // Undo and conversion rows are existing rows by id; Actual's new loan-side row is the second id.
        if (row.key.endsWith("counterpart")) return ids[1] ?? null;
        return row.key;
      });
      expect(back).toEqual(shown);
      return shown;
    }
    /** The user's Undo: a reversal proposal, applied through the same path as any posting. */
    function undo(posting: PostingView) {
      return proposeReversal(db, posting.id, { accountDirectory: directory, transferPayees, today: "2024-03-15" });
    }
    /** Every field an exact restoration compares, read back through Bench's transport. */
    async function snap(accountId: string, id: string): Promise<RowSnapshot | null> {
      return indexReadRows(await transport.listTransactionsForSync({ accountId, startDate: "2024-01-01" })).get(id) ?? null;
    }
    async function ids(accountId: string): Promise<string[]> {
      return [...indexReadRows(await transport.listTransactionsForSync({ accountId, startDate: "2024-01-15", endDate: "2024-03-15" })).keys()].sort();
    }
    return { lender, preview, apply, parity, undo, snap, ids, transferPayees };
  }

  it("Pattern A with a lender feed: restructure then link; one liability-side row; live preview parity", async () => {
    for (const mode of modes) {
      const s = await setup(mode, "embedded-interest");
      await mode.transport.createTransactionsForSync([{ accountId: mode.budget.accounts.checking, date: "2024-02-01", amount: -242915, payeeId: s.lender, importedId: `p16:bank:${mode.name}:${run}`, cleared: true }]);
      const [split] = (await s.preview()).filter((p) => p.postingKind === "repayment-split");
      if (split.output.kind !== "restructure") throw new Error("restructure");
      const principal = -split.output.expectedPostState.children[0].amountMinor;
      await mode.transport.createTransactionsForSync([{ accountId: mode.budget.accounts.mortgage, date: "2024-02-01", amount: principal, payeeId: s.lender, importedId: `p16:lender:${mode.name}:${run}`, notes: "lender import", cleared: true }]);
      const appliedSplit = await s.apply(split);
      expect(appliedSplit.status).toBe("applied");
      const splitRows = await s.parity(split, appliedSplit);
      const [link] = (await s.preview()).filter((p) => p.postingKind === "repayment-link");
      expect(link.classification).toBe("review");
      const appliedLink = await s.apply(link);
      expect(appliedLink.status).toBe("applied");
      const linkRows = await s.parity(link, appliedLink);
      observed[mode.name].patternA = { split: splitRows.map((r) => [r.payeeName, r.categoryName, r.amountMinor]), link: linkRows.map((r) => [r.payeeName, r.categoryName, r.amountMinor, r.linkedChip]) };
    }
    expect(JSON.stringify(observed.http.patternA).replace(/Live Lender \w+/g, "")).toEqual(JSON.stringify(observed.direct.patternA).replace(/Live Lender \w+/g, ""));
  });

  it("Pattern B without a lender feed: create the interest charge; live preview parity", async () => {
    for (const mode of modes) {
      const s = await setup(mode, "separate-interest");
      const [charge] = (await s.preview()).filter((p) => p.postingKind === "interest-charge");
      const applied = await s.apply(charge);
      expect(applied.status).toBe("applied");
      observed[mode.name].patternB = (await s.parity(charge, applied)).map((r) => [r.categoryName, r.amountMinor]);
    }
    expect(observed.http.patternB).toEqual(observed.direct.patternB);
  });

  const without = (row: RowSnapshot | null, ...keys: (keyof RowSnapshot)[]) => (row ? Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k as keyof RowSnapshot))) : null);

  it("T276: Undo of a split (no lender feed) restores the payment exactly and removes the loan-side row; live parity", async () => {
    for (const mode of modes) {
      const s = await setup(mode, "embedded-interest", { lenderFeed: false });
      const created = await mode.transport.createTransactionsForSync([{ accountId: mode.budget.accounts.checking, date: "2024-02-01", amount: -242915, payeeId: s.lender, categoryId: mode.budget.categories.loanPayment, notes: "bank note", importedId: `p16:t276a:${mode.name}:${run}`, importedPayee: "HOME LENDER", cleared: true }]);
      const id = created.created[0].transactionId!;
      const before = await s.snap(mode.budget.accounts.checking, id);
      const liabilityBefore = await s.ids(mode.budget.accounts.mortgage);
      const [split] = (await s.preview()).filter((p) => p.postingKind === "repayment-split");
      const applied = await s.apply(split);
      expect(applied.status).toBe("applied");
      const reversal = s.undo(applied);
      expect(reversal).toMatchObject({ classification: "review", output: expect.objectContaining({ kind: "restore-split" }) });
      const undone = await s.apply(reversal);
      expect(undone.status).toBe("applied");
      expect(await s.snap(mode.budget.accounts.checking, id)).toEqual(before);
      expect(await s.ids(mode.budget.accounts.mortgage)).toEqual(liabilityBefore);
      observed[mode.name].t276a = (await s.parity(reversal, undone)).map((r) => [r.categoryName, r.amountMinor, r.cleared]);
    }
    expect(observed.http.t276a).toEqual(observed.direct.t276a);
  });

  it("T276: with a lender feed, Undo of the link then of the split restores both rows exactly; live parity", async () => {
    for (const mode of modes) {
      const s = await setup(mode, "embedded-interest");
      const bank = (await mode.transport.createTransactionsForSync([{ accountId: mode.budget.accounts.checking, date: "2024-02-01", amount: -242915, payeeId: s.lender, categoryId: mode.budget.categories.loanPayment, importedId: `p16:t276b:bank:${mode.name}:${run}`, cleared: true }])).created[0].transactionId!;
      const [split] = (await s.preview()).filter((p) => p.postingKind === "repayment-split");
      if (split.output.kind !== "restructure") throw new Error("restructure");
      const principal = -split.output.expectedPostState.children[0].amountMinor;
      const lenderRow = (await mode.transport.createTransactionsForSync([{ accountId: mode.budget.accounts.mortgage, date: "2024-02-01", amount: principal, payeeId: s.lender, importedId: `p16:t276b:lender:${mode.name}:${run}`, notes: "lender import", importedPayee: "LENDER FEED", cleared: true }])).created[0].transactionId!;
      trace(`${mode.name} t276b: const bankBefore = await s.snap(mode.budget.accounts.checkin`);
      const bankBefore = await s.snap(mode.budget.accounts.checking, bank);
      trace(`${mode.name} t276b: const lenderBefore = await s.snap(mode.budget.accounts.mortg`);
      const lenderBefore = await s.snap(mode.budget.accounts.mortgage, lenderRow);
      trace(`${mode.name} t276b: const appliedSplit = await s.apply(split);`);
      const appliedSplit = await s.apply(split);
      const [link] = (await s.preview()).filter((p) => p.postingKind === "repayment-link");
      trace(`${mode.name} t276b: const appliedLink = await s.apply(link);`);
      const appliedLink = await s.apply(link);
      expect(appliedLink.status).toBe("applied");
      expect(s.undo(appliedSplit)).toMatchObject({ classification: "blocked" });
      trace(`${mode.name} t276b: const unlink = s.undo(appliedLink);`);
      const unlink = s.undo(appliedLink);
      trace(`${mode.name} t276b: const unlinked = await s.apply(unlink);`);
      const unlinked = await s.apply(unlink);
      expect(unlinked.status).toBe("applied");
      expect(await s.snap(mode.budget.accounts.mortgage, lenderRow)).toEqual(lenderBefore);
      trace(`${mode.name} t276b: const unlinkRows = await s.parity(unlink, unlinked);`);
      const unlinkRows = await s.parity(unlink, unlinked);
      trace(`${mode.name} t276b: const restore = s.undo(appliedSplit);`);
      const restore = s.undo(appliedSplit);
      trace(`${mode.name} t276b: const restored = await s.apply(restore);`);
      const restored = await s.apply(restore);
      expect(restored.status).toBe("applied");
      expect(await s.snap(mode.budget.accounts.checking, bank)).toEqual(bankBefore);
      expect(await s.snap(mode.budget.accounts.mortgage, lenderRow)).toEqual(lenderBefore);
      observed[mode.name].t276b = { unlink: unlinkRows.map((r) => [r.categoryName, r.amountMinor]), restore: (await s.parity(restore, restored)).map((r) => [r.categoryName, r.amountMinor]) };
    }
    expect(observed.http.t276b).toEqual(observed.direct.t276b);
  });

  it("T277: without a lender feed an existing repayment becomes the loan transfer, and Undo reverts it exactly; live parity", async () => {
    for (const mode of modes) {
      const s = await setup(mode, "separate-interest");
      const id = (await mode.transport.createTransactionsForSync([{ accountId: mode.budget.accounts.checking, date: "2024-02-01", amount: -242915, payeeId: s.lender, categoryId: mode.budget.categories.loanPayment, notes: "bank note", importedId: `p16:t277:${mode.name}:${run}`, importedPayee: "HOME LENDER", cleared: true }])).created[0].transactionId!;
      const before = await s.snap(mode.budget.accounts.checking, id);
      const liabilityBefore = await s.ids(mode.budget.accounts.mortgage);
      const [convert] = (await s.preview()).filter((p) => p.postingKind === "repayment-link" && p.output.kind === "convert");
      expect(convert.classification).toBe("review");
      const applied = await s.apply(convert);
      expect(applied.status).toBe("applied");
      const shown = await s.parity(convert, applied);
      const revert = s.undo(applied);
      const reverted = await s.apply(revert);
      expect(reverted.status).toBe("applied");
      expect(await s.snap(mode.budget.accounts.checking, id)).toEqual(before);
      expect(await s.ids(mode.budget.accounts.mortgage)).toEqual(liabilityBefore);
      observed[mode.name].t277 = { convert: shown.map((r) => [r.payeeName.replace(/Live Lender \w+/, ""), r.categoryName, r.amountMinor, r.cleared]), revert: (await s.parity(revert, reverted)).map((r) => [r.categoryName, r.amountMinor]) };
    }
    expect(JSON.stringify(observed.http.t277).replace(/RD084 Live Lender [^"]+/g, "")).toEqual(JSON.stringify(observed.direct.t277).replace(/RD084 Live Lender [^"]+/g, ""));
  });

  it("T279: a payment already a transfer to an untouched Actual-made row is split; Undo re-creates that row with a new id; live parity", async () => {
    for (const mode of modes) {
      const s = await setup(mode, "embedded-interest", { lenderFeed: false, anyPayee: true });
      const id = (await mode.transport.createTransactionsForSync([{ accountId: mode.budget.accounts.checking, date: "2024-02-01", amount: -242915, payeeId: s.transferPayees[mode.budget.accounts.mortgage], categoryId: mode.budget.categories.loanPayment, notes: "bank note", importedId: `p16:t279:${mode.name}:${run}`, cleared: true }])).created[0].transactionId!;
      trace(`${mode.name} t279: const paymentBefore = await s.snap(mode.budget.accounts.chec`);
      const paymentBefore = await s.snap(mode.budget.accounts.checking, id);
      const originalId = paymentBefore!.transferId!;
      trace(`${mode.name} t279: const originalBefore = await s.snap(mode.budget.accounts.mor`);
      const originalBefore = await s.snap(mode.budget.accounts.mortgage, originalId);
      expect(originalBefore).toMatchObject({ cleared: false, importedId: null, categoryId: null });
      const [split] = (await s.preview()).filter((p) => p.postingKind === "repayment-split");
      expect(split.reasons.map((r) => r.code)).toContain("replaces-transfer-counterpart");
      trace(`${mode.name} t279: const applied = await s.apply(split);`);
      const applied = await s.apply(split);
      expect(applied.status).toBe("applied");
      expect(await s.snap(mode.budget.accounts.mortgage, originalId)).toBeNull();
      trace(`${mode.name} t279: const splitRows = await s.parity(split, applied);`);
      const splitRows = await s.parity(split, applied);
      trace(`${mode.name} t279: const reversal = s.undo(applied);`);
      const reversal = s.undo(applied);
      trace(`${mode.name} t279: const undone = await s.apply(reversal);`);
      const undone = await s.apply(reversal);
      if (undone.status !== "applied") trace(`${mode.name} t279 undo outcome: ${JSON.stringify(undone.error)}`);
      expect(undone.status).toBe("applied");
      const recreatedId = undone.actualIds![1];
      expect(recreatedId).not.toBe(originalId);
      trace(`${mode.name} t279: const paymentAfter = await s.snap(mode.budget.accounts.check`);
      const paymentAfter = await s.snap(mode.budget.accounts.checking, id);
      expect(paymentAfter!.transferId).toBe(recreatedId);
      expect(without(paymentAfter, "transferId")).toEqual(without(paymentBefore, "transferId"));
      expect(without(await s.snap(mode.budget.accounts.mortgage, recreatedId), "id")).toEqual(without(originalBefore, "id"));
      observed[mode.name].t279 = { split: splitRows.map((r) => [r.categoryName, r.amountMinor]), undo: (await s.parity(reversal, undone)).map((r) => [r.categoryName, r.amountMinor, r.cleared]) };
    }
    expect(observed.http.t279).toEqual(observed.direct.t279);
  });
});
