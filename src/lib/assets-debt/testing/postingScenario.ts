import { canonicalJson } from "@/lib/app-db/canonicalJson";
import { insertDebtMatchRule } from "@/lib/app-db/debtMatchRuleRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { readAccountDirectory, readMatchingHistory, type AccountDirectory } from "../actual/ledgerPort";
import { executeApprovedPosting, type ExecutorOutcome } from "../services/applyService";
import { createDebtConfiguration } from "../services/debtConfigService";
import { rowsToCheck, approveAndBeginApply, proposeReversal, recordApplyOutcome } from "../services/postingWorkflowService";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import { trackedParentIds } from "../services/snapshot";
import { previewDebtPostings, type PostingView, type PreviewRequest } from "../services/proposalService";
import { recoverPosting } from "../services/recovery";
import { indexReadRows, type PostingOutputSnapshot, type RowSnapshot } from "../services/snapshot";
import { debtConfig, saveInput, tempDebtDb } from "./debtFixtures";
import { createFakeActual, type FakeActual } from "./fakeActual";
import { transportFor, type HarnessMode } from "./transportHarness";

/**
 * End-to-end RD-084 P1.6 scenario for tests: a real app DB and the real
 * services, and the fake Actual behind Bench's real Direct or HTTP transport.
 * `apply` follows exactly the browser's path (re-read, server approval and
 * preflight, executor, outcome) minus HTTP. Test-only.
 */

export const ACCOUNTS = {
  checking: "acc-checking",
  mortgage: "acc-mortgage",
  offset: "acc-offset",
};
export const CATEGORIES = { loan: "cat-loan", interest: "cat-interest", fees: "cat-fees", adjust: "cat-adjust" };
export const LENDER = "p-lender";

export type ScenarioOptions = {
  mode: HarnessMode;
  apiRequestMock: jest.Mock;
  pattern: "separate-interest" | "embedded-interest";
  liabilityOffBudget?: boolean;
  /** Enable a lender-row (Pattern A) or lender-charge (Pattern B) matching rule: the "lender feed". */
  lenderFeed?: boolean;
  loanPaymentCategoryId?: string | null;
  interestCategoryId?: string | null;
  /** Config v3 additions (business days, lender statement allocation). */
  configV3?: { businessDays?: unknown; lenderStatement?: unknown };
  /** The repayment rule matches any payee (a payment that is already a transfer has the transfer payee). */
  repaymentAnyPayee?: boolean;
  /** An offset account that funds scheduled repayments, from a balance entered in Bench. */
  offsetFunding?: { date: string; balanceMinor: number };
};

export type Scenario = Awaited<ReturnType<typeof createScenario>>;

function conditions(items: unknown[]) {
  return canonicalJson({ format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [...items, { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }] });
}
const linkAction = canonicalJson({ format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] });

export function createScenario(options: ScenarioOptions) {
  const db: SqliteDatabase = tempDebtDb();
  const offBudget = options.liabilityOffBudget ?? true;
  const fake: FakeActual = createFakeActual({
    accounts: [
      { id: ACCOUNTS.checking, name: "Everyday" },
      { id: ACCOUNTS.mortgage, name: "Home loan", offbudget: offBudget },
      ...(options.offsetFunding ? [{ id: ACCOUNTS.offset, name: "Offset" }] : []),
    ],
    payees: [{ id: LENDER, name: "Home Lender" }],
    categories: [
      { id: CATEGORIES.loan, name: "Loan payments" },
      { id: CATEGORIES.interest, name: "Interest" },
      { id: CATEGORIES.fees, name: "Bank fees" },
      { id: CATEGORIES.adjust, name: "Adjustments" },
    ],
  });
  const transport: ActualBenchTransport = transportFor(options.mode, fake, options.apiRequestMock);

  const directory: AccountDirectory = {
    budgetSyncId: "budget-1",
    accounts: [
      { id: ACCOUNTS.checking, name: "Everyday", offBudget: false, closed: false },
      { id: ACCOUNTS.mortgage, name: "Home loan", offBudget, closed: false },
      ...(options.offsetFunding ? [{ id: ACCOUNTS.offset, name: "Offset", offBudget: false, closed: false }] : []),
    ],
    categories: Object.entries(CATEGORIES).map(([key, id]) => ({ id, name: key, groupName: "Bills", isIncome: false, hidden: false })),
  };

  const profile = options.pattern === "separate-interest"
    ? { accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 28 }
    : { accrual: "daily-simple", chargeFrequency: "at-repayment", chargeDay: null };
  const base = debtConfig();
  const config = {
    ...base,
    ...(options.configV3 ? { version: 3, businessDays: options.configV3.businessDays ?? null, lenderStatement: options.configV3.lenderStatement ?? null } : {}),
    profile: { ...(base.profile as Record<string, unknown>), ...profile },
    components: [
      { economicKind: "principal", label: "Principal", destination: "transfer", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 0 },
      { economicKind: "interest", label: "Interest", destination: "category", categoryId: options.interestCategoryId === undefined ? CATEGORIES.interest : options.interestCategoryId, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 1 },
    ],
  };
  const detail = createDebtConfiguration(db, saveInput({
    lenderPattern: options.pattern,
    executionStrategy: "bench-daily",
    liabilityAccountId: ACCOUNTS.mortgage,
    paymentAccountId: ACCOUNTS.checking,
    loanPaymentCategoryId: options.loanPaymentCategoryId === undefined ? CATEGORIES.loan : options.loanPaymentCategoryId,
    lenderChargeGraceDays: 3,
    config,
    ...(options.offsetFunding ? { offsets: [{ actualAccountId: ACCOUNTS.offset, effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 10_000, balanceBasis: "total" as const, capMinor: null, useActualBalance: false, fundScheduledRepayments: true }], assumptions: [{ kind: "offset-balance" as const, effectiveFrom: options.offsetFunding.date, recurrence: null, amountMinor: options.offsetFunding.balanceMinor, feeTreatment: null, offsetAccountId: ACCOUNTS.offset, note: null }] } : {}),
  }), {
    budgetSyncId: "budget-1",
    accounts: directory.accounts,
    categories: directory.categories,
  }, "2024-01-01T00:00:00.000Z");
  const debtId = detail.debt.id;

  // The repayment rule finds the bank payment; the lender feed finds the lender's own rows.
  insertDebtMatchRule(db, debtId, {
    purpose: "repayment", ruleFormatVersion: 1, enabled: true, actionsJson: linkAction,
    conditionsJson: conditions([
      { kind: "source-account", accountId: ACCOUNTS.checking },
      ...(options.repaymentAnyPayee ? [] : [{ kind: "payee", operator: "exact", payeeId: LENDER }]),
      { kind: "expected-date", daysBefore: 3, daysAfter: 3 },
      { kind: "amount", operator: "approximate", amountMinor: 242915, direction: "outflow", tolerance: { kind: "absolute", amountMinor: 1000 } },
    ]),
  });
  if (options.lenderFeed) {
    insertDebtMatchRule(db, debtId, {
      purpose: options.pattern === "separate-interest" ? "interest-charge" : "lender-repayment-row", ruleFormatVersion: 1, enabled: true, actionsJson: linkAction,
      conditionsJson: conditions([{ kind: "source-account", accountId: ACCOUNTS.mortgage }, { kind: "payee", operator: "exact", payeeId: LENDER }, { kind: "expected-date", daysBefore: 5, daysAfter: 5 }]),
    });
  }

  const transferPayees = { [ACCOUNTS.checking]: fake.transferPayeeId(ACCOUNTS.checking), [ACCOUNTS.mortgage]: fake.transferPayeeId(ACCOUNTS.mortgage) };
  const offBudgetIds = new Set(directory.accounts.filter((a) => a.offBudget).map((a) => a.id));

  async function preview(window: { from: string; to: string; today?: string }, extra: Partial<PreviewRequest> = {}) {
    const snapshots = await readMatchingHistory(transport, { accountIds: [ACCOUNTS.checking, ACCOUNTS.mortgage], from: "2023-12-01", to: "2024-12-31" });
    const read = await readAccountDirectory(transport, "budget-1");
    const canVerifyTransferLinks = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId: ACCOUNTS.mortgage, sinceDate: "2023-12-01" }) : false;
    const result = previewDebtPostings(db, debtId, {
      from: window.from, to: window.to, today: window.today ?? window.to, snapshots,
      accountDirectory: { ...read, accounts: read.accounts.length ? read.accounts : directory.accounts },
      transferPayees, capabilities: { canRestructure: true, canVerifyTransferLinks },
      verifiedMissingIds: extra.readRanges ? [] : listSubjectPostings(db, "debt", debtId).filter((posting) => posting.status === "applied").flatMap((posting) => trackedParentIds(JSON.parse(posting.outputSnapshotJson), posting.actualIds)).filter((id) => !fake.row(id)),
      ...extra,
    }, "2024-06-01T00:00:00.000Z");
    if (!result.ok) throw new Error(`preview failed: ${JSON.stringify(result)}`);
    return result;
  }

  async function fresh(posting: PostingView): Promise<RowSnapshot[]> {
    const targets = rowsToCheck(posting.output);
    const rows: RowSnapshot[] = [];
    for (const target of targets) {
      const found = indexReadRows(await transport.listTransactionsForSync({ accountId: target.accountId, startDate: target.date })).get(target.id);
      if (found) rows.push(found);
    }
    return rows;
  }

  /** The browser's Apply path: re-read, server approval + preflight, executor, outcome. */
  async function apply(posting: PostingView, decidedAt = "2024-06-02T00:00:00.000Z"): Promise<{ posting: PostingView; outcome: ExecutorOutcome }> {
    const ticket = approveAndBeginApply(db, posting.id, { fresh: await fresh(posting), decidedAt });
    let outcome: ExecutorOutcome;
    try {
      outcome = await executeApprovedPosting(ticket, { transport, transferPayeeByAccount: transferPayees, offBudgetAccountIds: offBudgetIds, liabilityAccountId: ACCOUNTS.mortgage, now: () => "2024-06-02T00:00:01.000Z" });
    } catch (error) {
      outcome = { status: "indeterminate", error: { message: String(error) } };
    }
    return { posting: recordApplyOutcome(db, posting.id, outcome, "2024-06-02T00:00:02.000Z"), outcome };
  }

  async function recover(posting: PostingView) {
    const result = await recoverPosting(posting.output, transport, transferPayees);
    if (result.status === "applied") return recordApplyOutcome(db, posting.id, { status: "applied", actualIds: result.actualIds, appliedAt: "2024-06-03T00:00:00.000Z", recovered: true });
    if (result.status === "not-found" || result.status === "review") return recordApplyOutcome(db, posting.id, { status: result.status, reason: result.reason });
    return result;
  }

  function seedPayment(date: string, amount = -242915, extra: Record<string, unknown> = {}) {
    return fake.seed({ account: ACCOUNTS.checking, date, amount, payee: LENDER, imported_id: `bank:${date}`, imported_payee: "HOME LENDER", cleared: true, ...extra });
  }
  function seedLenderRow(date: string, amount: number, extra: Record<string, unknown> = {}) {
    return fake.seed({ account: ACCOUNTS.mortgage, date, amount, payee: LENDER, notes: "lender import", imported_id: `lender:${date}:${amount}`, imported_payee: "LENDER", cleared: true, ...extra });
  }

  /** The user's Undo: a reversal proposal (nothing is written until it is applied). */
  function undo(posting: PostingView): PostingView {
    return proposeReversal(db, posting.id, { accountDirectory: directory, transferPayees, today: "2024-06-03" });
  }

  return { db, fake, transport, directory, debtId, transferPayees, preview, apply, recover, fresh, seedPayment, seedLenderRow, offBudgetIds, undo };
}

export function byKind(postings: PostingView[], kind: string): PostingView[] {
  return postings.filter((p) => p.postingKind === kind);
}

export type { PostingOutputSnapshot };
