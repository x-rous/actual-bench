import { act, fireEvent, render, screen } from "@testing-library/react";
import { ActivityScreen } from "./ActivityScreen";
import { cardEntry } from "../entryKit";
import { twoYearFixture } from "../../lib/fixtures/twoYear.fixture";

/**
 * jsdom guards for the Activity tab on two years of card history (~1,500 rows). The rendered-row
 * count is the deterministic check; the coarse wall-clock budgets (single run ~0.4 s mount, ~0.2 s
 * per keystroke; was 8.0 s / 4.3 s) tolerate parallel CI load. Browser target: < 100 ms.
 */
const time = (run: () => void) => {
  const start = performance.now();
  act(run);
  const ms = performance.now() - start;
  if (process.env.CC_PERF_LOG) console.log(`${expect.getState().currentTestName}: ${ms.toFixed(1)} ms`);
  return ms;
};

it("mounts and filters two years of activity within budget, rendering only visible rows", () => {
  const { cards, snapshots, workspace } = twoYearFixture();
  expect(snapshots[0].rows.length).toBeGreaterThan(1400);
  const mount = time(() => {
    render(<ActivityScreen budget="budget" entry={cardEntry(cards[0], workspace, snapshots[0], { today: "2026-10-15" })} workspace={workspace} snapshot={snapshots[0]}
      available statementFilter={null} planFilter={null} typeFilter={null} onFilters={() => {}} onMappings={() => {}} onMakePlan={() => {}} onOpenPlan={() => {}} />);
  });
  expect(mount).toBeLessThan(3000);
  const table = screen.getByRole("table", { name: "Activity for Visa" });
  // Header plus a viewport of rows, not every transaction.
  expect(table.querySelectorAll("tbody tr[class]").length).toBeLessThan(100);
  const keystroke = time(() => {
    fireEvent.change(screen.getByRole("textbox", { name: "Search activity for Visa" }), { target: { value: "Merchant 1" } });
  });
  expect(keystroke).toBeLessThan(1500);
});
