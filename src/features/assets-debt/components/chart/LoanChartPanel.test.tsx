import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { ChartData } from "../../lib/results";
import { LoanChartPanel } from "./LoanChartPanel";

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => function ChartStub({ separateInterest }: { separateInterest?: boolean }) {
    return <div data-testid="loan-chart" data-separate-interest={String(separateInterest)} />;
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
  const accessibleSummary = screen.getByText(/Loan balance from Oct ’26 to Nov ’26/);
  expect(accessibleSummary).toHaveClass("sr-only");
  expect(accessibleSummary).toHaveTextContent("Projected payoff on 30 Nov 2026. Rate changes: 15 Nov 2026 to 6.12%.");
  fireEvent.click(screen.getByRole("button", { name: "About Balance chart help" }));
  const help = screen.getByRole("dialog", { name: "Balance chart help" });
  expect(help).toHaveTextContent("Projected payoff on 30 Nov 2026. Rate changes: 15 Nov 2026 to 6.12%.");
  fireEvent.keyDown(help, { key: "Escape" });
  expect(document.body).not.toHaveTextContent(/AUD|\$/);

  const balance = screen.getByRole("button", { name: /Loan balance/ });
  expect(balance).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(balance);
  expect(balance).toHaveAttribute("aria-pressed", "false");
});

it("uses the separate interest axis only when enabled and the interest line is visible", () => {
  render(<LoanChartPanel data={data} view="month" onViewChange={() => {}} digits={2} />);
  const toggle = screen.getByRole("button", { name: "Interest axis" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("loan-chart")).toHaveAttribute("data-separate-interest", "false");
  fireEvent.click(toggle);
  expect(screen.getByTestId("loan-chart")).toHaveAttribute("data-separate-interest", "true");
  fireEvent.click(screen.getByRole("button", { name: /Interest paid/ }));
  expect(toggle).toBeDisabled();
  expect(screen.getByTestId("loan-chart")).toHaveAttribute("data-separate-interest", "false");
  fireEvent.click(screen.getByRole("button", { name: /Interest paid/ }));
  expect(screen.getByTestId("loan-chart")).toHaveAttribute("data-separate-interest", "true");
  fireEvent.click(toggle);
  expect(screen.getByTestId("loan-chart")).toHaveAttribute("data-separate-interest", "false");
});

it("summarizes the last available loan balance and respects hidden series", () => {
  render(<LoanChartPanel data={{ ...data, points: [...data.points, { period: "2026-12", comparison: 50_000 }] }} view="month" onViewChange={() => {}} digits={2} />);
  expect(screen.getByText(/Loan balance from/)).toHaveTextContent("ending at 0.00");
  fireEvent.click(screen.getByRole("button", { name: /Loan balance/ }));
  expect(screen.getByText(/Loan balance is hidden/)).toBeInTheDocument();
});

it("switches chart detail with arrow keys", () => {
  function Harness() {
    const [view, setView] = useState<"month" | "year">("month");
    return <LoanChartPanel data={data} view={view} onViewChange={setView} digits={2} />;
  }
  render(<Harness />);
  const group = within(screen.getByRole("radiogroup", { name: "Chart detail" }));
  const monthly = group.getByRole("radio", { name: "Monthly" });
  monthly.focus();
  fireEvent.keyDown(monthly, { key: "ArrowRight" });
  expect(group.getByRole("radio", { name: "Yearly" })).toHaveAttribute("aria-checked", "true");
  expect(group.getByRole("radio", { name: "Yearly" })).toHaveFocus();
});
