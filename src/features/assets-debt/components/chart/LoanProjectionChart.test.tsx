import { cloneElement, isValidElement, type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import type { ChartData } from "../../lib/results";
import LoanProjectionChart from "./LoanProjectionChart";
import { amountGrid } from "./chartMeta";

/**
 * The chart's wiring (P1.3b T223, T220): keyboard data navigation through
 * Recharts' accessibility layer, one line per visible series with its own
 * dash pattern, and no animation under reduced motion. Recharts is stubbed:
 * jsdom has no layout, and what is under test is what this module asks of it.
 */

const calls: Record<"chart" | "lines" | "tooltip" | "grids" | "xAxes" | "yAxes" | "referenceLines" | "referenceDots", Record<string, unknown>[]> = {
  chart: [],
  lines: [],
  tooltip: [],
  grids: [],
  xAxes: [],
  yAxes: [],
  referenceLines: [],
  referenceDots: [],
};
jest.mock("recharts", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const capture = (key: "grids" | "xAxes" | "yAxes" | "referenceLines" | "referenceDots") => (props: Record<string, unknown>) => {
    calls[key].push(props);
    return null;
  };
  return {
    ResponsiveContainer: passthrough,
    ComposedChart: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      calls.chart.push(props);
      return <div>{props.children}</div>;
    },
    Line: (props: Record<string, unknown>) => {
      calls.lines.push(props);
      return null;
    },
    Tooltip: (props: Record<string, unknown>) => {
      calls.tooltip.push(props);
      return null;
    },
    CartesianGrid: capture("grids"),
    XAxis: capture("xAxes"),
    YAxis: capture("yAxes"),
    ReferenceLine: capture("referenceLines"),
    ReferenceDot: capture("referenceDots"),
  };
});

const data: ChartData = {
  series: ["balance", "offsetBalance", "cumulativeInterest"],
  points: [
    { period: "2026-10", balance: 100_000, offsetBalance: 5_000, cumulativeInterest: 500 },
    { period: "2026-11", balance: 0, offsetBalance: 5_000, cumulativeInterest: 900 },
  ],
  rateChanges: [{ period: "2026-11", changes: [{ date: "2026-11-15", annualRateDecimal: "0.0612" }] }],
  payoff: { period: "2026-11", date: "2026-11-30" },
};

function reducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

beforeEach(() => {
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = [];
});

it("draws an accessible, distinctly encoded chart with rate and payoff annotations", () => {
  reducedMotion(false);
  render(<LoanProjectionChart data={data} visible={["balance", "offsetBalance"]} digits={2} />);
  expect(calls.chart.at(-1)).toMatchObject({ accessibilityLayer: true });
  expect(calls.grids.at(-1)).toMatchObject({ yAxisId: "balance", stroke: "var(--border)", strokeOpacity: 0.45 });
  expect(calls.xAxes.at(-1)?.tickFormatter).toEqual(expect.any(Function));
  expect((calls.xAxes.at(-1)?.tickFormatter as (time: number) => string)(Date.parse("2026-11-01T00:00:00Z"))).toBe("Nov ’26");
  expect(calls.yAxes[0]).toMatchObject({ yAxisId: "balance", domain: [0, 100_000] });
  const last = calls.lines.slice(-2);
  expect(last.map((l) => l.dataKey)).toEqual(["balance", "offsetBalance"]);
  expect(last[0].strokeDasharray).toBeUndefined();
  expect(last[1].strokeDasharray).toBe("2 3");
  expect(last[0].stroke).not.toBe(last[1].stroke);
  expect(last.every((l) => l.isAnimationActive === true)).toBe(true);
  expect(calls.referenceLines).toEqual(expect.arrayContaining([
    expect.objectContaining({ yAxisId: "balance", y: 0 }),
    expect.objectContaining({ x: Date.parse("2026-11-15T00:00:00Z"), yAxisId: "balance", stroke: "var(--chart-rate-change)", strokeDasharray: "2 4", label: expect.objectContaining({ value: "6.12%" }) }),
  ]));
  expect(calls.referenceDots.at(-1)).toMatchObject({ x: Date.parse("2026-11-30T00:00:00Z"), y: 0 });
  expect(calls.referenceDots.at(-1)?.label).toBeUndefined();

  const content = calls.tooltip.at(-1)?.content;
  expect(isValidElement(content)).toBe(true);
  render(cloneElement(content as ReactElement<{ active?: boolean; label?: string; payload?: unknown[] }>, { active: true, label: "2026-11", payload: [{ dataKey: "balance", value: 100_000, color: "var(--chart-1)" }] }));
  expect(screen.getByText("Nov ’26")).toBeInTheDocument();
  expect(screen.getByText("1,000.00")).toBeInTheDocument();
  expect(screen.getByText("Rate changed · 15 Nov 2026")).toBeInTheDocument();
  expect(screen.getByText("6.12%")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/AUD|\$/);
});

it("shows a rate-only period and places event markers on their actual dates", () => {
  render(<LoanProjectionChart data={{ ...data, points: [{ period: "2026-10", balance: 100_000 }, { period: "2026-11", events: [{ date: "2026-11-05", type: "extra-repayment" }, { date: "2026-11-20", type: "fee" }] }, { period: "2026-12", balance: 0 }] }} visible={["balance"]} digits={2} showEvents />);
  expect(calls.tooltip.at(-1)?.filterNull).toBe(false);
  const content = calls.tooltip.at(-1)?.content as ReactElement<{ active?: boolean; label?: number; payload?: unknown[] }>;
  render(cloneElement(content, { active: true, label: Date.parse("2026-11-01T00:00:00Z"), payload: [{ dataKey: "balance", value: null, payload: { period: "2026-11" } }] }));
  expect(screen.getByText("Rate changed · 15 Nov 2026")).toBeInTheDocument();
  expect(calls.referenceLines).toEqual(expect.arrayContaining([expect.objectContaining({ x: Date.parse("2026-11-05T00:00:00Z") }), expect.objectContaining({ x: Date.parse("2026-11-20T00:00:00Z") })]));
});

it("uses 50,000 grid increments and 100,000 labels for a 550,000 loan", () => {
  const amounts = amountGrid(55_000_000);
  expect(amounts.grid).toHaveLength(12);
  expect(amounts.grid.slice(0, 3)).toEqual([0, 5_000_000, 10_000_000]);
  expect(amounts.labels.slice(0, 3)).toEqual([0, 10_000_000, 20_000_000]);
  expect(amountGrid(150_000_000).labels).toEqual([0, 20_000_000, 40_000_000, 60_000_000, 80_000_000, 100_000_000, 120_000_000, 140_000_000, 160_000_000]);
  for (const max of [0, 1, 999, 12_345_678, 150_000_000]) {
    const grid = amountGrid(max).grid;
    expect(grid.length).toBeLessThanOrEqual(15);
    expect(grid.at(-1)).toBeGreaterThanOrEqual(max);
  }
});

it("does not animate under reduced motion", () => {
  reducedMotion(true);
  render(<LoanProjectionChart data={data} visible={["balance", "cumulativeInterest"]} digits={2} />);
  const settled = calls.lines.slice(-2);
  expect(settled.every((l) => l.isAnimationActive === false)).toBe(true);
  expect(calls.tooltip.at(-1)).toMatchObject({ isAnimationActive: false });
  expect(settled[1]).toMatchObject({ dataKey: "cumulativeInterest", yAxisId: "balance" });
});

it("uses a separate right axis for interest only when requested and visible", () => {
  reducedMotion(true);
  const { rerender } = render(<LoanProjectionChart data={data} visible={["balance", "cumulativeInterest"]} digits={2} separateInterest />);
  expect(calls.yAxes.at(-1)).toMatchObject({ yAxisId: "interest", orientation: "right", label: expect.objectContaining({ value: "Interest" }) });
  expect(calls.lines.at(-1)).toMatchObject({ dataKey: "cumulativeInterest", yAxisId: "interest" });
  expect(calls.yAxes[0]).toMatchObject({ yAxisId: "balance", domain: [0, 100_000] });
  calls.yAxes = [];
  rerender(<LoanProjectionChart data={data} visible={["balance"]} digits={2} separateInterest />);
  expect(calls.yAxes).toHaveLength(1);
  expect(calls.yAxes[0]).toMatchObject({ yAxisId: "balance" });
});

it("places a partial opening year proportionally and uses straight lines", () => {
  reducedMotion(true);
  render(<LoanProjectionChart data={{ ...data, points: [
    { period: "opening:2025-10-01", openingDate: "2025-10-01", date: "2025-10-01", balance: 55_000_000 },
    { period: "2025", date: "2025-12-01", balance: 54_000_000 },
    { period: "2026", date: "2026-12-01", balance: 50_000_000 },
  ] }} visible={["balance"]} digits={2} />);
  const points = calls.chart.at(-1)?.data as { x: number }[];
  expect(points[1].x - points[0].x).toBe(61 * 86_400_000);
  expect(points[2].x - points[1].x).toBe(365 * 86_400_000);
  expect(calls.xAxes.at(-1)).toMatchObject({ type: "number", dataKey: "x" });
  expect(calls.lines.at(-1)).toMatchObject({ type: "linear" });
  expect(calls.grids.at(-1)?.verticalValues).toEqual([Date.parse("2025-10-01T00:00:00Z"), Date.parse("2026-01-01T00:00:00Z")]);
});

it("scales the amount grid to all visible series", () => {
  reducedMotion(true);
  render(<LoanProjectionChart data={{ ...data, points: [{ period: "2026-10", balance: 55_000_000, offsetBalance: 80_000_000 }] }} visible={["balance", "offsetBalance"]} digits={2} />);
  const grid = calls.grids.at(-1)?.horizontalValues as number[];
  expect(grid.at(-1)).toBeGreaterThanOrEqual(80_000_000);
  expect(grid.length).toBeLessThanOrEqual(15);
});

it("distinguishes interest charged in the period from the cumulative line", () => {
  reducedMotion(true);
  render(<LoanProjectionChart data={data} visible={["balance", "cumulativeInterest"]} digits={2} />);
  const content = calls.tooltip.at(-1)?.content as ReactElement<{ active?: boolean; label?: string; payload?: unknown[] }>;
  const point = { period: "2026-11", periodInterestMinor: 500, paymentMinor: 2_000, paymentBreakdown: { principal: 1_500, interest: 500 } };
  render(cloneElement(content, { active: true, label: "2026-11", payload: [{ dataKey: "cumulativeInterest", value: 900, payload: point }] }));
  expect(screen.getByText("Interest")).toBeInTheDocument();
  expect(screen.getByText("Interest paid")).toBeInTheDocument();
  expect(screen.getByLabelText("75% of repayments")).toBeInTheDocument();
  expect(screen.getByLabelText("25% of repayments")).toBeInTheDocument();
  expect(screen.queryByLabelText("100% of projected total interest")).not.toBeInTheDocument();
});

it("keeps zero principal and interest visible while hiding zero fees", () => {
  reducedMotion(true);
  render(<LoanProjectionChart data={data} visible={["balance"]} digits={2} />);
  const content = calls.tooltip.at(-1)?.content as ReactElement<{ active?: boolean; label?: string; payload?: unknown[] }>;
  const point = { period: "2026-11", paymentMinor: 0, paymentBreakdown: { principal: 0, interest: 0, fee: 0 } };
  render(cloneElement(content, { active: true, label: "2026-11", payload: [{ dataKey: "balance", value: 1_000, payload: point }] }));
  expect(screen.getByText("Interest").nextElementSibling).toHaveTextContent("0.00");
  expect(screen.getByText("Principal").nextElementSibling).toHaveTextContent("0.00");
  expect(screen.queryByText("Fees")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/of repayments/)).not.toBeInTheDocument();
});
