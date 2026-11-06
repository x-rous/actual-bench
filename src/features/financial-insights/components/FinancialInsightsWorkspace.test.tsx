import { fireEvent, render, screen } from "@testing-library/react";
import { FinancialInsightsWorkspace } from "./FinancialInsightsWorkspace";

jest.mock("../hooks/useFinancialInsights", () => ({ useFinancialInsights: jest.fn() }));
jest.mock("./SummaryTab", () => ({ SummaryTab: () => <div>the summary</div> }));
jest.mock("./MoneyTab", () => ({ MoneyTab: () => <div>the money tab</div> }));
jest.mock("./StatementsTab", () => ({ StatementsTab: () => <div>the financial statements</div> }));
jest.mock("@/components/layout/PageLayout", () => ({ PageLayout: ({ children, header, actions }: { children: React.ReactNode; header?: React.ReactNode; actions?: React.ReactNode }) => <div>{header}{actions}{children}</div> }));
jest.mock("./PeriodControl", () => ({ PeriodControl: () => null }));
const useFinancialInsights = jest.requireMock("../hooks/useFinancialInsights").useFinancialInsights as jest.Mock;

const refresh = jest.fn();
const ready = (over: Record<string, unknown> = {}) => ({
  gate: { state: "ready", accounts: [{ id: "a", name: "Checking" }], excluded: [] }, today: "2026-11-18", period: { kind: "preset", id: "all" }, setPeriod: jest.fn(), refresh, tab: "summary", tabs: [{ value: "summary", label: "Summary" }], setTab: jest.fn(), budgetMode: null,
  data: { state: "ready", summary: { period: { startDate: "2026-01-01", endDate: "2026-10-31", partial: false, label: "This year" } }, firstMonth: "2026-01", readAt: "2026-11-18T10:00:00Z", refreshing: false, refreshFailed: false, review: [], ...over },
});
beforeEach(() => jest.clearAllMocks());

it("opens Financial Statements without depending on a known budget mode", () => {
  useFinancialInsights.mockReturnValue({ ...ready(), tab: "statements", tabs: [{ value: "summary", label: "Summary" }, { value: "statements", label: "Financial Statements" }] });
  render(<FinancialInsightsWorkspace />);
  expect(screen.getByRole("tab", { name: "Financial Statements" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("the financial statements")).toBeInTheDocument();
});

describe("when a later read fails", () => {
  it("says the figures are from an earlier read and offers to try again", () => {
    useFinancialInsights.mockReturnValue(ready({ refreshFailed: true }));
    render(<FinancialInsightsWorkspace />);
    expect(screen.getByRole("alert")).toHaveTextContent("The latest read failed");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("the summary")).toBeInTheDocument();
  });

  it("says nothing while a read is in progress, or when none has failed", () => {
    useFinancialInsights.mockReturnValue(ready({ refreshFailed: true, refreshing: true }));
    const { unmount } = render(<FinancialInsightsWorkspace />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
    useFinancialInsights.mockReturnValue(ready());
    render(<FinancialInsightsWorkspace />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("the guide", () => {
  it("opens from the top of the page at the section for the tab you are on", () => {
    useFinancialInsights.mockReturnValue({ ...ready(), tab: "money" });
    render(<FinancialInsightsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Guide" }));
    expect(screen.getByRole("heading", { name: "Money in & out", level: 2 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("navigation", { name: "Guide sections" })).not.toBeInTheDocument();
  });

  it("is there while the page is locked, when it is what explains why", () => {
    useFinancialInsights.mockReturnValue({ ...ready(), tab: "summary", gate: { state: "setup", rows: [] }, data: { state: "loading" } });
    render(<FinancialInsightsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Guide" }));
    expect(screen.getByRole("heading", { name: "Summary", level: 2 })).toBeInTheDocument();
  });
});
