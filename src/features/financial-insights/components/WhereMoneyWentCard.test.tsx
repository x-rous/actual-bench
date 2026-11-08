import { fireEvent, render, screen } from "@testing-library/react";
import { debtRepayments } from "@/lib/financial-insights/breakdowns";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { WhereMoneyWentCard } from "./WhereMoneyWentCard";
import { TipProvider } from "./charts/Tip";

const accounts: AccountFact[] = [
  { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
  { id: "loan", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true },
  { id: "visa", name: "Visa", accountClass: "credit-card", treatment: null, offBudget: false },
];
const row = (accountId: string, amountMinor: number, categoryId: string): MovementRow => ({ month: "2026-09", accountId, categoryId, transferAccountId: null, amountMinor, count: 1 });

function card(movement: MovementRow[], onDrill = jest.fn(), transfersIn: FinancialFacts["transfersIn"] = []) {
  const facts: FinancialFacts = { accounts, incomeCategories: new Set(["salary"]), movement, excluded: new Set(), startingBalances: [], uncategorizedIn: [], transfersIn, reclassified: [], loanCosts: [] };
  const ledger = buildLedger(facts);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, "2026-11-18", ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0, amountMinor: 0 });
  const data = { summary, debt: debtRepayments(ledger, period, new Set(), 0) } as never;
  return render(<TipProvider><WhereMoneyWentCard data={data} csvScope={[]} onDrill={onDrill} /></TipProvider>);
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

  const transfer = (accountId: string, to: string, amountMinor: number): MovementRow => ({ month: "2026-09", accountId, categoryId: null, transferAccountId: to, amountMinor, count: 1 });

  it("opens the transactions behind Spent, Debt repaid and Borrowed, and explains every line", () => {
    const onDrill = jest.fn();
    // 5,000.00 received, 1,000.00 spent, 1,200.00 paid to the mortgage.
    card([row("chk", 500_000, "salary"), row("chk", -100_000, "food"), transfer("chk", "loan", -120_000), transfer("loan", "chk", 120_000)], onDrill, [{ month: "2026-09", accountId: "loan", transferAccountId: "chk", amountMinor: 120_000 }]);
    fireEvent.click(screen.getByRole("button", { name: /^Spent .*Show the transactions/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "spent" });
    fireEvent.click(screen.getByRole("button", { name: /^Debt repaid \(principal\) .*Show the transactions/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "loanPrincipal" });
    // Every line shown has its own (i), so the card can be read without being told what the lines are.
    for (const label of ["Spent", "Debt repaid (principal)", "Change in cash & bank"]) {
      expect(screen.getByRole("button", { name: `About ${label} in where your money went` })).toBeInTheDocument();
    }
    expect(screen.getByText(/Everything you received, split into what it became/)).toBeInTheDocument();
  });

  it("leaves a balance change as plain text: only lines with transactions behind them are links", () => {
    card([row("chk", 500_000, "salary"), row("visa", -100_000, "food")]);
    expect(screen.queryByRole("button", { name: /^Change in card balances .*Show the transactions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Change in cash & bank .*Show the transactions/ })).toBeNull();
  });
});
