import { render } from "@testing-library/react";
import type { ChartData } from "../../lib/results";
import LoanProjectionChart from "./LoanProjectionChart";

/**
 * The chart's wiring (P1.3b T223, T220): keyboard data navigation through
 * Recharts' accessibility layer, one line per visible series with its own
 * dash pattern, and no animation under reduced motion. Recharts is stubbed:
 * jsdom has no layout, and what is under test is what this module asks of it.
 */

const calls: { chart: Record<string, unknown>[]; lines: Record<string, unknown>[]; tooltip: Record<string, unknown>[] } = { chart: [], lines: [], tooltip: [] };
jest.mock("recharts", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
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
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const data: ChartData = {
  series: ["balance", "offsetBalance", "cumulativeInterest"],
  points: [
    { period: "2024", balance: 100_000, offsetBalance: 5_000, cumulativeInterest: 500 },
    { period: "2025", balance: 50_000, offsetBalance: 5_000, cumulativeInterest: 900 },
  ],
} as unknown as ChartData;

function reducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

beforeEach(() => {
  calls.chart = [];
  calls.lines = [];
  calls.tooltip = [];
});

it("turns on keyboard navigation and draws each visible series with its own dash pattern", () => {
  reducedMotion(false);
  render(<LoanProjectionChart data={data} visible={["balance", "offsetBalance"]} currency="AUD" digits={2} />);
  expect(calls.chart.at(-1)).toMatchObject({ accessibilityLayer: true });
  const last = calls.lines.slice(-2);
  expect(last.map((l) => l.dataKey)).toEqual(["balance", "offsetBalance"]);
  expect(last[0].strokeDasharray).toBeUndefined();
  expect(last[1].strokeDasharray).toBe("2 3");
  expect(last.every((l) => l.isAnimationActive === true)).toBe(true);
});

it("does not animate under reduced motion", () => {
  reducedMotion(true);
  render(<LoanProjectionChart data={data} visible={["balance", "cumulativeInterest"]} currency="AUD" digits={2} />);
  const settled = calls.lines.slice(-2);
  expect(settled.every((l) => l.isAnimationActive === false)).toBe(true);
  expect(calls.tooltip.at(-1)).toMatchObject({ isAnimationActive: false });
  // Interest paid so far is drawn against its own axis.
  expect(settled[1]).toMatchObject({ dataKey: "cumulativeInterest", yAxisId: "interest" });
});
