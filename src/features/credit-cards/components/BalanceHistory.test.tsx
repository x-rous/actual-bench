import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { dailyBalanceHistory } from "../lib/balanceHistory";
import { laptopPlanScenario } from "../lib/fixtures/testKit";
import { BalanceHistory } from "./BalanceHistory";
import BalanceHistoryPlot, { axisTicks } from "./charts/CreditCardBalanceHistory";


it("shows daily Total owed with plan principal, bill outcomes and actionable markers on one tab stop", async () => {
  const { card, workspace, snapshot, signedBalanceMinor, today, saved } = laptopPlanScenario();
  const onStatement = jest.fn();
  render(<BalanceHistory card={card()} workspace={workspace()} snapshot={snapshot} signedBalanceMinor={signedBalanceMinor} today={today} onStatement={onStatement} />);
  const figure = screen.getByRole("figure", { name: "Balance over time" });
  expect(within(figure).getByText("Highest daily balance").parentElement).toHaveTextContent("30,000.00");
  expect(within(figure).getByText(/1 pending entry included/)).toBeVisible();
  expect(within(figure).getByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");
  const statement = await within(figure).findByRole("button", { name: /Statement closes 10 Jul 2026/ });
  fireEvent.keyDown(statement, { key: "Enter" });
  expect(onStatement).toHaveBeenCalledWith(saved[1].id);
  const markers = within(figure).getAllByRole("button", { name: /^(Statement closes|Bill due)/ });
  expect(markers.filter((marker) => marker.getAttribute("tabindex") === "0")).toHaveLength(1);
  const bill = within(figure).getAllByRole("button", { name: /^Bill due/ })[0];
  act(() => bill.focus());
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Bill due/);
  fireEvent.keyDown(bill, { key: "ArrowRight" });
  expect(document.activeElement).not.toBe(bill);
  expect(document.activeElement?.getAttribute("data-marker")).toBeTruthy();
  expect(within(figure).queryByRole("button", { name: "Since tracking" })).not.toBeInTheDocument();
  fireEvent.click(within(figure).getByRole("button", { name: "12 months" }));
  expect(within(figure).getByRole("button", { name: "12 months" })).toHaveAttribute("aria-pressed", "true");
});

it("supports daily keyboard inspection and draws no balance after today", async () => {
  const { card, workspace, snapshot, signedBalanceMinor, today } = laptopPlanScenario();
  const history = dailyBalanceHistory(card(), workspace(), snapshot, signedBalanceMinor, today);
  const { container } = render(<BalanceHistoryPlot history={history} limitAt={() => 5000000} />);
  const svg = container.querySelector<SVGElement>('svg[role="application"]')!;
  act(() => svg.focus());
  await waitFor(() => expect(screen.getAllByText(/^\d\d \w{3} 2026$/).length).toBeGreaterThan(0));
  const area = container.querySelector(".recharts-area-area")!;
  const pathNumbers = area.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const maxX = Math.max(...pathNumbers.filter((_, index) => index % 2 === 0));
  const todayLine = container.querySelector('.recharts-reference-line-line[stroke-dasharray="3 3"]')!;
  expect(maxX).toBeLessThanOrEqual(Number(todayLine.getAttribute("x1")) + 1);
});

it("scales the Y axis to the credit limit in 5K or 10K steps, going higher only when the balance does", () => {
  expect(axisTicks(1_451_414, 4_000_000).map((tick) => tick / 100)).toEqual([0, 10000, 20000, 30000, 40000]);
  expect(axisTicks(1_200_000, 1_500_000).map((tick) => tick / 100)).toEqual([0, 5000, 10000, 15000]);
  expect(axisTicks(4_550_000, 4_000_000).map((tick) => tick / 100)).toEqual([0, 10000, 20000, 30000, 40000, 50000]);
  // Far above the limit, the step grows with the balance: never 36 ticks of 10K.
  expect(axisTicks(34_527_244, 4_000_000).map((tick) => tick / 100)).toEqual([0, 100000, 200000, 300000, 400000]);
  expect(axisTicks(1_200_000, null).map((tick) => tick / 100)).toEqual([0, 2500, 5000, 7500, 10000, 12500]);
});

it("draws the limit as a step and shows each statement's share of the limit it had then", async () => {
  const { card, workspace, snapshot, signedBalanceMinor, today } = laptopPlanScenario();
  const changed = { ...workspace(), limitChanges: [{ cardId: card().id, effectiveDate: "2026-08-01", limitMinor: 10000000 }] };
  const { container } = render(<BalanceHistory card={{ ...card(), creditLimitMinor: 5000000 }} workspace={changed} snapshot={snapshot}
    signedBalanceMinor={signedBalanceMinor} today={today} />);
  await screen.findByLabelText(/Statement closes 10 Jul 2026/);
  // 30,000.00 on 10 Jul against the 50,000.00 limit it had then, not today's 100,000.00.
  expect(container.textContent).toContain("60% of limit");
  expect(container.textContent).toContain("Limit 50,000.00");
  expect(container.textContent).toContain("Limit 100,000.00");
});
