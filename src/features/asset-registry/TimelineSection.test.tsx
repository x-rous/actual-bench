import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CHART_PREFS, TimelineSection, type ChartPrefs, type TimelineProps } from "./TimelineSection";

/** The page holds the chart choices; most of these tests are about months, so it starts there (the real default is Yearly). */
function Monthly(p: TimelineProps) { const [prefs, setPrefs] = useState<ChartPrefs>({ ...DEFAULT_CHART_PREFS, view: "monthly" }); return <TimelineSection {...p} prefs={prefs} onPrefs={setPrefs} />; }

const rows = [
  { date: "2026-01-10", classification: "opening-balance", amountMinor: 1000000, runningMinor: 1000000 },
  { date: "2026-03-02", classification: "acquisition", amountMinor: 100000, runningMinor: 1100000 },
  { date: "2026-03-31", classification: "depreciation", amountMinor: -10000, runningMinor: 1090000 },
  { date: "2026-04-30", classification: "depreciation", amountMinor: -10000, runningMinor: 1080000 },
];
const props = (extra: Partial<TimelineProps> = {}): TimelineProps => ({ today: "2026-10-25", valueMinor: 1080000, rows, debtAt: () => null, unposted: [], operating: [{ date: "2026-05-05", category: "Rent", amountMinor: 150000, income: true }, { date: "2026-05-14", category: "Repairs", amountMinor: -35000, income: false }],
  capital: [{ date: "2026-03-01", kind: "investment", amountMinor: -100000, rowIds: ["roof"] }, { date: "2026-06-10", kind: "disposal", amountMinor: 50000, rowIds: ["sale"] }], showCashflow: true, reading: false, financing: [], onFinancing: jest.fn(), onBook: jest.fn(), onCashflow: jest.fn(), ...extra });

it("groups book events into one marker per kind and month, reachable by keyboard as a single tab stop", () => {
  const p = props(); render(<Monthly {...p} />);
  const lane = screen.getByRole("toolbar", { name: "Value chart events" });
  const markers = within(lane);
  expect(markers.getAllByRole("button")).toHaveLength(3); // purchase (Mar), depreciation (Mar), depreciation (Apr)
  expect(markers.getAllByRole("button").filter((b) => b.tabIndex === 0)).toHaveLength(1);
  fireEvent.keyDown(lane, { key: "ArrowRight" });
  expect(markers.getAllByRole("button")[1]).toHaveFocus();
  fireEvent.click(markers.getByRole("button", { name: /Mar 2026: Acquisition \/ Purchase \+1,000.00/ }));
  expect(p.onBook).toHaveBeenCalledWith({ from: "2026-03-01", to: "2026-03-31", types: ["acquisition"], label: "Acquisition / Purchase · Mar 2026" });
});
it("opens Income & Expenses for an operating month, and routes capital markers to where their rows live", () => {
  const p = props(); render(<Monthly {...p} />);
  const lane = within(screen.getByRole("toolbar", { name: "Income and capital markers" }));
  fireEvent.click(lane.getByRole("button", { name: /May ’26|May 2026: net operating result \+1,150.00/ }));
  expect(p.onCashflow).toHaveBeenCalledWith({ from: "2026-05-01", to: "2026-05-31", label: "May 2026" });
  fireEvent.click(lane.getByRole("button", { name: /Mar 2026: Purchases and payments -1,000.00/ }));
  expect(p.onBook).toHaveBeenCalledWith(expect.objectContaining({ types: ["acquisition", "added-capital"], from: "2026-03-01" }));
  fireEvent.click(lane.getByRole("button", { name: /Jun 2026: Disposal proceeds, net of selling costs \+500.00/ }));
  expect(p.onBook).toHaveBeenCalledWith(expect.objectContaining({ types: ["disposal"], from: "2026-06-01" }));
});
it("offers capital bars only when there are capital movements, and hides the second chart without cashflows", () => {
  const { unmount } = render(<Monthly {...props()} />);
  expect(screen.getByRole("checkbox", { name: "Include capital movements" })).toBeInTheDocument();
  unmount();
  render(<Monthly {...props({ showCashflow: false })} />);
  expect(screen.queryByRole("figure", { name: "Income, expenses & capital" })).not.toBeInTheDocument();
});
it("extends both charts with projected periods only while schedule months are unposted, and switches to years", () => {
  const { rerender } = render(<Monthly {...props()} />);
  expect(screen.queryByText(/Projected if the schedule posts/)).not.toBeInTheDocument();
  rerender(<Monthly {...props({ unposted: [{ postDate: "2026-10-31", amountMinor: 10000 }] })} />);
  expect(screen.getByText(/Projected if the schedule posts/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
  expect(screen.getByRole("button", { name: "Yearly" })).toHaveAttribute("aria-pressed", "true");
});
it("draws both charts, with debt and the projection on the value chart, without runtime errors", async () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<Monthly {...props({ debtAt: (date) => date >= "2026-02-01" ? 400000 : null, unposted: [{ postDate: "2026-10-31", amountMinor: 10000 }] })} />);
  const value = await screen.findByRole("img", { name: /Recorded value over time with allocated debt/ });
  const cash = await screen.findByRole("img", { name: /Operating income and expenses over time/ });
  expect(value.querySelector("svg")).not.toBeNull(); expect(cash.querySelector("svg")).not.toBeNull();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
it("summarizes value, debt and equity for the hovered period and falls back to opening, change and closing without a loan", () => {
  const { unmount } = render(<Monthly {...props({ debtAt: (date) => date >= "2026-02-01" ? 400000 : null })} />);
  const list = screen.getByLabelText("Value summary");
  expect(within(list).getByText("Allocated debt")).toBeInTheDocument(); expect(within(list).getByText("Equity")).toBeInTheDocument();
  expect(within(list).queryByText("Opening value")).not.toBeInTheDocument();
  unmount();
  render(<Monthly {...props()} />);
  const plain = screen.getByLabelText("Value summary");
  expect(within(plain).getByText("Opening value")).toBeInTheDocument(); expect(within(plain).getByText("Closing value")).toBeInTheDocument();
  expect(within(plain).queryByText("Highest")).not.toBeInTheDocument();
});
it("marks loan allocation changes in plain words and opens Financing", () => {
  const p = props({ financing: [{ date: "2026-07-01", text: "Mortgage: allocation changed from 100% to 60%" }] }); render(<Monthly {...p} />);
  fireEvent.click(within(screen.getByRole("toolbar", { name: "Value chart events" })).getByRole("button", { name: /Jul 2026: Mortgage: allocation changed from 100% to 60%/ }));
  expect(p.onFinancing).toHaveBeenCalled();
});
it("lets the net line and the projection be switched off from the legend", () => {
  render(<Monthly {...props({ unposted: [{ postDate: "2026-10-31", amountMinor: 10000 }] })} />);
  fireEvent.click(screen.getByRole("button", { name: "Net operating result" }));
  expect(screen.getByRole("button", { name: "Net operating result" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: /Projected if the schedule posts/ }));
  expect(screen.getByRole("button", { name: /Projected if the schedule posts/ })).toHaveAttribute("aria-pressed", "false");
});

it("leaves money put in out of the value change, and shows debt and equity as a share of value", () => {
  const p = props({ rows: [
    { date: "2026-01-10", classification: "opening-balance", amountMinor: 1000000, runningMinor: 1000000 },
    { date: "2026-03-02", classification: "acquisition", amountMinor: 500000, runningMinor: 1500000 },
    { date: "2026-04-30", classification: "revaluation", amountMinor: 100000, runningMinor: 1600000 },
  ], valueMinor: 1600000, debtAt: (date: string) => (date >= "2026-03-01" ? 400000 : null) });
  render(<Monthly {...p} />);
  const summary = screen.getByLabelText("Value summary");
  expect(within(summary).getByText("Value change in range").nextElementSibling).toHaveTextContent("+1,000.00"); // the 5,000.00 purchase is not a gain
  expect(within(summary).getByText("Allocated debt").parentElement).toHaveTextContent("25.0% of value");
});
it("says there is no loan yet, in place, for a period before the first allocation instead of an unavailable balance", () => {
  const p = props({ financing: [{ date: "2026-04-01", text: "Loan: allocated at 100%" }], debtAt: (date: string) => (date >= "2026-04-01" ? 400000 : null) });
  render(<Monthly {...p} />);
  const summary = screen.getByLabelText("Value summary");
  expect(within(summary).getByText("Allocated debt").parentElement).toHaveTextContent("of value"); // the latest period has a loan
  fireEvent.focus(within(screen.getByRole("toolbar", { name: "Value chart events" })).getAllByRole("button")[0]); // the January marker
  expect(within(summary).getByText("Allocated debt").parentElement).toHaveTextContent("No loan yet");
  expect(within(summary).getByText("Equity").parentElement).toHaveTextContent("No loan yet");
  expect(within(summary).queryByText("Unavailable")).not.toBeInTheDocument();
});

it("opens on years, keeps its choices when the page holds them, and draws the capital line and a smooth value on request", () => {
  const { unmount } = render(<TimelineSection {...props()} />);
  expect(screen.getByRole("button", { name: "Yearly" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Monthly" })); expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Capital invested" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: "Smooth value" })); expect(screen.getByRole("checkbox", { name: "Smooth value" })).toBeChecked();
  unmount();
  const kept: ChartPrefs = { ...DEFAULT_CHART_PREFS, view: "monthly", smoothValue: true }; // the page's copy, as after a change of tab
  render(<TimelineSection {...props()} prefs={kept} onPrefs={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true"); expect(screen.getByRole("checkbox", { name: "Smooth value" })).toBeChecked();
});
it("shows the income figures two across: income, expenses with their share of income, net with a monthly average, the largest expense, capital out and net disposal proceeds", () => {
  render(<Monthly {...props({ operating: [{ date: "2026-05-05", category: "Rent", amountMinor: 200000, income: true }, { date: "2026-06-05", category: "Repairs", amountMinor: -30000, income: false }, { date: "2026-07-05", category: "Rates", amountMinor: -10000, income: false }] })} />);
  const dl = screen.getByLabelText("Income and expense summary");
  expect(dl).toHaveClass("grid-cols-2");
  expect(within(dl).getAllByRole("term").map((t) => t.textContent)).toEqual(["Operating income", "Operating expenses", "Net operating result", "Average yearly net result", "Capital out", "Net disposal proceeds"]);
  expect(within(dl).getByText("Operating expenses").parentElement).toHaveTextContent("20.0% of income");
  const yearly = within(dl).getByText("Average yearly net result").parentElement!;
  expect(yearly).toHaveTextContent("Needs six months"); // May to October is under a year of history
});
it("puts the recorded value and its change first, then debt and equity side by side, then capital invested and the yearly growth", () => {
  const p = props({ debtAt: (date) => date >= "2026-02-01" ? (date < "2026-06-01" ? 500000 : 400000) : null });
  render(<Monthly {...p} />);
  const dl = screen.getByLabelText("Value summary");
  expect(within(dl).getAllByRole("term").map((t) => t.textContent)).toEqual(["Recorded value", "Value change in range", "Allocated debt", "Equity", "Capital invested", "Yearly growth"]);
  expect(within(dl).getByText("Capital invested").parentElement).toHaveTextContent("11,000.00"); expect(within(dl).getByText("Capital invested").parentElement).toHaveTextContent("2% below capital"); // 10,800.00 recorded against 11,000.00 put in
  expect(within(dl).getByText("Yearly growth").parentElement).toHaveTextContent("Needs a range of at least a year"); // a monthly chart spans under a year
});
it("without a loan, keeps the closing value and its change first and adds the capital invested", () => {
  render(<Monthly {...props()} />);
  expect(within(screen.getByLabelText("Value summary")).getAllByRole("term").map((t) => t.textContent)).toEqual(["Closing value", "Change in range", "Opening value", "Capital invested", "Yearly growth"]);
});
it("gives the yearly growth of the value, leaving the money put in out, once the range spans a year", () => {
  const long = [{ date: "2024-01-10", classification: "opening-balance", amountMinor: 1000000, runningMinor: 1000000 }, { date: "2025-06-01", classification: "revaluation", amountMinor: 300000, runningMinor: 1300000 }];
  render(<TimelineSection {...props({ rows: long, valueMinor: 1300000, operating: [], capital: [] })} />);
  const growth = within(screen.getByLabelText("Value summary")).getByText("Yearly growth").parentElement!;
  expect(growth).toHaveTextContent("+15.5% a year"); expect(growth).toHaveTextContent("1.8 years");
  expect(within(screen.getByLabelText("Value summary")).getByText("Change in range").parentElement).toHaveTextContent("+30.00%");
});
it("sets the decimals of the side figures of both charts smaller", () => {
  render(<Monthly {...props()} />);
  for (const name of ["Value summary", "Income and expense summary"]) expect(within(screen.getByLabelText(name)).getAllByText(".00", { selector: "span" })[0]).toHaveClass("text-[0.7em]");
});
it("averages the net result over the years since the first income or expense, whichever view is shown", () => {
  const operating = [{ date: "2024-10-25", category: "Rent", amountMinor: 1200000, income: true }, { date: "2025-10-25", category: "Rent", amountMinor: 1200000, income: true }, { date: "2026-02-01", category: "Repairs", amountMinor: -400000, income: false }];
  render(<Monthly {...props({ operating })} />);
  const tile = within(screen.getByLabelText("Income and expense summary")).getByText("Average yearly net result").parentElement!;
  expect(tile).toHaveTextContent("10,000.00"); expect(tile).toHaveTextContent("833.33 monthly - 2.0 years"); // 24,000.00 of income less 4,000.00 of repairs, over two years
});
