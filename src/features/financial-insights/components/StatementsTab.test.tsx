import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const data = { ledger, period, categories, summary: summarize(ledger, period, { unavailableReason: null, rowCount: 0 }) } as unknown as ReadyData;
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useStatements).mockReturnValue({ model, isError: false, retry: jest.fn() }); });

it("shows equally sized statements without repeating the global period, and compact collapsed groups with exact drill-downs", () => {
  const onDrill = jest.fn();
  render(<StatementsTab data={data} onDrill={onDrill} />);
  expect(screen.getByTestId("statements-pair")).toHaveClass("grid-cols-2");
  expect(screen.queryByText(/01 Nov 2026 – 06 Nov 2026/)).not.toBeInTheDocument();
  expect(screen.queryByText(/No estimated accruals/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Financial statements" })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Expand Which accounts form cash?" }));
  expect(screen.getByRole("rowheader", { name: "Checking" })).toBeVisible();
});

it("keeps activity headers, indented contents and their subtotals inside distinct sections", () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  const section = screen.getByRole("region", { name: "Operating activities" });
  expect(section).toHaveClass("border", "border-border");
  expect(within(section).getByRole("heading", { name: "Operating activities" })).toBeInTheDocument();
  expect(within(section).getByRole("rowheader", { name: "Categorized cash receipts" })).toHaveClass("pl-5", "py-1");
  expect(within(section).getByText("Net cash from operating activities")).toBeInTheDocument();
  for (const name of ["Investing activities", "Financing activities", "Income", "Expenses"]) expect(screen.getByRole("region", { name })).toHaveClass("border");
});

it("opens classification rules in the shared dialog and restores focus to its trigger", async () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  const trigger = screen.getByRole("button", { name: "Account classification rules" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Account classification rules" });
  expect(dialog).toHaveTextContent("Other Liability");
  expect(within(dialog).getAllByRole("rowheader")).toHaveLength(11);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("exports the displayed statement totals and reporting basis using the shared exporter", () => {
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(downloadCsv).toHaveBeenCalledWith("financial-insights-statements.csv", expect.arrayContaining([
    ["P&L", "Income", "Total income", "123.45", "", ""], ["Cash flow", "Balances", "Closing cash", "123.45", "", ""],
  ]));
});

it("keeps a reconciled but unclassified statement distinct from a trusted P&L result", () => {
  jest.mocked(useStatements).mockReturnValue({ model: { ...model, classificationComplete: false, pnl: { ...model.pnl, basisIssue: "Asset evidence unavailable" } }, isError: false, retry: jest.fn() });
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  expect(screen.getByText("Balances reconcile")).toBeInTheDocument();
  expect(screen.queryByText("Classification needs review")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Financial statements" })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(downloadCsv).toHaveBeenCalledWith("financial-insights-statements.csv", expect.arrayContaining([["Other activity", "Investment activity", "Recorded investment activity", "200.00", 2, investmentActivity.detail]]));
});

it("offers retry without rendering a partial statement when evidence fails", () => {
  const retry = jest.fn();
  jest.mocked(useStatements).mockReturnValue({ model: null, isError: true, retry });
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  expect(screen.queryByRole("region", { name: "Cash Flow Statement" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry statements" })); expect(retry).toHaveBeenCalled();
});
