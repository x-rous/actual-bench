/**
 * BM-19: the Envelope grid summary is a funding bridge. Each supporting row
 * shows the positive magnitude of its term next to a + / − operator, and the
 * "=" To Budget row carries the authoritative reconciliation. These tests pin
 * both: the display magnitudes, and that operators + magnitudes reconcile to
 * the raw `toBudget` (so the bridge can never drift from the API value).
 */
import { ENVELOPE_SUMMARY_ROWS } from "./SummaryRows";
import type { BudgetMonthSummary, LoadedMonthState } from "../../types";

// Only `summary` is read by these rows; state/month are unused.
const unusedState = {} as LoadedMonthState;

function valueFor(label: string, summary: BudgetMonthSummary): number | null {
  const row = ENVELOPE_SUMMARY_ROWS.find((r) => r.label === label);
  if (!row?.getValue) throw new Error(`No getValue row for ${label}`);
  return row.getValue(summary, unusedState, summary.month);
}

const summary: BudgetMonthSummary = {
  month: "2026-06",
  // toBudget = incomeAvailable + lastMonthOverspent + totalBudgeted − forNextMonth
  //          = 1,000,000 + (−467,889) + (−400,000) − 50,000 = 82,111
  incomeAvailable: 1_000_000,
  lastMonthOverspent: -467_889,
  totalBudgeted: -400_000,
  forNextMonth: 50_000,
  toBudget: 82_111,
  fromLastMonth: 0,
  totalIncome: 0,
  totalSpent: 0,
  totalBalance: 0,
};

describe("ENVELOPE_SUMMARY_ROWS funding bridge (BM-19)", () => {
  it("shows each supporting term as a positive magnitude", () => {
    expect(valueFor("Available Funds", summary)).toBe(1_000_000);
    expect(valueFor("Overspent Last Month", summary)).toBe(467_889);
    expect(valueFor("Budgeted", summary)).toBe(400_000);
    expect(valueFor("Hold for next month", summary)).toBe(50_000);
  });

  it("reconciles the displayed magnitudes + operators to the raw toBudget", () => {
    const reconstructed =
      valueFor("Available Funds", summary)! -
      valueFor("Overspent Last Month", summary)! -
      valueFor("Budgeted", summary)! -
      valueFor("Hold for next month", summary)!;
    expect(reconstructed).toBe(summary.toBudget);
  });

  it("shows zeros (not negatives) when there is no overspending or hold", () => {
    const clean: BudgetMonthSummary = {
      ...summary,
      lastMonthOverspent: 0,
      forNextMonth: 0,
    };
    expect(valueFor("Overspent Last Month", clean)).toBe(0);
    expect(valueFor("Hold for next month", clean)).toBe(0);
  });
});
