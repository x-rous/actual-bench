import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { buildLedger, summarize, type FinancialFacts } from "@/lib/financial-insights/measures";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { buildStatements, type StatementEntry } from "@/lib/financial-insights/statements";
import type { CategoryInfo } from "@/lib/financial-insights/breakdowns";
import { downloadCsv } from "@/lib/csv";
import type { ReadyData } from "../hooks/useFinancialInsights";
import { useStatements } from "../hooks/useStatements";
import { StatementsTab } from "./StatementsTab";

jest.mock("../hooks/useStatements", () => ({ useStatements: jest.fn() }));
jest.mock("@/lib/csv", () => ({ downloadCsv: jest.fn() }));
const period = resolvePeriod({ kind: "preset", id: "this-month" }, "2026-11-06", null);
const categories = new Map<string, CategoryInfo>([["salary", { id: "salary", name: "Salary", groupName: "Income sources", hidden: false, isIncome: true }]]);
const entries: StatementEntry[] = [{ id: "salary-row", date: "2026-11-02", accountId: "bank", categoryId: "salary", amountMinor: 12345, transferAccountId: null, transferId: null, parentId: null, startingBalance: false }];
const facts: FinancialFacts = {
  accounts: [{ id: "bank", name: "Checking", accountClass: "bank", treatment: null, offBudget: false }], excluded: new Set(), incomeCategories: new Set(["salary"]),
  movement: [{ month: "2026-11", accountId: "bank", categoryId: "salary", transferAccountId: null, amountMinor: 12345, count: 1 }],
  startingBalances: [], transfersIn: [], uncategorizedIn: [], loanCosts: [], reclassified: [],
};
const ledger = buildLedger(facts);
const model = buildStatements({ ledger, period, categories, entries, assetEntries: [], savedClassifications: [], basisIssue: null });
const data = { ledger, period, categories, summary: summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 }) } as unknown as ReadyData;
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useStatements).mockReturnValue({ model, isError: false, retry: jest.fn() }); });

it("shows equally sized statements without repeating the global period, and compact collapsed groups with exact drill-downs", () => {
  const onDrill = jest.fn();
  render(<StatementsTab data={data} onDrill={onDrill} />);
  expect(screen.getByTestId("statements-pair")).toHaveClass("grid-cols-2");
  expect(screen.queryByText(/01 Nov 2026 – 06 Nov 2026/)).not.toBeInTheDocument();
  expect(screen.queryByText(/No estimated accruals/)).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Financial statements" })).not.toBeInTheDocument();
  expect(screen.queryByText("Classification needs review")).not.toBeInTheDocument();
  expect(screen.getByText("Balances reconcile")).toBeInTheDocument();
  const pnl = screen.getByRole("region", { name: "Income Statement (P&L)" });
  const expand = within(pnl).getByRole("button", { name: "Expand Income sources, 1 category" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  expect(within(pnl).queryByRole("rowheader", { name: "Salary" })).not.toBeInTheDocument();
  fireEvent.click(expand);
  expect(expand).toHaveAttribute("aria-expanded", "true");
  expect(within(pnl).getByRole("rowheader", { name: "Salary" })).toHaveClass("pl-10", "py-1");
  fireEvent.click(within(pnl).getByRole("button", { name: "Salary +123.45. Show the transactions" }));
  expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "statement", ids: ["salary-row"], amountMinor: 12345 }));
  fireEvent.click(screen.getByRole("button", { name: /Opening cash: .*Show cash accounts/ }));
  expect(within(screen.getByRole("dialog", { name: "Which accounts form cash?" })).getByRole("button", { name: "No Group" })).toHaveAttribute("aria-expanded", "false");
});

it("keeps activity headers, indented contents and their subtotals inside distinct sections", () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  const section = screen.getByRole("region", { name: "Operating activities" });
  expect(section).not.toHaveClass("border", "rounded-md");
  expect(within(section).getByRole("heading", { name: "Operating activities" })).toBeInTheDocument();
  expect(within(section).getByRole("rowheader", { name: "Categorized cash receipts" })).toHaveClass("pl-5", "py-1");
  expect(within(section).getByText("Net cash from operating activities")).toBeInTheDocument();
  for (const name of ["Investing activities", "Financing activities", "Total Income", "Total Expenses"]) expect(screen.getByRole("region", { name })).not.toHaveClass("border", "rounded-md");
});

it("shows totals in the section headers and removes the top-level controls", () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  const income = screen.getByRole("region", { name: "Total Income" });
  expect(within(income).getByRole("heading", { name: /Total Income/ })).toHaveTextContent("+123.45");
  expect(within(income).getByRole("columnheader", { name: "Group / category" }).parentElement?.parentElement).toHaveClass("sr-only");
  expect(screen.queryByRole("button", { name: "Account classification rules" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
});

it("keeps a reconciled but unclassified statement distinct from a trusted P&L result", () => {
  jest.mocked(useStatements).mockReturnValue({ model: { ...model, classificationComplete: false, pnl: { ...model.pnl, basisIssue: "Asset evidence unavailable" } }, isError: false, retry: jest.fn() });
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  expect(screen.getByText("Balances reconcile")).toBeInTheDocument();
  expect(screen.queryByText("Classification needs review")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Financial statements" })).not.toBeInTheDocument();
  expect(screen.getByText("Net surplus / deficit needs review")).toBeInTheDocument();
});

it("shows investment activity as neutral information with its own exact drill-down, outside classification exceptions", () => {
  const investmentActivity = { key: "investment-activity", label: "Recorded investment activity", amountMinor: 20000, ids: ["gain-1", "gain-2"], detail: "Recorded inside investments; outside P&L and available cash." };
  jest.mocked(useStatements).mockReturnValue({ model: { ...model, investmentActivity }, isError: false, retry: jest.fn() });
  const onDrill = jest.fn();
  render(<StatementsTab data={data} onDrill={onDrill} />);
  const activity = screen.getByRole("region", { name: "Investment activity" });
  expect(within(screen.getByRole("region", { name: "Classification exceptions" })).queryByText(/Recorded investment activity/)).not.toBeInTheDocument();
  fireEvent.click(within(activity).getByRole("button", { name: "Recorded investment activity (2 entries) +200.00. Show the transactions" }));
  expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "statement", ids: ["gain-1", "gain-2"], amountMinor: 20000 }));
  expect(activity.parentElement).toHaveClass("[&>section]:h-auto");
  expect(activity.parentElement?.parentElement).toContainElement(screen.getByRole("region", { name: "Classification exceptions" }));
  expect(downloadCsv).not.toHaveBeenCalled();
});

it("offers retry without rendering a partial statement when evidence fails", () => {
  const retry = jest.fn();
  jest.mocked(useStatements).mockReturnValue({ model: null, isError: true, retry });
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  expect(screen.queryByRole("region", { name: "Cash Flow Statement" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry statements" })); expect(retry).toHaveBeenCalled();
});

it("shows the balance sheet as a period-end snapshot and exports its account balances", () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  const sheet = screen.getByRole("region", { name: "Balance Sheet" });
  const group = within(sheet).getByRole("button", { name: /Cash & bank/ });
  expect(group).toHaveAttribute("aria-expanded", "true");
  const accountGroup = within(sheet).getByRole("button", { name: /No Group/ });
  expect(accountGroup).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(sheet).getByRole("button", { name: "Expand all" }));
  expect(accountGroup).toHaveAttribute("aria-expanded", "true");
  expect(within(sheet).getByRole("rowheader", { name: "Checking" })).toBeVisible();
  expect(within(sheet).getByText("Cash & cash equivalents")).toBeVisible();
  fireEvent.click(within(sheet).getByRole("button", { name: "Collapse all" }));
  expect(accountGroup).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(group);
  expect(group).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(sheet).getByRole("button", { name: "Expand all" }));
  expect(group).toHaveAttribute("aria-expanded", "true");
  expect(within(sheet).getByRole("rowheader", { name: "Checking" })).toBeVisible();
  expect(within(sheet).getByText(/calculated as assets less liabilities/)).toBeInTheDocument();
  // Grouped by class, as What you own and owe is: nothing says current or non-current.
  expect(sheet.textContent ?? "").not.toMatch(/non-current|Current assets|Current liabilities/i);
  fireEvent.click(within(sheet).getByRole("button", { name: "Export Balance Sheet as CSV" }));
  expect(downloadCsv).toHaveBeenCalledWith("financial-insights-balance-sheet.csv", expect.arrayContaining([["Cash & bank", "No Group", "Checking", "Cash & cash equivalents", "123.45"], ["Totals", "", "Net worth", "", "123.45"]]));
});

it("expands and collapses all P&L category groups without changing the balance sheet", () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  const pnl = screen.getByRole("region", { name: "Income Statement (P&L)" });
  fireEvent.click(within(pnl).getByRole("button", { name: "Expand all" }));
  expect(within(pnl).getByRole("rowheader", { name: "Salary" })).toBeVisible();
  const sheet = screen.getByRole("region", { name: "Balance Sheet" });
  expect(within(sheet).queryByRole("rowheader", { name: "Checking" })).not.toBeInTheDocument();
  fireEvent.click(within(pnl).getByRole("button", { name: "Collapse all" }));
  expect(within(pnl).queryByRole("rowheader", { name: "Salary" })).not.toBeInTheDocument();
});

it("opens the cash breakdown from either balance, restores focus and exports totals", async () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  const opening = screen.getByRole("button", { name: /Opening cash: .*Show cash accounts/ });
  opening.focus(); fireEvent.click(opening);
  const dialog = screen.getByRole("dialog", { name: "Which accounts form cash?" });
  const group = within(dialog).getByRole("button", { name: "No Group" });
  expect(group).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(dialog).getByRole("button", { name: "Expand all" }));
  expect(group).toHaveAttribute("aria-expanded", "true");
  expect(within(dialog).getByRole("rowheader", { name: "Checking" })).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Collapse all" }));
  expect(group).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(dialog).getByRole("button", { name: "Export CSV" }));
  expect(downloadCsv).toHaveBeenCalledWith("financial-insights-statement-cash-accounts.csv", expect.arrayContaining([["Checking", "0.00", "123.45"], ["Total cash equivalents", "0.00", "123.45"]]));
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(opening).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: /Closing cash: .*Show cash accounts/ }));
  expect(screen.getByRole("dialog", { name: "Which accounts form cash?" })).toBeVisible();
});

it("exports statement entry counts without scaling them as money", () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Export Cash Flow Statement as CSV" }));
  expect(downloadCsv).toHaveBeenCalledWith("financial-insights-cash-flow-statement.csv", expect.arrayContaining([["Operating activities", "Categorized cash receipts", "123.45", "1", ""]]));
});
