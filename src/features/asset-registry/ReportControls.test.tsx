import { render, screen, within } from "@testing-library/react";
import { IncomeSummary } from "./ReportControls";
import type { OperatingEntry } from "./timeline";

const entries: OperatingEntry[] = [
  { date: "2025-02-01", category: "Rent", amountMinor: 100000, income: true }, { date: "2025-06-01", category: "Repairs", amountMinor: -30000, income: false },
  { date: "2026-02-01", category: "Rent", amountMinor: 120000, income: true },
];
const tile = (name: string) => within(screen.getByLabelText("Asset income and expenses summary")).getByText(name).parentElement!;
const perf = { operatingYield: 8, gaps: [] } as never;
it("adds up only the dates it is given, and puts the net per month and a yearly rate beside it", () => {
  render(<IncomeSummary entries={entries} from="2025-01-01" to="2025-12-31" performance={perf} valueMinor={2000000} years={1} />);
  expect(tile("Income")).toHaveTextContent("1,000.00"); expect(tile("Income")).toHaveTextContent("1 transaction");
  expect(tile("Expenses")).toHaveTextContent("-300.00");
  expect(tile("Net cash flow")).toHaveTextContent("700.00"); expect(tile("Net cash flow")).toHaveTextContent("About 58.33 a month");
  expect(tile("Net yield on value")).toHaveTextContent("3.50%"); // 700.00 over a year against 20,000.00
});
it("spreads the yield on what was put in over the years, and waits for six months of history", () => {
  const { rerender } = render(<IncomeSummary entries={entries} from="2020-01-01" to="2026-01-01" performance={perf} valueMinor={2000000} years={4} />);
  expect(tile("Yearly yield on cost")).toHaveTextContent("2.00%");
  rerender(<IncomeSummary entries={entries} from="2026-01-01" to="2026-03-01" performance={perf} valueMinor={2000000} years={0.16} />);
  expect(tile("Yearly yield on cost")).toHaveTextContent("Needs six months of history");
  expect(tile("Net yield on value")).toHaveTextContent("not scaled to a year");
});
it("shows a negative yield for an asset that only costs money", () => {
  render(<IncomeSummary entries={[{ date: "2026-01-01", category: "Insurance", amountMinor: -50000, income: false }]} from="2025-10-26" to="2026-10-26" valueMinor={1000000} years={1} />);
  expect(tile("Net yield on value")).toHaveTextContent("-5.00%");
});
