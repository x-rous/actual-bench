import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("Where your money came from and went", () => {
  const transfer = (accountId: string, to: string, amountMinor: number): MovementRow => ({ month: "2026-09", accountId, categoryId: null, transferAccountId: to, amountMinor, count: 1 });
  const side = (name: string) => within(screen.getByRole("group", { name }));

  it("lists what came in on the left and what happened to it on the right, with the same total", () => {
    card([row("chk", 500_000, "salary"), row("chk", -100_000, "food")]);
    expect(side("Money in").getByRole("row", { name: /^Received/ })).toHaveTextContent("5,000.00");
    expect(side("Money out").getByRole("row", { name: /^Spent/ })).toHaveTextContent("1,000.00");
    expect(side("Money out").getByRole("row", { name: /^Added to cash & bank/ })).toHaveTextContent("4,000.00");
    expect(side("Money in").getByRole("row", { name: /^Total money in/ })).toHaveTextContent("5,000.00");
    expect(side("Money out").getByRole("row", { name: /^Total money out/ })).toHaveTextContent("5,000.00");
    // No word "kept", and no negative amount anywhere.
    expect(document.body.textContent ?? "").not.toMatch(/\bkept\b/i);
    expect(screen.getByRole("region", { name: "Where your money went" }).textContent ?? "").not.toMatch(/[−-]\d/);
  });

  it("puts card use on the money-in side and shows the same total on both", () => {
    // 1,000.00 spent on a card: more is owed, so that money came in without being income.
    card([row("chk", 500_000, "salary"), row("visa", -100_000, "food")]);
    expect(side("Money in").getByRole("row", { name: /^More owed on credit cards/ })).toHaveTextContent("1,000.00");
    expect(side("Money in").getByRole("row", { name: /^Total money in/ })).toHaveTextContent("6,000.00");
    expect(side("Money out").getByRole("row", { name: /^Total money out/ })).toHaveTextContent("6,000.00");
    expect(side("Money out").getByRole("row", { name: /^Spent/ })).toHaveTextContent("1,000.00");
  });

  it("opens the transactions behind Received, Spent, Debt repaid and Borrowed, and explains the lines", () => {
    const onDrill = jest.fn();
    // 5,000.00 received, 1,000.00 spent, 1,200.00 paid to the mortgage.
    card([row("chk", 500_000, "salary"), row("chk", -100_000, "food"), transfer("chk", "loan", -120_000), transfer("loan", "chk", 120_000)], onDrill, [{ month: "2026-09", accountId: "loan", transferAccountId: "chk", amountMinor: 120_000 }]);
    fireEvent.click(screen.getByRole("button", { name: /^Received .*Show the transactions/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "received" });
    fireEvent.click(screen.getByRole("button", { name: /^Spent .*Show the transactions/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "spent" });
    fireEvent.click(screen.getByRole("button", { name: /^Paid off loans \(principal\) .*Show the transactions/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "loanPrincipal" });
    for (const label of ["Received", "Spent", "Paid off loans (principal)", "Added to cash & bank"]) {
      expect(screen.getByRole("button", { name: `About ${label} in where your money went` })).toBeInTheDocument();
    }
    expect(screen.getByText(/Paying off loan principal is money out, not spending/)).toBeInTheDocument();
  });

  it("leaves a balance change as plain text: only lines with transactions behind them are links", () => {
    card([row("chk", 500_000, "salary"), row("visa", -100_000, "food")]);
    expect(screen.queryByRole("button", { name: /^More owed on credit cards .*Show the transactions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Added to cash & bank .*Show the transactions/ })).toBeNull();
  });

  it("puts money drawn from cash on the money-in side when more went out than came in", () => {
    card([row("chk", 100_000, "salary"), row("chk", -300_000, "food")]);
    expect(side("Money in").getByRole("row", { name: /^Taken from cash & bank/ })).toHaveTextContent("2,000.00");
    expect(side("Money out").getByRole("row", { name: /^Spent/ })).toHaveTextContent("3,000.00");
    expect(side("Money in").getByRole("row", { name: /^Total money in/ })).toHaveTextContent("3,000.00");
  });
});
