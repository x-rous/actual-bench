import { render, screen } from "@testing-library/react";
import { debtRepayments } from "@/lib/financial-insights/breakdowns";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { WhereMoneyWentCard } from "./WhereMoneyWentCard";
import { TipProvider } from "./charts/Tip";

const accounts: AccountFact[] = [
  { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
  { id: "visa", name: "Visa", accountClass: "credit-card", treatment: null, offBudget: false },
];
const row = (accountId: string, amountMinor: number, categoryId: string): MovementRow => ({ month: "2026-09", accountId, categoryId, transferAccountId: null, amountMinor, count: 1 });

function card(movement: MovementRow[]) {
  const facts: FinancialFacts = { accounts, incomeCategories: new Set(["salary"]), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn: [], reclassified: [], loanCosts: [] };
  const ledger = buildLedger(facts);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
  const data = { summary, debt: debtRepayments(ledger, period, new Set(), 0) } as never;
  return render(<TipProvider><WhereMoneyWentCard data={data} csvScope={[]} onDrill={jest.fn()} /></TipProvider>);
}

describe("Where your money went", () => {
  it("draws the allocation bar when every shown line is positive", () => {
    card([row("chk", 500_000, "salary"), row("chk", -100_000, "food")]);
    expect(screen.getByRole("img", { name: /^Of .* received:/ })).toBeInTheDocument();
  });

  it("leaves the bar out when a shown line is negative, and keeps the table", () => {
    // Card purchases of 1,000.00 raise what is owed on the cards, so the cards line is negative (money that came in).
    card([row("chk", 500_000, "salary"), row("visa", -100_000, "food")]);
    expect(screen.queryByRole("img", { name: /^Of .* received:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Change in card balances")).toBeInTheDocument();
  });
});
