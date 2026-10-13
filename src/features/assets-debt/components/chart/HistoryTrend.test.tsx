import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import HistoryTrend from "./HistoryTrend";
it("exposes exact minor-unit amounts in keyboard tooltips using the loan chart styles", async () => {
  const { container } = render(<HistoryTrend title="Interest charged" points={[{ date: "2026-09-30", value: 2500 }, { date: "2026-10-31", value: 5000 }]} percent={false} tone="interest" />);
  const svg = container.querySelector<SVGElement>('svg[role="application"]')!;
  expect(svg).not.toBeNull();
  act(() => svg.focus());
  await waitFor(() => expect(screen.getByText("25.00")).toBeVisible());
  expect(screen.getByText("30 Sep 2026")).toBeVisible();
  fireEvent.keyDown(svg, { key: "ArrowRight" });
  await waitFor(() => expect(screen.getByText("50.00")).toBeVisible());
  expect(container.querySelector('.recharts-line path[stroke="var(--chart-5)"]')).not.toBeNull();
});

it("shows balance drivers and identifies the zero reference as an illustration", async () => {
  const { container } = render(<HistoryTrend title="Carried balance" points={[{ date: "2026-09-30", value: 5000, breakdown: [{ label: "Purchases this cycle", value: 3000 }, { label: "Interest charged", value: null }] }, { date: "2026-10-31", value: 6000 }]} percent={false} tone="debt" zeroReference />);
  act(() => container.querySelector<SVGElement>('svg[role="application"]')!.focus());
  await waitFor(() => expect(screen.getByText("30.00")).toBeVisible());
  expect(screen.getByText("Unavailable")).toBeVisible();
  expect(screen.getByText(/Zero reference: illustration/)).toBeVisible();
});

 it("connects historical observations with linear segments and identifies estimated sources", async () => {
  const { container } = render(<HistoryTrend title="Billed balance" points={[{ date: "2026-07-31", value: 5000, source: "Confirmed bank values" }, { date: "2026-08-31", value: null }, { date: "2026-09-30", value: 6000, source: "Includes estimates" }]} percent={false} tone="debt" discrete />);
  const path = container.querySelector('.recharts-line path[stroke-opacity="1"]');
  expect(path).not.toBeNull();
  expect(path?.getAttribute("d")?.match(/M/g)).toHaveLength(2); // Missing August splits the July/September observations.
  expect(container.querySelector('circle[fill="var(--background)"]')).not.toBeNull();
  const svg = container.querySelector<SVGElement>('svg[role="application"]')!;
  act(() => svg.focus());
  await waitFor(() => expect(screen.getByText("Confirmed bank values")).toBeVisible());
 });

 it("does not turn a missing observation into zero when a zero reference is visible", async () => {
  const { container } = render(<HistoryTrend title="Interest charged" points={[{ date: "2026-07-31", value: 5000 }, { date: "2026-08-31", value: null }, { date: "2026-09-30", value: 6000 }]} percent={false} tone="interest" discrete zeroReference />);
  const svg = container.querySelector<SVGElement>('svg[role="application"]')!;
  act(() => svg.focus());
  await waitFor(() => expect(screen.getByText("50.00")).toBeVisible());
  fireEvent.keyDown(svg, { key: "ArrowRight" });
  await waitFor(() => expect(screen.getByText("Missing evidence")).toBeVisible());
  expect(screen.getByText("31 Aug 2026")).toBeVisible();
 });
