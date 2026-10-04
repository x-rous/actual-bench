import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { createDebtConfiguration } from "./services/debtConfigService";
import { approveAndBeginApply, recordApplyOutcome } from "./services/postingWorkflowService";
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

  async function setup(mode: Mode, pattern: "embedded-interest" | "separate-interest") {
    const { transport, budget } = mode;
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
    insertDebtMatchRule(db, debtId, { purpose: "repayment", ruleFormatVersion: 1, enabled: true, actionsJson: linkAction,
      conditionsJson: conditions([{ kind: "source-account", accountId: budget.accounts.checking }, { kind: "payee", operator: "exact", payeeId: lender }, { kind: "expected-date", daysBefore: 3, daysAfter: 3 }]) });
    if (pattern === "embedded-interest") {
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
      const output = posting.output;
      const targets: RowSnapshot[] = output.kind === "restructure" ? [output.before] : output.kind === "link" ? [output.sourceBefore, output.counterpartBefore] : [];
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
        return row.key;
      });
      expect(back).toEqual(shown);
      return shown;
    }
    return { lender, preview, apply, parity };
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
});
