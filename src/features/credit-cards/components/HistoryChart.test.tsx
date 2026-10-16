import { act, render, screen, waitFor } from "@testing-library/react";
import { HistoryChart } from "./HistoryChart";

it("uses the loan line chart with a value axis, keeps gaps and distinguishes estimates", async () => {
  const { container } = render(<HistoryChart title="Billed balance" points={[{ date: "2026-07-31", value: 100000, source: "Confirmed bank value" }, { date: "2026-09-30", value: 120000, source: "Includes estimates" }]} />);
  await waitFor(() => expect(container.querySelector(".recharts-line-curve")).not.toBeNull());
  expect(container.querySelector(".recharts-yAxis")).not.toBeNull();
  expect(container.querySelector(".recharts-bar")).toBeNull();
  expect(container.querySelector(".recharts-line-curve")?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
  expect(container.querySelector('circle[fill="var(--background)"]')).not.toBeNull();
  expect(screen.queryByRole("button", { name: "View trend values" })).not.toBeInTheDocument();
});

it.each([12345, -12345])("renders a single signed statement (%i) as a labelled point instead of an empty state", async (value) => {
  const { container } = render(<HistoryChart title="Billed balance" points={[{ date: "2026-09-30", value }]} />);
  await waitFor(() => expect(container.querySelector(".recharts-label-list")).not.toBeNull());
  expect(container.querySelector(".recharts-label-list")).toHaveTextContent(`${value < 0 ? "-" : ""}123.45`);
  expect(container.querySelector(".recharts-line-dots circle")).not.toBeNull();
  expect(screen.queryByText(/At least two/)).not.toBeInTheDocument();
});

it("keeps monthly interest as bars with accessible exact values and partial coverage", async () => {
  const { container } = render(<HistoryChart title="Interest charged by month" monthly tone="interest" kind="bar" points={[{ date: "2026-09-01", value: 2500, source: "Observed Actual transactions; partial coverage", breakdown: [{ label: "Example card", value: 2500 }] }]} />);
  await waitFor(() => expect(container.querySelector(".recharts-bar")).not.toBeNull());
  expect(container.querySelector(".recharts-yAxis")).not.toBeNull();
  expect(container.querySelector(".recharts-line")).toBeNull();
  expect(container.querySelector('.recharts-bar path[fill="var(--background)"]')).not.toBeNull();
  act(() => container.querySelector<SVGElement>('svg[role="application"]')!.focus());
  await waitFor(() => expect(screen.getByText(/Observed Actual transactions; partial coverage/)).toBeVisible());
  expect(screen.getByText("Example card")).toBeVisible();
});

it("shows missing evidence as an empty state without drawing zero debt", () => {
  const { container } = render(<HistoryChart title="Billed balance" points={[{ date: "2026-09-30", value: null }]} />);
  expect(screen.getByText("No known values in the tracked history yet.")).toBeVisible();
  expect(container.querySelector("svg")).toBeNull();
});
