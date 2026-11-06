import { fireEvent, render, screen, within } from "@testing-library/react";
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
const data = { ledger, period, categories, summary: summarize(ledger, period, { unavailableReason: null, rowCount: 0 }) } as ReadyData;
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useStatements).mockReturnValue({ model, isError: false, retry: jest.fn() }); });

it("shows equally sized statements, the global partial period, reconciliation and exact transaction drill-downs", () => {
  const onDrill = jest.fn();
  render(<StatementsTab data={data} onDrill={onDrill} />);
  expect(screen.getByTestId("statements-pair")).toHaveClass("grid-cols-2");
  expect(screen.getByText(/01 Nov 2026 – 06 Nov 2026/)).toHaveTextContent("Partial period");
  expect(screen.getByText("Balances reconcile")).toBeInTheDocument();
  const pnl = screen.getByRole("region", { name: "Income Statement (P&L)" });
  fireEvent.click(within(pnl).getByRole("button", { name: "Salary +123.45. Show the transactions" }));
  expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ kind: "statement", ids: ["salary-row"], amountMinor: 12345 }));
  fireEvent.click(screen.getByRole("button", { name: "Account classification rules" }));
  expect(screen.getByRole("region", { name: "Account classification rules" })).toHaveTextContent("Other Liability");
  fireEvent.click(screen.getByRole("button", { name: "Expand Which accounts form cash?" }));
  expect(screen.getByRole("rowheader", { name: "Checking" })).toBeVisible();
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
  expect(screen.getByText("Classification needs review")).toBeInTheDocument();
  expect(screen.getByText("Net surplus / deficit needs review")).toBeInTheDocument();
});

it("offers retry without rendering a partial statement when evidence fails", () => {
  const retry = jest.fn();
  jest.mocked(useStatements).mockReturnValue({ model: null, isError: true, retry });
  render(<StatementsTab data={data} onDrill={jest.fn()} />);
  expect(screen.queryByRole("region", { name: "Cash Flow Statement" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry statements" })); expect(retry).toHaveBeenCalled();
});
