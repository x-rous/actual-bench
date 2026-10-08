import { cloneElement, isValidElement, type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import type { ChartData } from "../../lib/results";
import LoanProjectionChart from "./LoanProjectionChart";

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
  expect(calls.grids.at(-1)).toMatchObject({ vertical: false });
  expect(calls.xAxes.at(-1)?.tickFormatter).toEqual(expect.any(Function));
  expect((calls.xAxes.at(-1)?.tickFormatter as (period: string) => string)("2026-11")).toBe("Nov ’26");
  expect(calls.yAxes[0]).toMatchObject({ yAxisId: "balance", domain: [0, "auto"], label: expect.objectContaining({ value: "Balance" }) });
  const last = calls.lines.slice(-2);
  expect(last.map((l) => l.dataKey)).toEqual(["balance", "offsetBalance"]);
  expect(last[0].strokeDasharray).toBeUndefined();
  expect(last[1].strokeDasharray).toBe("2 3");
  expect(last[0].stroke).not.toBe(last[1].stroke);
  expect(last.every((l) => l.isAnimationActive === true)).toBe(true);
  expect(calls.referenceLines).toEqual(expect.arrayContaining([
    expect.objectContaining({ yAxisId: "balance", y: 0 }),
    expect.objectContaining({ x: "2026-11", yAxisId: "balance", stroke: "var(--chart-rate-change)", strokeDasharray: "2 4", label: expect.objectContaining({ value: "6.12%" }) }),
  ]));
  expect(calls.referenceDots.at(-1)).toMatchObject({ x: "2026-11", y: 0, label: expect.objectContaining({ value: "Paid off" }) });

  const content = calls.tooltip.at(-1)?.content;
  expect(isValidElement(content)).toBe(true);
  render(cloneElement(content as ReactElement<{ active?: boolean; label?: string; payload?: unknown[] }>, { active: true, label: "2026-11", payload: [{ dataKey: "balance", value: 100_000, color: "var(--chart-1)" }] }));
  expect(screen.getByText("Nov ’26")).toBeInTheDocument();
  expect(screen.getByText("1,000.00")).toBeInTheDocument();
  expect(screen.getByText("Rate changed · 15 Nov 2026")).toBeInTheDocument();
  expect(screen.getByText("6.12%")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/AUD|\$/);
});

it("does not animate under reduced motion", () => {
  reducedMotion(true);
  render(<LoanProjectionChart data={data} visible={["balance", "cumulativeInterest"]} digits={2} />);
  const settled = calls.lines.slice(-2);
  expect(settled.every((l) => l.isAnimationActive === false)).toBe(true);
  expect(calls.tooltip.at(-1)).toMatchObject({ isAnimationActive: false });
  // Interest paid so far is drawn against its own axis.
  expect(settled[1]).toMatchObject({ dataKey: "cumulativeInterest", yAxisId: "interest" });
});
