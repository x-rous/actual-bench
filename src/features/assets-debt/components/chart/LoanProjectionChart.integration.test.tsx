import { render, waitFor } from "@testing-library/react";
import type { ChartData } from "../../lib/results";
import LoanProjectionChart from "./LoanProjectionChart";

const data: ChartData = {
  points: [
    { period: "2026-10", balance: 100_000, cumulativeInterest: 500 },
    { period: "2026-11", balance: 50_000, cumulativeInterest: 900 },
    { period: "2026-12", balance: 0, cumulativeInterest: 1_200 },
  ],
  series: ["balance", "cumulativeInterest"],
  rateChanges: [{ period: "2026-11", changes: [{ date: "2026-11-15", annualRateDecimal: "0.0612" }] }],
  payoff: { period: "2026-12", date: "2026-12-31" },
};

it("renders a persistent vertical SVG line for a rate change", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  const { container } = render(<LoanProjectionChart data={data} visible={["balance", "cumulativeInterest"]} digits={2} />);

  await waitFor(() => {
    const line = container.querySelector<SVGLineElement>('.recharts-reference-line-line[stroke="var(--chart-rate-change)"]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute("x1")).toBe(line?.getAttribute("x2"));
    expect(line?.getAttribute("y1")).not.toBe(line?.getAttribute("y2"));
  });
});
