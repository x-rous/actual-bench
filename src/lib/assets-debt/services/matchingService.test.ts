import { resetAppDbForTests } from "@/lib/app-db/connection";
import { insertDebtMatchRule, saveDebtMatchRuleBacktest } from "@/lib/app-db/debtMatchRuleRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { MatchingReadTransport } from "../actual/ledgerPort";
import { BUDGET, directory, saveInput, tempDebtDb } from "../testing/debtFixtures";
import { createDebtConfiguration } from "./debtConfigService";
import { runDebtBacktestWithTransport } from "./backtestService";
import { createMatchingRule, editMatchingRule, listMatchingRules } from "./matchingService";

let db: SqliteDatabase;
beforeEach(() => { db = tempDebtDb(); });
afterEach(() => resetAppDbForTests());

const actions = { format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] };
const safeConditions = {
  format: "rd084.debt-match-conditions",
  version: 1,
  operator: "all",
  items: [
    { kind: "source-account", accountId: "acc-checking" },
    { kind: "expected-date", daysBefore: 0, daysAfter: 0 },
    { kind: "bench-marker", value: "exclude" },
    { kind: "posting-link", value: "exclude" },
  ],
};

const transaction = (patch: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction => ({
  id: "tx-1",
  accountId: "acc-checking",
  date: "2024-02-01",
  amount: -500_000,
  payeeId: "bank",
  payeeName: "Bank",
  categoryId: "cat-loan",
  categoryName: "Loan payments",
  notes: null,
  cleared: true,
  reconciled: false,
  importedId: null,
  transferId: null,
  scheduleId: null,
  isParent: false,
  isChild: false,
  parentId: null,
  splitLines: [],
  ...patch,
});

function debtId() {
  return createDebtConfiguration(db, saveInput({ budgetSyncId: BUDGET }), directory()).debt.id;
}

describe("P1.4 matching service", () => {
  it("backtests through the read-only transport slice without invoking any writer", async () => {
    const id = debtId();
    const listTransactionsForSync = jest.fn(async () => [transaction()]);
    const transport = new Proxy({ listTransactionsForSync }, {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        throw new Error(`Unexpected transport access: ${String(property)}`);
      },
    }) as MatchingReadTransport;
    const result = await runDebtBacktestWithTransport(
      db,
      id,
      { ruleFormatVersion: 1, conditionsJson: JSON.stringify(safeConditions), actionsJson: JSON.stringify(actions) },
      { from: "2024-02-01", to: "2024-02-01", accountIds: ["acc-checking", "acc-checking"] },
      transport,
      "2026-10-03T00:00:00.000Z",
    );

    expect(listTransactionsForSync).toHaveBeenCalledTimes(1);
    expect(listTransactionsForSync).toHaveBeenCalledWith({ accountId: "acc-checking", startDate: "2024-02-01", endDate: "2024-02-01" });
    expect(result.summary).toMatchObject({ expectedPeriods: 1, unique: 1, multiple: 0, unsafe: 0 });
    expect(result.periods[0]?.flags).toContain("categorized");
  });

  it("never trusts a cached result when a rule is enabled and rejects a weak PAYMENT-only rule", () => {
    const id = debtId();
    const weak = createMatchingRule(db, id, {
      purpose: "repayment",
      enabled: false,
      conditions: { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "notes", operator: "contains", value: "PAYMENT" }] },
      actions,
    });
    saveDebtMatchRuleBacktest(db, weak.record.id, JSON.stringify({ format: "rd084.debt-backtest", version: 1, summary: { unique: 999 } }));

    expect(() => editMatchingRule(db, id, weak.record.id, {
      purpose: "repayment",
      enabled: true,
      conditions: { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "notes", operator: "contains", value: "PAYMENT" }] },
      actions,
    })).toThrow(/fresh backtest/);

    expect(() => editMatchingRule(db, id, weak.record.id, {
      purpose: "repayment",
      enabled: true,
      conditions: { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "notes", operator: "contains", value: "PAYMENT" }] },
      actions,
    }, { from: "2024-02-01", to: "2024-02-01", snapshots: [{ accountId: "acc-checking", transactions: [transaction({ notes: "PAYMENT" })] }] })).toThrow(/cannot be enabled/);
  });

  it("refuses to enable a strong rule while a fresh backtest is ambiguous", () => {
    const id = debtId();
    expect(() => createMatchingRule(db, id, {
      purpose: "repayment",
      enabled: true,
      conditions: safeConditions,
      actions,
    }, {
      from: "2024-02-01",
      to: "2024-02-01",
      snapshots: [{ accountId: "acc-checking", transactions: [transaction({ id: "a" }), transaction({ id: "b" })] }],
    })).toThrow(/multiple candidates/);
  });

  it("blocks an unknown format version only for that rule", () => {
    const id = debtId();
    createMatchingRule(db, id, { purpose: "repayment", enabled: false, conditions: safeConditions, actions });
    insertDebtMatchRule(db, id, {
      id: "future-rule",
      purpose: "repayment",
      ruleFormatVersion: 2,
      conditionsJson: JSON.stringify(safeConditions),
      actionsJson: JSON.stringify(actions),
    });

    const views = listMatchingRules(db, id);
    expect(views).toHaveLength(2);
    expect(views.find((rule) => rule.record.id === "future-rule")).toMatchObject({ conditions: null, actions: null, blocked: expect.stringMatching(/unsupported/) });
    expect(views.find((rule) => rule.record.id !== "future-rule")?.blocked).toBeNull();
  });
});
