import { chooseSelectOption } from "@/components/ui/select.testing";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { incomeBreakdown, monthlyFlows, payeeSpending, spendingBreakdown, spendingFacts, spendingGroups, type CategoryInfo, type PayeeRow } from "@/lib/financial-insights/breakdowns";
import { drillScope } from "@/lib/financial-insights/drill";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { IncomeTab } from "./IncomeTab";
import { TipProvider } from "./charts/Tip";

jest.mock("../hooks/useFinancialInsights", () => ({ usePayeeSpending: () => ({ payees: null, isLoading: true, isError: false, retry: jest.fn() }) }));

const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const salary: CategoryInfo = { id: "salary", name: "Salary", groupName: "Income", hidden: false, isIncome: true, order: 0 };
const bonus: CategoryInfo = { id: "bonus", name: "Bonus", groupName: "Income", hidden: false, isIncome: true, order: 1 };
const rent: CategoryInfo = { id: "rentIn", name: "Rent received", groupName: "Other income", hidden: false, isIncome: true, order: 2 };
const food: CategoryInfo = { id: "food", name: "Groceries", groupName: "Food", hidden: false, isIncome: false, order: 3 };
const categories = new Map([salary, bonus, rent, food].map((c) => [c.id, c]));
const row = (month: string, amountMinor: number, categoryId: string | null, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId: "chk", categoryId, transferAccountId: null, amountMinor, count: 1, ...extra });
const today = "2026-11-18";
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const movement: MovementRow[] = [
  ...months.map((m) => row(m, 300_000, "salary")),
  row("2026-07", 100_000, "bonus"),
  ...months.map((m) => row(m, 40_000, "rentIn")),
  row("2026-09", 25_000, null),
  ...months.map((m) => row(m, -90_000, "food")),
];

function build() {
  const f: FinancialFacts = { accounts: [chk], incomeCategories: new Set(["salary", "bonus", "rentIn"]), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [{ month: "2026-09", accountId: "chk", amountMinor: 25_000 }], transfersIn: [], reclassified: [], loanCosts: [] };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: months[0], endMonth: months[months.length - 1] }, today, ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
  const monthly = monthlyFlows(ledger, period, today, true);
  const breakdown = spendingBreakdown(ledger, period, categories, monthly);
  const incomeRows = incomeBreakdown(ledger, period, categories, monthly);
  return { ledger, period, summary, monthly, breakdown, incomeRows, data: { ledger, period, summary, monthly, breakdown, spending: spendingFacts(breakdown, monthly), groups: spendingGroups(breakdown), comparison: { months: 5, label: "the 5 months before", current: { received: 2_000_000, spent: 540_000, kept: 1_460_000 }, previous: { received: 1_600_000, spent: 600_000, kept: 1_000_000 } }, income: { breakdown: incomeRows, facts: spendingFacts(incomeRows, monthly, (m) => m.received), groups: spendingGroups(incomeRows) } } as never };
}
const show = (onDrill = jest.fn()) => render(<TipProvider><IncomeTab data={build().data} today={today} onDrill={onDrill} /></TipProvider>);
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

describe("income: the breakdown behind the tab", () => {
  it("adds up to the Summary's money received, with uncategorized money in listed apart, each category its own group", () => {
    const { summary, incomeRows } = build();
    expect(incomeRows.rows.every((r) => r.group === r.name)).toBe(true);
    expect(incomeRows.totalMinor).toBe(summary.received);
    expect(incomeRows.rows.map((r) => [r.name, r.totalMinor])).toEqual([["Salary", 1_800_000], ["Rent received", 240_000], ["Bonus", 100_000], ["Uncategorized", 25_000]]);
    expect(incomeRows.rows.find((r) => r.name === "Groceries")).toBeUndefined();
  });

  it("leaves spending where it was, with no income in it", () => {
    const { breakdown, summary } = build();
    expect(breakdown.rows.map((r) => r.name)).toEqual(["Groceries"]);
    expect(breakdown.totalMinor).toBe(summary.spent);
  });

  it("ranks payers by what they paid, and spenders by what was spent, from the same rows", () => {
    const { ledger, period } = build();
    const rows: PayeeRow[] = [
      { payeeId: "acme", categoryId: "salary", accountId: "chk", amountMinor: 1_800_000, count: 6, isChild: false },
      { payeeId: "tenant", categoryId: "rentIn", accountId: "chk", amountMinor: 240_000, count: 6, isChild: false },
      { payeeId: "shop", categoryId: "food", accountId: "chk", amountMinor: -540_000, count: 12, isChild: false },
    ];
    const names = new Map([["acme", "Acme"], ["tenant", "Tenant"], ["shop", "Shop"]]);
    const paid = payeeSpending(rows, ledger, period, categories, names, 15, "income");
    expect(paid.payees.map((p) => [p.name, p.totalMinor, p.topCategory])).toEqual([["Acme", 1_800_000, "Salary"], ["Tenant", 240_000, "Rent received"]]);
    const spent = payeeSpending(rows, ledger, period, categories, names);
    expect(spent.payees.map((p) => [p.name, p.totalMinor])).toEqual([["Shop", 540_000]]);
  });
});

describe("income: its transactions lists add up to the figures", () => {
  it("opens an income category, a group and the uncategorized money in as money received", () => {
    const { ledger, period } = build();
    const ctx = { ledger, period, today, reclassifiedIds: new Set<string>() };
    const category = drillScope({ kind: "category", categoryIds: ["salary"], name: "Salary", amountMinor: 1_800_000, income: true }, ctx);
    expect(category.expectedMinor).toBe(1_800_000);
    expect(category.description).toMatch(/Money received/);
    const uncategorized = drillScope({ kind: "category", categoryIds: [], includeUncategorized: true, name: "Uncategorized", amountMinor: 25_000, income: true }, ctx);
    expect(JSON.stringify(uncategorized.constraints.where)).toContain('"amount":{"$gt":0}');
    const payer = drillScope({ kind: "payee", payeeId: "acme", name: "Acme", amountMinor: 1_800_000, income: true }, ctx);
    expect(payer.expectedMinor).toBe(1_800_000);
    expect(JSON.stringify(payer.constraints.where)).toContain("salary");
  });
});

describe("the Income tab", () => {
  it("shows the received tiles, the timeline by income group and where the money came from", () => {
    show();
    expect(screen.getByText("Total received")).toBeInTheDocument();
    expect(screen.getByText("Largest source")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Income each month" })).toBeInTheDocument();
    const ranking = screen.getByRole("region", { name: "Where the money came from" });
    // Income is listed by category, not by the group Actual keeps it in.
    for (const name of ["Salary", "Rent received", "Bonus", "Uncategorized"]) expect(ranking).toHaveTextContent(name);
    expect(ranking).not.toHaveTextContent("Other income");
    expect(within(ranking).queryByRole("button", { name: /Expand/ })).not.toBeInTheDocument();
  });

  it("sorts income categories by Actual order, income or name", async () => {
    show();
    const ranking = screen.getByRole("region", { name: "Where the money came from" });
    const select = within(ranking).getByRole("combobox", { name: "Sort groups and categories" });
    const names = () => [...ranking.querySelectorAll<HTMLElement>("span[title]")].map((element) => element.title);
    expect(names()).toEqual(["Salary", "Bonus", "Rent received", "Uncategorized"]);
    await chooseSelectOption(select, "Income");
    expect(names()).toEqual(["Salary", "Rent received", "Bonus", "Uncategorized"]);
    await chooseSelectOption(select, "Name");
    expect(names()).toEqual(["Bonus", "Rent received", "Salary", "Uncategorized"]);
  });

  it("opens a category's total as money received", () => {
    const onDrill = jest.fn();
    show(onDrill);
    const ranking = screen.getByRole("region", { name: "Where the money came from" });
    fireEvent.click(within(ranking).getByRole("button", { name: /^Salary 18,000\.00/ }));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "category", categoryIds: ["salary"], income: true, amountMinor: 1_800_000 }));
  });

  it("lists the categories directly in the category table, with nothing to expand", () => {
    show();
    const table = screen.getByRole("region", { name: "Category by month" });
    expect(within(table).getByText("Salary")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /^Expand / })).not.toBeInTheDocument();
  });

  it("has the category table and the payers switch, with the same unit buttons", () => {
    show();
    expect(screen.getByRole("region", { name: "Category by month" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Show income by" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Frequent payers" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Frequent payers" }));
    expect(screen.getByRole("region", { name: "Frequent payers" })).toBeInTheDocument();
  });

  it("says so, instead of drawing empty charts, when no money was received", () => {
    const b = build() as unknown as { data: { income: { groups: { groups: unknown[]; stacked: unknown[] } } } };
    b.data.income = { ...b.data.income, groups: { groups: [], stacked: [] } };
    render(<TipProvider><IncomeTab data={b.data as never} today={today} onDrill={jest.fn()} /></TipProvider>);
    expect(screen.getByText("No money was received in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Income each month" })).not.toBeInTheDocument();
  });
});

describe("the Income tiles", () => {
  it("sets the total against the stretch before, shows the largest source's share, and says how much has no category", () => {
    show();
    const total = screen.getByText("Total received").closest("div")!;
    expect(total).toHaveTextContent("▲ 25.0% vs previous");
    expect(total).toHaveTextContent("1.2% has no category");
    const largest = screen.getByText("Largest source").closest("div")!;
    expect(largest).toHaveTextContent("Salary");
    expect(largest).toHaveTextContent("of income");
  });
});
