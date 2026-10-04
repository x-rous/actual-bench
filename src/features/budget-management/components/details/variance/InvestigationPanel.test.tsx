import { fireEvent, render, screen } from "@testing-library/react";
import {
  buildSelectionFacts,
  buildVarianceModel,
  effectiveDriverIds,
} from "../../../lib/varianceInvestigation";
import { createVarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import { statesFor, type CategorySpec } from "../../../lib/varianceInvestigation/testing";
import { InvestigationPanel } from "./InvestigationPanel";

const mockUse = jest.fn();
jest.mock("../../../hooks/useLargestTransactions", () => ({
  useLargestTransactions: (...args: unknown[]) => mockUse(...args),
}));

const format = createVarianceFormat(false);
const exp = (id: string, budget: number, spent: number): CategorySpec => ({
  id,
  group: id,
  budgeted: -budget * 100,
  actuals: -spent * 100,
});
const model = buildVarianceModel({
  mode: "tracking",
  side: "expense",
  months: ["2026-08"],
  statesByMonth: statesFor({ "2026-08": [exp("travel", 4000, 8000), exp("food", 3000, 3300), exp("fun", 2500, 1000)] }),
});

const rows = Array.from({ length: 5 }, (_, i) => ({
  id: `t${i}`,
  date: "2026-08-1" + i,
  amount: -(500 - i * 50) * 100,
  payeeName: "Shop " + i,
  categoryId: "travel",
  categoryName: "travel",
  notes: null,
}));

function renderPanel(driverIds: string[], over: Record<string, unknown> = {}) {
  const analysis = effectiveDriverIds(model, driverIds);
  const facts = buildSelectionFacts({ model, driverIds: analysis, baseline: null });
  const props = {
    model,
    format,
    facts,
    baseline: null,
    wholeView: driverIds.length === 0,
    scopeTitle: "All expenses",
    recentMonths: ["2026-08"],
    monthFilter: null,
    onClearMonthFilter: jest.fn(),
    selectionCustom: driverIds.length > 0,
    onClearSelection: jest.fn(),
    onSelectCategory: jest.fn(),
    onOpenSpendingAnalysis: jest.fn(),
    onExport: jest.fn(),
    ...over,
  };
  render(<InvestigationPanel {...props} />);
  return props;
}

beforeEach(() => {
  mockUse.mockReset();
  mockUse.mockReturnValue({ data: { rows, total: 1157 }, isLoading: false, isFetching: false, error: null });
});

describe("InvestigationPanel", () => {
  it("describes everything in view when nothing is selected", () => {
    renderPanel([]);
    expect(screen.getByText(/All expenses were/)).toBeInTheDocument();
    // Three groups, two over budget.
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByText("groups over budget")).toBeInTheDocument();
    // No driver filter chip, and every category is asked for.
    expect(screen.queryByText(/^Drivers:/)).not.toBeInTheDocument();
    expect(mockUse.mock.calls[0][0].categoryIds.sort()).toEqual(["food", "fun", "travel"]);
  });

  it("describes only the selected driver, with a chip that clears it", () => {
    const props = renderPanel(["travel"]);
    expect(screen.getByText(/travel was/)).toBeInTheDocument();
    expect(mockUse.mock.calls[0][0].categoryIds).toEqual(["travel"]);
    fireEvent.click(screen.getByRole("button", { name: /Remove filter: Drivers/ }));
    expect(props.onClearSelection).toHaveBeenCalled();
  });

  it("has no This driver / Everything in view switch", () => {
    renderPanel([]);
    expect(screen.queryByText("This driver")).not.toBeInTheDocument();
    expect(screen.queryByText("Everything in view")).not.toBeInTheDocument();
  });

  it("asks for five transactions first and shows the count", () => {
    renderPanel([]);
    expect(mockUse.mock.calls[0][0].limit).toBe(5);
    expect(screen.getByText(/Largest 5 of 1,157/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show more \(5 of 1,157\)/ })).toBeInTheDocument();
  });

  it("raises the page size on Show more", () => {
    renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(mockUse.mock.calls.at(-1)![0].limit).toBe(25);
  });

  it("puts Export at the top and has no evidence footnote", () => {
    const props = renderPanel([]);
    const exportButton = screen.getByRole("button", { name: /Export the drivers shown/ });
    fireEvent.click(exportButton);
    expect(props.onExport).toHaveBeenCalled();
    // It sits on the sentence line, before the toggles.
    const toggle = screen.getByRole("button", { name: "Transactions" });
    expect(exportButton.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Largest by amount\. These rows are evidence only/)).not.toBeInTheDocument();
  });

  it("shows both toggles side by side in the breakdown view", () => {
    renderPanel([]);
    expect(screen.queryByRole("button", { name: "By category" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Breakdown" }));
    const kind = screen.getByRole("button", { name: "By category" });
    const view = screen.getByRole("button", { name: "Breakdown" });
    expect(kind.parentElement?.parentElement).toBe(view.parentElement?.parentElement);
  });

  it("only queries transactions while that view is showing", () => {
    renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "Breakdown" }));
    expect(mockUse.mock.calls.at(-1)![1]).toBe(false);
  });

  it("hides a top-N share that refunds push past 100%", () => {
    mockUse.mockReturnValue({
      data: { rows: [{ ...rows[0], amount: -999999999 }], total: 1 },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    renderPanel([]);
    expect(screen.queryByText(/Top 1 =/)).not.toBeInTheDocument();
  });

  it("opens Spending Analysis on the categories in view", () => {
    const props = renderPanel(["travel"]);
    fireEvent.click(screen.getByRole("button", { name: /View all in Spending Analysis/ }));
    expect(props.onOpenSpendingAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ["travel"], monthStart: "2026-08", monthEnd: "2026-08" })
    );
  });
});
