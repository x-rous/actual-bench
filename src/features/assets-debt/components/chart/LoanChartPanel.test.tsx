import { fireEvent, render, screen } from "@testing-library/react";
import type { ChartData } from "../../lib/results";
import { LoanChartPanel } from "./LoanChartPanel";

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => function ChartStub() {
    return <div data-testid="loan-chart" />;
  },
}));

const data: ChartData = {
  points: [
    { period: "2026-10", balance: 100_000, cumulativeInterest: 500 },
    { period: "2026-11", balance: 0, cumulativeInterest: 900 },
  ],
  series: ["balance", "cumulativeInterest"],
  rateChanges: [{ period: "2026-11", changes: [{ date: "2026-11-15", annualRateDecimal: "0.0612" }] }],
  payoff: { period: "2026-11", date: "2026-11-30" },
};

it("pairs the visual annotations with a currency-neutral text summary", () => {
  render(<LoanChartPanel data={data} view="month" onViewChange={() => {}} digits={2} />);

  expect(screen.getByText("Rate change")).toBeInTheDocument();
  expect(screen.getByText(/Loan balance from Oct ’26 to Nov ’26/)).toHaveTextContent("Paid off on 30 Nov 2026. Rate changes: 15 Nov 2026 to 6.12%.");
  expect(document.body).not.toHaveTextContent(/AUD|\$/);

  const balance = screen.getByRole("button", { name: /Loan balance/ });
  expect(balance).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(balance);
  expect(balance).toHaveAttribute("aria-pressed", "false");
});
