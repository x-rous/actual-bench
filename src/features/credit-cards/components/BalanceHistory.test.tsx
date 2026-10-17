import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { dailyBalanceHistory } from "../lib/balanceHistory";
import { transferPlanScenario } from "../lib/planTracking.fixture";
import { BalanceHistory } from "./BalanceHistory";
import BalanceHistoryPlot from "@/features/assets-debt/components/chart/CreditCardBalanceHistory";

jest.mock("next/dynamic", () => ({ __esModule: true, default: () => jest.requireActual("@/features/assets-debt/components/chart/CreditCardBalanceHistory").default }));

it("shows recorded daily debt with plan principal, inferred shading guidance and actionable dates", async () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const onStatement = jest.fn(), onPayment = jest.fn();
  render(<BalanceHistory card={cards[0]} workspace={workspace} snapshot={sources[0]} signedBalanceMinor={-450000} today="2026-10-16" onStatement={onStatement} onPayment={onPayment} />);
  const figure = screen.getByRole("figure", { name: "Balance over time" });
  expect(within(figure).getByText("Average daily balance")).toBeVisible();
  expect(within(figure).getByText("Highest daily balance").parentElement).toHaveTextContent("30,050.00");
  expect(within(figure).getByText(/1 pending entry included provisionally/)).toBeVisible();
  const statement = await within(figure).findByRole("button", { name: /Statement closes 08 Jul 2026/ });
  fireEvent.keyDown(statement, { key: "Enter" });
  expect(onStatement).toHaveBeenCalledWith("s-a-1");
  const pending = within(figure).getByRole("button", { name: /Payment 15 Oct 2026.*pending/ });
  fireEvent.focus(pending);
  expect(within(figure).getByRole("tooltip")).toHaveTextContent("Payment · clearing pending");
  fireEvent.click(pending);
  expect(onPayment).toHaveBeenCalledWith("pending");
  fireEvent.click(within(figure).getByRole("button", { name: "About Balance chart interest shading" }));
  expect(screen.getByRole("dialog", { name: "Balance chart interest shading" })).toHaveTextContent("An unpaid 0% plan alone never creates yellow shading");
});

it("supports daily keyboard inspection and leaves future balances undrawn", async () => {
  const { cards, sources, workspace } = transferPlanScenario();
  const history = dailyBalanceHistory(cards[0], workspace, sources[0], -450000, "2026-10-16");
  const { container } = render(<BalanceHistoryPlot history={history} creditLimitMinor={5000000} />);
  const svg = container.querySelector<SVGElement>('svg[role="application"]')!;
  expect(svg).not.toBeNull();
  act(() => svg.focus());
  await waitFor(() => expect(screen.getByText("08 Jun 2026")).toBeVisible());
  fireEvent.keyDown(svg, { key: "ArrowRight" });
  await waitFor(() => expect(screen.getByText("09 Jun 2026")).toBeVisible());
  expect(screen.getByText("Interest state not inferred")).toBeVisible();
  // The real SVG area ends before the future due diamonds, rather than projecting a balance.
  const area = container.querySelector('.recharts-area-area')!;
  expect(area).not.toBeNull();
  const pathNumbers = area.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const maxX = Math.max(...pathNumbers.filter((_, index) => index % 2 === 0));
  const futureDue = screen.getByRole("img", { name: /Payment due 02 Dec 2026.*estimated/ }).querySelector("polygon")!;
  const diamondX = Number(futureDue.getAttribute("points")!.split(",")[0]);
  expect(maxX).toBeLessThan(diamondX);
});
