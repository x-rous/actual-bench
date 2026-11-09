import { fireEvent, render, screen } from "@testing-library/react";
import { FinancialInsightsWorkspace } from "./FinancialInsightsWorkspace";

jest.mock("../hooks/useFinancialInsights", () => ({ useFinancialInsights: jest.fn() }));
jest.mock("./SummaryTab", () => ({ SummaryTab: () => <div>the summary</div> }));
jest.mock("./MoneyTab", () => ({ MoneyTab: () => <div>the money tab</div> }));
jest.mock("./StatementsTab", () => ({ StatementsTab: () => <div>the financial statements</div> }));
jest.mock("@/components/layout/PageLayout", () => ({ PageLayout: ({ children, header, actions }: { children: React.ReactNode; header?: React.ReactNode; actions?: React.ReactNode }) => <div>{header}{actions}{children}</div> }));
jest.mock("./PeriodControl", () => ({ PeriodControl: () => null }));
jest.mock("./ProgressHost", () => ({ ProgressHost: () => <div>the progress tab</div> }));
const useFinancialInsights = jest.requireMock("../hooks/useFinancialInsights").useFinancialInsights as jest.Mock;

const refresh = jest.fn();
const ready = (over: Record<string, unknown> = {}) => ({
  gate: { state: "ready", accounts: [{ id: "a", name: "Checking" }], excluded: [] }, today: "2026-11-18", period: { kind: "preset", id: "all" }, setPeriod: jest.fn(), refresh, tab: "summary", tabs: [{ value: "summary", label: "Summary" }], setTab: jest.fn(), budgetMode: null,
  data: { state: "ready", summary: { period: { startDate: "2026-01-01", endDate: "2026-10-31", partial: false, label: "This year" } }, firstMonth: "2026-01", readAt: "2026-11-18T10:00:00Z", refreshing: false, refreshFailed: false, review: [], ...over },
});
beforeEach(() => jest.clearAllMocks());

it("opens Statements without depending on a known budget mode", () => {
  useFinancialInsights.mockReturnValue({ ...ready(), tab: "statements", tabs: [{ value: "summary", label: "Summary" }, { value: "statements", label: "Statements" }] });
  render(<FinancialInsightsWorkspace />);
  expect(screen.getByRole("tab", { name: "Statements" })).toHaveAttribute("aria-selected", "true");
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

describe("the page header on the Progress tab", () => {
  const onProgress = () => useFinancialInsights.mockReturnValue({
    ...ready(), tab: "progress", tabs: [{ value: "summary", label: "Summary" }, { value: "progress", label: "Progress" }],
    gate: { state: "ready", accounts: [{ id: "a", name: "Checking" }], excluded: [{ id: "x", name: "Secret Excluded Account" }] },
  });
  beforeEach(() => sessionStorage.clear());

  it("never carries the name of an excluded account, in its text, its tooltip or its markup", () => {
    onProgress();
    const { container } = render(<FinancialInsightsWorkspace />);
    expect(screen.getByText("the progress tab")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1 excluded" })).not.toHaveAttribute("title");
    expect(container.innerHTML).not.toContain("Secret Excluded Account");
  });

  it("keeps the excluded names in the tooltip on the other tabs", () => {
    useFinancialInsights.mockReturnValue({ ...ready(), gate: { state: "ready", accounts: [], excluded: [{ id: "x", name: "Secret Excluded Account" }] } });
    render(<FinancialInsightsWorkspace />);
    expect(screen.getByRole("link", { name: "1 excluded" })).toHaveAttribute("title", "Excluded: Secret Excluded Account");
  });

  it("shows when the figures are as of and when they were read, until Show dates is turned off", () => {
    onProgress();
    const { unmount } = render(<FinancialInsightsWorkspace />);
    expect(screen.getByText(/As of /)).toBeInTheDocument();
    expect(screen.getByText(/Read at /)).toBeInTheDocument();
    unmount();
    sessionStorage.setItem("filters:financial-insights-progress", JSON.stringify({ showDates: false }));
    const { container } = render(<FinancialInsightsWorkspace />);
    expect(screen.queryByText(/As of /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Read at /)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b(Jan|Oct|Nov) 2026\b/);
  });
});
