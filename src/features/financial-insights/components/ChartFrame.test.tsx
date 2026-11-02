import { fireEvent, render, screen } from "@testing-library/react";
import { downloadCsv } from "@/lib/csv";
import { ChartFrame } from "./ChartFrame";
import { BarChart } from "./charts/BarChart";
import { TipProvider } from "./charts/Tip";
import { Waterfall } from "./charts/Waterfall";

jest.mock("@/lib/csv", () => ({ downloadCsv: jest.fn() }));
beforeEach(() => { sessionStorage.clear(); jest.clearAllMocks(); });

const table = { head: ["Month", "Received", "Spent"], rows: [["Sep 2026", null, null], ["Oct 2026", 12_345_678, 500_000], ["Nov 2026 (partial)", 40_000, 4_900_00]] as (string | number | null)[][] };

describe("chart frame", () => {
  it("keeps the exact figures for assistive technology, shows an unavailable month as a gap never zero, and exports them", () => {
    render(<ChartFrame id="t" title="Received and spent" table={table} csvScope={[["Period", "Last 6 months"]]} legend={[{ label: "Received", colour: "red" }]}><div>drawn chart</div></ChartFrame>);
    expect(screen.getByText("drawn chart")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("Received");
    const rows = screen.getAllByRole("row");
    expect(rows[1].querySelectorAll("td")[0]).toHaveTextContent("-");
    expect(rows[2]).toHaveTextContent("123,456.78");
    expect(rows[3]).toHaveTextContent("Nov 2026 (partial)");
    expect(screen.queryByRole("button", { name: "Table" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Export Received and spent as CSV/ }));
    expect(downloadCsv).toHaveBeenCalledWith("financial-insights-t.csv", expect.arrayContaining([["Month", "Received", "Spent"], ["Sep 2026", "unavailable", "unavailable"], ["Oct 2026", "123456.78", "5000.00"]]));
  });

  it("opens a detail section under the chart on request", () => {
    render(<ChartFrame id="t" title="Cash" table={table} csvScope={[]} detail={{ label: "Reconciliation table", content: <p>every step</p> }}><div /></ChartFrame>);
    expect(screen.queryByText("every step")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconciliation table" }));
    expect(screen.getByText("every step")).toBeInTheDocument();
  });

  it("keeps the figures one quiet click away: View data swaps the chart for its table, and View chart swaps it back", () => {
    render(<ChartFrame id="t" title="Received and spent" table={table} csvScope={[]}><div>drawn chart</div></ChartFrame>);
    const table1 = screen.getByRole("table", { hidden: true });
    expect(table1.parentElement).toHaveClass("sr-only");
    fireEvent.click(screen.getByRole("button", { name: "View data" }));
    expect(screen.getByRole("table").parentElement).not.toHaveClass("sr-only");
    expect(screen.queryByText("drawn chart")).not.toBeInTheDocument();
    expect(screen.getAllByRole("table", { hidden: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "View chart" }));
    expect(screen.getByText("drawn chart")).toBeInTheDocument();
    expect(screen.getByRole("table", { hidden: true }).parentElement).toHaveClass("sr-only");
  });

  it("puts the long explanation behind an (i) and a short hint beside the title", () => {
    render(<ChartFrame id="t" title="Money in, money out" hint="Received above the line" subtitle={<p>Nothing is stacked, so nothing is counted twice.</p>} table={table} csvScope={[]}><div /></ChartFrame>);
    expect(screen.getByText("Received above the line")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is stacked/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About Money in, money out" }));
    expect(screen.getByText(/Nothing is stacked/)).toBeInTheDocument();
  });

  it("turns a legend entry into a switch when it can be toggled", () => {
    const onToggle = jest.fn();
    render(<ChartFrame id="t" title="Own and owe" table={table} csvScope={[]} legend={[{ label: "Property", colour: "red", onToggle, off: false }, { label: "Loans", colour: "blue", onToggle: () => undefined, off: true }]}><div /></ChartFrame>);
    expect(screen.getByRole("button", { name: "Property" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Loans" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Property" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a table that is already on screen", () => {
    render(<ChartFrame id="t" title="Own and owe" table={table} csvScope={[]} tableShown><div /></ChartFrame>);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("bar chart", () => {
  const series = [
    { key: "a", label: "Housing", colour: "red", values: [100, 200, 50] as (number | null)[] },
    { key: "b", label: "Food", colour: "blue", values: [10, null, 30] as (number | null)[] },
  ];
  it("reports the month and the segment that was selected, and marks the partial month", () => {
    const onSelect = jest.fn();
    render(<TipProvider><BarChart labels={["Sep", "Oct", "Nov"]} partialIndex={2} series={series} stacked ariaLabel="x" tip={() => null} onSelect={onSelect} /></TipProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Food, Sep" }));
    expect(onSelect).toHaveBeenCalledWith(0, 1);
    expect(screen.getByText("Nov*")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Housing, Nov" }).getAttribute("stroke-dasharray")).toBe("3 2");
    expect(screen.getByRole("button", { name: "Housing, Oct" }).getAttribute("stroke-dasharray")).toBeNull();
  });

  it("draws a negative value below zero", () => {
    render(<TipProvider><BarChart labels={["Sep"]} partialIndex={null} series={[{ key: "k", label: "Kept", colour: "green", values: [-100] }, { key: "j", label: "Other", colour: "red", values: [300] }]} ariaLabel="x" tip={() => null} onSelect={() => undefined} /></TipProvider>);
    const negative = screen.getByRole("button", { name: "Kept, Sep" }), positive = screen.getByRole("button", { name: "Other, Sep" });
    expect(Number(negative.getAttribute("y"))).toBeGreaterThanOrEqual(Number(positive.getAttribute("y")) + Number(positive.getAttribute("height")) - 0.5);
  });
});

describe("waterfall", () => {
  it("lets only the steps that have transactions be selected", () => {
    const onSelect = jest.fn();
    render(<TipProvider><Waterfall ariaLabel="w" steps={[{ key: "kept", label: "Money kept", kind: "delta", amountMinor: 1000 }, { key: "unidentified", label: "Unidentified movements", kind: "delta", amountMinor: 500 }, { key: "total", label: "Total change", kind: "total", amountMinor: 1500 }]} canSelect={(s) => s.key === "unidentified"} onSelect={onSelect} /></TipProvider>);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Unidentified movements: \+5\.00/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "unidentified" }));
  });
});
