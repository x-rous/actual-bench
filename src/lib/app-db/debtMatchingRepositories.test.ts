import { resetAppDbForTests } from "./connection";
import {
  deleteDebtMatchRule,
  insertDebtMatchRule,
  listDebtMatchRules,
  saveDebtMatchRuleBacktest,
  updateDebtMatchRule,
} from "./debtMatchRuleRepository";
import { insertDebt } from "./debtRepository";
import {
  deleteDebtTransactionLink,
  insertDebtTransactionLink,
  listDebtTransactionLinks,
} from "./debtTransactionLinkRepository";
import type { DebtFields } from "./debtRepository";
import type { SqliteDatabase } from "./types";
import { tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";

let db: SqliteDatabase;
beforeEach(() => {
  db = tempDebtDb();
});
afterEach(() => resetAppDbForTests());

const fields = (budgetSyncId: string, account: string): DebtFields => ({
  budgetSyncId,
  name: `${budgetSyncId} loan`,
  debtType: "mortgage",
  behaviorClass: "term-loan",
  currency: "AED",
  currencyMinorDigits: 2,
  liabilityAccountId: account,
  paymentAccountId: `${account}-pay`,
  signConvention: "negative-is-debt",
  lenderPattern: "embedded-interest",
  executionStrategy: "bench-daily",
  lenderChargeGraceDays: 0,
  onboardingDate: null,
  loanPaymentCategoryId: null,
  drawCategoryId: null,
  expectedObservationIntervalDays: null,
  currentConfigJson: "{}",
});

const conditions = JSON.stringify({
  format: "rd084.debt-match-conditions",
  version: 1,
  operator: "all",
  items: [{ kind: "source-account", accountId: "cash" }],
});
const actions = JSON.stringify({ format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] });

describe("debt matching repositories (schema v42)", () => {
  it("creates, updates, caches and deletes a matching rule", () => {
    const debt = insertDebt(db, { ...fields("budget-a", "loan-a"), status: "active", currentRevision: 1 });
    const created = insertDebtMatchRule(db, debt.id, {
      id: "rule-1",
      purpose: "repayment",
      ruleFormatVersion: 1,
      conditionsJson: conditions,
      actionsJson: actions,
    }, "2026-10-03T00:00:00.000Z");
    expect(created).toMatchObject({ id: "rule-1", debtId: debt.id, enabled: false, lastBacktestJson: null });

    const cached = saveDebtMatchRuleBacktest(db, created.id, JSON.stringify({ format: "rd084.debt-backtest", version: 1 }));
    expect(cached.lastBacktestJson).toContain("rd084.debt-backtest");
    const updated = updateDebtMatchRule(db, created.id, { ...created, purpose: "interest-charge", enabled: true });
    expect(updated).toMatchObject({ purpose: "interest-charge", enabled: true, lastBacktestJson: null, lastBacktestAt: null });
    expect(listDebtMatchRules(db, debt.id)).toHaveLength(1);
    expect(deleteDebtMatchRule(db, created.id)).toBe(true);
  });

  it("scopes claims by budget and most-specific row while allowing evidence-only reuse", () => {
    const a1 = insertDebt(db, { ...fields("budget-a", "loan-a1"), status: "active", currentRevision: 1 });
    const a2 = insertDebt(db, { ...fields("budget-a", "loan-a2"), status: "active", currentRevision: 1 });
    const b1 = insertDebt(db, { ...fields("budget-b", "loan-b1"), status: "active", currentRevision: 1 });
    const input = {
      actualTransactionId: "same-actual-id",
      role: "repayment" as const,
      periodKey: "2026-10-01",
      linkSource: "match-rule" as const,
    };

    insertDebtTransactionLink(db, { id: "link-a", debtId: a1.id, budgetSyncId: "budget-a", ...input });
    expect(() => insertDebtTransactionLink(db, { debtId: a2.id, budgetSyncId: "budget-a", ...input })).toThrow(`The claim belongs to the loan ${JSON.stringify(a1.name)} (active).`);
    expect(() => insertDebtTransactionLink(db, { debtId: a1.id, budgetSyncId: "budget-b", ...input })).toThrow(/does not exist in that Actual budget/);
    expect(() => insertDebtTransactionLink(db, { debtId: a2.id, budgetSyncId: "budget-a", ...input, actualTransactionId: "parent", isSplitParent: true })).toThrow(/specific child/);

    insertDebtTransactionLink(db, { id: "link-b", debtId: b1.id, budgetSyncId: "budget-b", ...input });
    insertDebtTransactionLink(db, { id: "evidence-1", debtId: a1.id, budgetSyncId: "budget-a", ...input, role: "evidence-only" });
    insertDebtTransactionLink(db, { id: "evidence-2", debtId: a2.id, budgetSyncId: "budget-a", ...input, role: "evidence-only" });
    insertDebtTransactionLink(db, { id: "child-1", debtId: a1.id, budgetSyncId: "budget-a", ...input, actualTransactionId: "child-1", actualParentId: "parent" });
    insertDebtTransactionLink(db, { id: "child-2", debtId: a2.id, budgetSyncId: "budget-a", ...input, actualTransactionId: "child-2", actualParentId: "parent" });

    expect(listDebtTransactionLinks(db, a1.id).map((link) => link.id)).toEqual(expect.arrayContaining(["link-a", "evidence-1", "child-1"]));
    expect(deleteDebtTransactionLink(db, "child-1")).toBe(true);
  });
});
