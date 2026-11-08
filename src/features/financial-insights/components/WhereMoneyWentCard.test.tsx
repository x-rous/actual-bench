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
  const transfer = (accountId: string, to: string, amountMinor: number): MovementRow => ({ month: "2026-09", accountId, categoryId: null, transferAccountId: to, amountMinor, count: 1 });
  const total = () => screen.getByRole("row", { name: /Kept \(received less spent\)/ });

  it("reads from the top: received, less spent, is what was kept, with a bar of the two", () => {
    card([row("chk", 500_000, "salary"), row("chk", -100_000, "food")]);
    const figures = screen.getByLabelText("Received, spent and kept");
    expect(figures).toHaveTextContent("Received5,000.00");
    expect(figures).toHaveTextContent("Spent · 20.0%1,000.00");
    expect(figures).toHaveTextContent("Kept · 80.0%4,000.00");
    expect(screen.getByRole("img", { name: "Of 5,000.00 received: spent 1,000.00, kept 4,000.00" })).toBeInTheDocument();
    // What was kept is cash here, so the one line under it adds up to the total.
    expect(total()).toHaveTextContent("4,000.00");
  });

  it("shows borrowing and card use as a separate section of negative lines, and the lines still add up to what was kept", () => {
    // 5,000.00 received, 1,000.00 spent on a card: the card balance rose by 1,000.00, which is money that came in without being income.
    card([row("chk", 500_000, "salary"), row("visa", -100_000, "food")]);
    expect(screen.getByText("Money that came from borrowing and cards")).toBeInTheDocument();
    expect(screen.getByText("Change in card balances")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(total()).toHaveTextContent("4,000.00");
    // The lines under the heading add to the kept amount: cash +5,000.00 and the card line −1,000.00.
    const lines = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(lines.some((t) => /Change in cash & bank\+5,000\.00/.test(t))).toBe(true);
    expect(lines.some((t) => /Change in card balances.*-1,000\.00/.test(t))).toBe(true);
  });

  it("says so, and draws no bar, when more was spent than received", () => {
    card([row("chk", 100_000, "salary"), row("chk", -300_000, "food")]);
    expect(screen.queryByRole("img", { name: /^Of .* received:/ })).not.toBeInTheDocument();
    expect(screen.getByText(/You spent more than you received/)).toBeInTheDocument();
    expect(screen.getByText("How it was covered")).toBeInTheDocument();
    expect(total()).toHaveTextContent("-2,000.00");
  });

  it("opens the transactions behind Spent, Debt repaid and Borrowed, and explains the lines", () => {
    const onDrill = jest.fn();
    // 5,000.00 received, 1,000.00 spent, 1,200.00 paid to the mortgage.
    card([row("chk", 500_000, "salary"), row("chk", -100_000, "food"), transfer("chk", "loan", -120_000), transfer("loan", "chk", 120_000)], onDrill, [{ month: "2026-09", accountId: "loan", transferAccountId: "chk", amountMinor: 120_000 }]);
    fireEvent.click(screen.getByRole("button", { name: /^Spent .*Show the transactions/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "spent" });
    fireEvent.click(screen.getByRole("button", { name: /^Debt repaid \(principal\) .*Show the transactions/ }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "loanPrincipal" });
    for (const label of ["Debt repaid (principal)", "Change in cash & bank"]) {
      expect(screen.getByRole("button", { name: `About ${label} in where your money went` })).toBeInTheDocument();
    }
    expect(screen.getByText(/Below is what the money you kept did/)).toBeInTheDocument();
  });

  it("leaves a balance change as plain text: only lines with transactions behind them are links", () => {
    card([row("chk", 500_000, "salary"), row("visa", -100_000, "food")]);
    expect(screen.queryByRole("button", { name: /^Change in card balances .*Show the transactions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Change in cash & bank .*Show the transactions/ })).toBeNull();
  });
});
