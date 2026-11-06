import { buildBalanceSheet } from "./balanceSheet";
import { buildLedger, positionsAt, type AccountFact, type FinancialFacts } from "./measures";

it("groups included balances with fixed deposits as non-current assets and agrees with net worth, preserving unusual signs", () => {
  const accounts: AccountFact[] = [
    { id: "cash", name: "Cash", accountClass: "cash", treatment: null, offBudget: false },
    { id: "deposit", name: "Restricted", accountClass: "bank", treatment: "fixed-deposit", offBudget: true },
    { id: "invest", name: "Investment", groupId: "g1", groupName: "Savings", accountClass: "investment", treatment: "current-investment", offBudget: true },
    { id: "asset", name: "Property", accountClass: "property", treatment: null, offBudget: true },
    { id: "card", name: "Card", accountClass: "credit-card", treatment: null, offBudget: false },
    { id: "loan", name: "Loan", accountClass: "loan", treatment: null, offBudget: true, closed: true },
    { id: "other", name: "Other debt", accountClass: "other-liability", treatment: "current-liability", offBudget: true },
  ];
  const amounts = [10000, 5000, 3000, 20000, -2000, -7000, 500];
  const facts: FinancialFacts = { accounts, excluded: new Set(["excluded"]), incomeCategories: new Set(), movement: [], startingBalances: accounts.map((a, i) => ({ accountId: a.id, month: "2026-01", amountMinor: amounts[i] })), uncategorizedIn: [], transfersIn: [], loanCosts: [], reclassified: [] };
  const ledger = buildLedger(facts);
  const sheet = buildBalanceSheet(ledger, "2026-01");
  expect(sheet.assets.map((g) => [g.label, g.amountMinor])).toEqual([["Current assets", 13000], ["Non-current assets", 25000]]);
  expect(sheet.liabilities.map((g) => [g.label, g.amountMinor])).toEqual([["Current liabilities", 1500], ["Non-current liabilities", 7000]]);
  expect(sheet.assets[0].rows.map((row) => [row.name, row.groupName])).toEqual([["Cash", "No Group"], ["Investment", "Savings"]]);
  expect(sheet.liabilities[1].rows[0].closed).toBe(true);
  expect(sheet.netWorthMinor).toBe(29500);
  expect(sheet.netWorthMinor).toBe(Object.values(positionsAt(ledger, "2026-01")).reduce((sum, value) => sum + value, 0));
  expect(buildBalanceSheet(ledger, "2025-12").netWorthMinor).toBe(0);
});
