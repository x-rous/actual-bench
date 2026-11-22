import { ASSET_CLASSES, CLASS_LABEL, LIABILITY_CLASSES, classBalances } from "./breakdowns";
import { buildBalanceSheet } from "./balanceSheet";
import { buildLedger, positionsAt, type AccountFact, type FinancialFacts } from "./measures";

const accounts: AccountFact[] = [
  { id: "cash", name: "Cash", accountClass: "cash", offBudget: false },
  { id: "saver", name: "Saver", accountClass: "savings", offBudget: true },
  { id: "deposit", name: "Restricted", accountClass: "fixed-deposit", offBudget: true },
  { id: "invest", name: "Investment", groupId: "g1", groupName: "Savings", accountClass: "investment", offBudget: true },
  { id: "retire", name: "Pension", accountClass: "retirement", offBudget: true },
  { id: "asset", name: "Property", accountClass: "property", offBudget: true },
  { id: "car", name: "Car", accountClass: "vehicle", offBudget: true },
  { id: "gold", name: "Gold", accountClass: "fixed-asset", offBudget: true },
  { id: "card", name: "Card", accountClass: "credit-card", offBudget: false },
  { id: "loan", name: "Loan", accountClass: "loan", offBudget: true, closed: true },
  { id: "other", name: "Other debt", accountClass: "other-liability", offBudget: true },
];
const amounts = [10000, 1500, 5000, 3000, 2000, 20000, 4000, 700, -2000, -7000, 500];
const facts: FinancialFacts = { accounts, excluded: new Set(["excluded"]), incomeCategories: new Set(), movement: [], startingBalances: accounts.map((a, i) => ({ accountId: a.id, month: "2026-01", amountMinor: amounts[i] })), uncategorizedIn: [], transfersIn: [], loanCosts: [], reclassified: [] };
const ledger = buildLedger(facts);

describe("the balance sheet", () => {
  it("groups included balances by account class, in the names and order of What you own and owe, and agrees with net worth", () => {
    const sheet = buildBalanceSheet(ledger, "2026-01");
    expect(sheet.assets.map((g) => [g.label, g.amountMinor])).toEqual([
      ["Cash & checking", 10000], ["Savings", 1500], ["Fixed deposits", 5000], ["Investments", 5000], ["Property", 20000], ["Vehicles", 4000], ["Other assets", 700],
    ]);
    expect(sheet.liabilities.map((g) => [g.label, g.amountMinor])).toEqual([["Loans", 7000], ["Credit cards", 2000], ["Other liabilities", -500]]);
    expect(sheet.assets[3].rows.map((row) => [row.name, row.groupName])).toEqual([["Investment", "Savings"], ["Pension", "No Group"]]);
    expect(sheet.liabilities[0].rows[0].closed).toBe(true);
    expect(sheet.netWorthMinor).toBe(sheet.assetsMinor - sheet.liabilitiesMinor);
    expect(sheet.netWorthMinor).toBe(Object.values(positionsAt(ledger, "2026-01")).reduce((sum, value) => sum + value, 0));
    expect(buildBalanceSheet(ledger, "2025-12").netWorthMinor).toBe(0);
  });

  it("matches Summary's What you own and owe for every class, and says nothing about current or non-current", () => {
    const sheet = buildBalanceSheet(ledger, "2026-01");
    const summary = classBalances(positionsAt(ledger, "2026-01"));
    for (const group of [...sheet.assets, ...sheet.liabilities]) {
      const key = [...ASSET_CLASSES, ...LIABILITY_CLASSES].find((k) => CLASS_LABEL[k] === group.label)!;
      // Summary shows assets positive and liabilities negative; the sheet shows what is owed as a positive amount.
      expect(LIABILITY_CLASSES.includes(key) ? -group.amountMinor : group.amountMinor).toBe(summary[key]);
      expect(group.key).toBe(key);
    }
    expect(sheet.assets.map((g) => g.key)).toEqual(ASSET_CLASSES);
    expect(sheet.liabilities.map((g) => g.key)).toEqual(LIABILITY_CLASSES);
    expect([...sheet.assets, ...sheet.liabilities].some((g) => /current/i.test(g.label))).toBe(false);
  });

  it("leaves out a class that holds no account", () => {
    const only = buildLedger({ ...facts, accounts: [accounts[0]], startingBalances: [{ accountId: "cash", month: "2026-01", amountMinor: 100 }] });
    const sheet = buildBalanceSheet(only, "2026-01");
    expect(sheet.assets.map((g) => g.label)).toEqual(["Cash & checking"]);
    expect(sheet.liabilities).toEqual([]);
  });
});
