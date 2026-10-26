import { fireEvent, render, screen, within } from "@testing-library/react";
import { AssetOverview } from "./AssetOverview";
import { testAsset } from "@/lib/asset-registry/testing";
import type { AssetPerformance } from "@/lib/asset-registry/performance";

const perf = (extra: Partial<AssetPerformance> = {}): AssetPerformance => ({ openingMinor: 1000000, closingMinor: 1100000, capitalAddedMinor: 0, operatingMinor: 150000, netProceedsMinor: 0, totalMinor: 250000, operatingYield: 15, irr: null, simpleReturn: 25, gaps: [], ...extra });
const row = (id: string, date: string, classification: string | null, amountMinor: number, running: number) => ({ id, assetId: "x", date, classification, amountMinor, runningMinor: running, label: id, notes: null });
const bookWith = (rows: ReturnType<typeof row>[]) => ({ rows, issues: [], totals: new Map(), unassignedMinor: 0, available: true }) as never;
const base = { date: "2026-10-24", valueMinor: 1100000, reading: false, reportFor: () => perf(), firstDate: "2025-01-10", debtAt: () => null, unposted: [], operating: [], capital: [], financing: [], depreciationDue: 0, onBook: jest.fn(), onTab: jest.fn(), onFocusBook: jest.fn(), onFocusCashflow: jest.fn() };
const book = bookWith([row("a", "2025-01-10", "opening-balance", 1000000, 1000000), row("b", "2025-06-01", "revaluation", 300000, 1300000), row("c", "2026-03-31", "depreciation", -200000, 1100000)]);
beforeEach(() => jest.clearAllMocks());

it("explains a plain asset's whole life: capital in, valuation adjustments, one timeline and a value-only breakdown", () => {
  render(<AssetOverview {...base} book={book} asset={testAsset("x", { incomeGenerating: false })} reportFor={() => perf({ gaps: ["Linked source is missing or moved"] })} />);
  const strip = screen.getByLabelText("Asset financial summary");
  expect(within(strip).getByText("Capital added")).toBeInTheDocument();
  expect(within(strip).getByText("+10,000.00")).toBeInTheDocument(); // opening balance
  expect(within(strip).getByText("Valuation adjustments").nextElementSibling).toHaveTextContent("+1,000.00"); // +3,000 revaluation − 2,000 depreciation, from classified rows
  expect(within(strip).getByText(/Revaluation \+3,000.00 · Depreciation -2,000.00/)).toBeInTheDocument();
  expect(within(strip).queryByText("Opening value")).not.toBeInTheDocument(); // a life starts from nothing
  expect(within(strip).queryByText("Debt")).not.toBeInTheDocument();
  expect(screen.queryByText("Operating Yield")).not.toBeInTheDocument();
  expect(screen.queryByRole("figure", { name: "Income, expenses & capital" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Book and account context" })).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Needs attention" })).toHaveTextContent("Linked source is missing or moved");
  const breakdown = screen.getByRole("region", { name: "Performance breakdown" });
  expect(within(breakdown).getByRole("columnheader", { name: "Recorded history" })).toBeInTheDocument();
  expect(within(breakdown).getByText("Revaluation (net)")).toBeInTheDocument(); expect(within(breakdown).queryByText("Operating result")).not.toBeInTheDocument();
});
it("shows a disposal as its own tile only when there is one", () => {
  render(<AssetOverview {...base} book={bookWith([row("a", "2025-01-10", "opening-balance", 1000000, 1000000), row("d", "2026-05-01", "disposal", -400000, 600000)])} valueMinor={600000} asset={testAsset("x")} />);
  expect(within(screen.getByLabelText("Asset financial summary")).getByText("Disposals & other")).toBeInTheDocument();
});
it("shows income assets their returns, both timelines, the latest years with data and shortcuts for what needs attention", () => {
  const onBook = jest.fn();
  render(<AssetOverview {...base} onBook={onBook} asset={testAsset("flat", { incomeGenerating: true })} depreciationDue={2}
    operating={[{ date: "2025-05-05", category: "Rent", amountMinor: 150000, income: true }]} capital={[{ date: "2026-03-01", kind: "investment", amountMinor: -2000000, rowIds: ["roof"] }]}
    book={{ rows: [{ id: "u", assetId: null, date: "2026-01-02", amountMinor: 1, classification: null }], issues: [], totals: new Map(), unassignedMinor: 1, available: true } as never} />);
  expect(screen.getByText("Operating Result")).toBeInTheDocument();
  expect(screen.getByRole("figure", { name: "Income, expenses & capital" })).toBeInTheDocument();
  const table = screen.getByRole("region", { name: "Income and expenses by period" });
  expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Category", "This year", "Last year", "Recorded history"]); // the same periods as the performance breakdown
  fireEvent.click(screen.getByRole("button", { name: /2 depreciation months due/ }));
  expect(base.onTab).toHaveBeenCalledWith("Depreciation Schedule");
  fireEvent.click(screen.getByRole("button", { name: /Review 1 unassigned row/ }));
  expect(onBook).toHaveBeenCalledWith("unassigned");
});
it("adds a removable custom period column to the breakdown", () => {
  render(<AssetOverview {...base} book={book} asset={testAsset("x")} />);
  fireEvent.click(screen.getByRole("button", { name: "Custom period" }));
  fireEvent.change(screen.getByLabelText("Custom period from"), { target: { value: "2025-01-01" } });
  fireEvent.change(screen.getByLabelText("Custom period to"), { target: { value: "2025-12-31" } });
  fireEvent.click(screen.getByRole("button", { name: "Show this period" }));
  const breakdown = screen.getByRole("region", { name: "Performance breakdown" });
  expect(within(breakdown).getAllByRole("columnheader")).toHaveLength(5);
  fireEvent.click(within(breakdown).getByRole("button", { name: "Remove custom period" }));
  expect(within(breakdown).getAllByRole("columnheader")).toHaveLength(4);
});
