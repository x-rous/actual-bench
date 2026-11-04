import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow } from "@/lib/financial-insights/measures";
import { debtRepayments } from "@/lib/financial-insights/breakdowns";
import type { ScheduleInput } from "@/lib/financial-insights/debt";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { offeredTabs } from "../hooks/useFinancialInsights";
import type { CardCostSettings } from "../hooks/useCardCosts";
import { LoansTab } from "./LoansTab";
import { TipProvider } from "./charts/Tip";


const chk: AccountFact = { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false };
const visa: AccountFact = { id: "visa", name: "Visa", accountClass: "credit-card", treatment: null, offBudget: false };
const mortgage: AccountFact = { id: "mortgage", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true };
const car: AccountFact = { id: "car", name: "Car loan", accountClass: "loan", treatment: null, offBudget: true };
const row = (month: string, accountId: string, amountMinor: number, extra: Partial<MovementRow> = {}): MovementRow => ({ month, accountId, categoryId: null, transferAccountId: null, amountMinor, count: 1, ...extra });
const pay = (month: string, to: string, amount: number): MovementRow[] => [row(month, "chk", -amount, { transferAccountId: to }), row(month, to, amount, { transferAccountId: "chk" })];
jest.mock("../hooks/useCardCosts", () => ({ useCardCosts: jest.fn() }));
const useCardCosts = jest.requireMock("../hooks/useCardCosts").useCardCosts as jest.Mock;
const today = "2026-11-18";

function data(accounts: AccountFact[], movement: MovementRow[], schedules: ScheduleInput[] = [], tracked: string[] = []) {
  const f: FinancialFacts = {
    accounts, incomeCategories: new Set(), movement, excluded: new Set(), uncategorizedIn: [], reclassified: [], loanCosts: [],
    startingBalances: [{ month: "2026-01", accountId: "mortgage", amountMinor: -500_000 }, { month: "2026-01", accountId: "car", amountMinor: -90_000 }],
    transfersIn: movement.filter((r) => r.transferAccountId && r.amountMinor > 0).map((r) => ({ month: r.month, accountId: r.accountId, amountMinor: r.amountMinor, transferAccountId: r.transferAccountId! })),
  };
  const ledger = buildLedger(f);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-10" }, today, ledger.firstMonth);
  const summary = summarize(ledger, period, { unavailableReason: null, rowCount: 0 });
  return { ledger, period, summary, schedules, debt: debtRepayments(ledger, period, new Set(tracked), 0) } as never;
}
/** The account table starts closed, at the bottom of the page. */
const expandTable = () => fireEvent.click(screen.getByRole("button", { name: "Expand What you owe, account by account" }));
const show = (d: never, onDrill = jest.fn(), onOpenAssets?: () => void) => render(<TipProvider><LoansTab data={d} today={today} onDrill={onDrill} onOpenAssets={onOpenAssets} /></TipProvider>);
const base = [row("2026-01", "chk", 900_000), ...pay("2026-09", "mortgage", 40_000), ...pay("2026-10", "car", 10_000), row("2026-10", "visa", -30_000)];
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); useCardCosts.mockReturnValue({ state: "ready", cards: [] } satisfies CardCostSettings); });

describe("Loans & cards tab states", () => {
  it("lists loans, cards and other liabilities, with a loan to review and one not scheduled, and no statement column", () => {
    show(data([chk, visa, mortgage, car], base, [{ accountId: "mortgage", state: "unavailable", reason: "Its schedule does not agree with the loan account in Actual; review it in Loans" }]));
    expandTable();
    const table = screen.getByRole("region", { name: "What you owe, account by account" });
    expect(within(table).getByRole("link", { name: "Review in Loans" })).toHaveAttribute("title", expect.stringContaining("does not agree"));
    expect(within(table).getByText("Not scheduled")).toBeInTheDocument();
    expect(within(table).queryByText(/statement/i)).not.toBeInTheDocument();
    const upcoming = screen.getByLabelText("Next 12 months, from the saved loan schedules");
    expect(upcoming).toHaveTextContent("Not scheduled: a loan needs review in Loans");
  });

  it("shows a tracked loan's next 12 months in the Loan repayments card, from the saved loan schedules and without cards and other liabilities", () => {
    show(data([chk, visa, mortgage, car], base, [{ accountId: "mortgage", state: "ready", principalNext12Minor: 120_000, costNext12Minor: 30_000 }], ["mortgage"]));
    expandTable();
    const table = screen.getByRole("region", { name: "What you owe, account by account" });
    expect(within(within(table).getByRole("row", { name: /^Mortgage/ })).getByText("1,200.00")).toBeInTheDocument();
    const upcoming = within(screen.getByRole("region", { name: "Loan repayments" })).getByLabelText("Next 12 months, from the saved loan schedules");
    expect(upcoming).toHaveTextContent("Principal due1,200.00");
    expect(upcoming).toHaveTextContent("Interest & fees due300.00");
    expect(upcoming).toHaveTextContent("1 of 2 loans scheduled; credit cards and other liabilities are excluded");
    // The loan figures are no longer tiles.
    expect(screen.queryByText("Loan principal due in 12 months")).not.toBeInTheDocument();
  });

  it("always draws the same four tiles: what you owe and the three groups, with None for a group the budget does not have", () => {
    show(data([chk, visa], [row("2026-10", "visa", -30_000)]));
    for (const label of ["You owe", "Loans", "Credit cards", "Other liabilities"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText("Loans").parentElement).toHaveTextContent("None");
    expect(screen.getByText("Loans").parentElement).toHaveTextContent("No loan accounts");
    expect(screen.getByText("Other liabilities").parentElement).toHaveTextContent("None");
    expect(screen.getAllByText("Credit cards")[0].parentElement).toHaveTextContent("300.00");
    expect(screen.getAllByText("Credit cards")[0].parentElement).toHaveTextContent("100% of what you owe");
  });

  it("draws the credit card charts only when there is a card, and the loan cards only when there is a loan", () => {
    const { unmount } = show(data([chk, visa], [row("2026-10", "visa", -30_000)]));
    expect(screen.getByRole("region", { name: "What you owe on credit cards" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Interest & fees on credit cards" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Loan repayments" })).not.toBeInTheDocument();
    unmount();
    show(data([chk, mortgage], base));
    expect(screen.getByRole("region", { name: "Loan repayments" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "What you owe on credit cards" })).not.toBeInTheDocument();
  });

  it("draws the interest and fees of cards that have the categories set, names the cards that do not, and drills by category", () => {
    useCardCosts.mockReturnValue({ state: "ready", cards: [{ accountId: "visa", interestCategoryId: "int", feeCategoryId: "fee" }] } satisfies CardCostSettings);
    const onDrill = jest.fn();
    show(data([chk, visa, { id: "amex", name: "Amex", accountClass: "credit-card", treatment: null, offBudget: false }], [row("2026-10", "visa", -1_000, { categoryId: "int" }), row("2026-10", "visa", -250, { categoryId: "fee" })]), onDrill);
    const card = screen.getByRole("region", { name: "Interest & fees on credit cards" });
    expect(within(card).getByRole("group", { name: "Interest and fees charged to credit cards in each month" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Not identified, because no interest or fee category is set in Credit Cards: Amex.");
  });

  it("says why there is nothing to draw: settings not read, no category set, or nothing charged", () => {
    useCardCosts.mockReturnValue({ state: "unavailable" } satisfies CardCostSettings);
    const { unmount } = show(data([chk, visa], [row("2026-10", "visa", -30_000)]));
    expect(screen.getByRole("region", { name: "Interest & fees on credit cards" })).toHaveTextContent("Unavailable: the card settings could not be read");
    unmount();
    useCardCosts.mockReturnValue({ state: "ready", cards: [] } satisfies CardCostSettings);
    const second = show(data([chk, visa], [row("2026-10", "visa", -30_000)]));
    expect(screen.getByRole("link", { name: "Open Credit Cards" })).toHaveAttribute("href", "/credit-cards");
    second.unmount();
    useCardCosts.mockReturnValue({ state: "ready", cards: [{ accountId: "visa", interestCategoryId: "int", feeCategoryId: null }] } satisfies CardCostSettings);
    show(data([chk, visa], [row("2026-10", "visa", -30_000)]));
    expect(screen.getByRole("region", { name: "Interest & fees on credit cards" })).toHaveTextContent("No interest or fees were charged");
  });

  it("collapses and expands each group, and links the Credit cards group to the Credit Cards workspace", () => {
    show(data([chk, visa, mortgage, car], base));
    expandTable();
    const table = screen.getByRole("region", { name: "What you owe, account by account" });
    expect(within(table).getByRole("link", { name: "View credit cards" })).toHaveAttribute("href", "/credit-cards");
    expect(within(table).getByRole("row", { name: /^Visa/ })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Collapse Credit cards" }));
    expect(within(table).queryByRole("row", { name: /^Visa/ })).not.toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /^Mortgage/ })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Expand Credit cards" }));
    expect(within(table).getByRole("row", { name: /^Visa/ })).toBeInTheDocument();
  });

  it("lists what you owe by group in a legend and a share per account, and keeps the card balances", () => {
    show(data([chk, visa, mortgage, car], base));
    expandTable();
    const table = screen.getByRole("region", { name: "What you owe, account by account" });
    expect(within(table).getByRole("list", { name: "What you owe by group" })).toHaveTextContent(/Loans.*Credit cards/);
    expect(within(table).queryByRole("img")).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Share" })).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /^Visa/ })).getByText("300.00")).toBeInTheDocument();
  });

  it("opens the transactions behind principal repaid, and marks an untracked loan's interest and fees as not identified", () => {
    const onDrill = jest.fn();
    show(data([chk, mortgage, car], base), onDrill);
    expandTable();
    fireEvent.click(screen.getByRole("button", { name: /^Mortgage principal repaid 400\.00/ }));
    expect(onDrill).toHaveBeenCalledWith({ kind: "loanPrincipal", accountId: "mortgage" });
    expect(screen.getAllByText(/not identified/i).length).toBeGreaterThan(0);
  });

  it("points to Property & assets for equity when that tab exists", () => {
    const onOpenAssets = jest.fn();
    show(data([chk, mortgage], base), jest.fn(), onOpenAssets);
    fireEvent.click(screen.getByRole("button", { name: "Property & assets" }));
    expect(onOpenAssets).toHaveBeenCalled();
  });
});

describe("offered tabs for debt", () => {
  const names = (accounts: AccountFact[]) => offeredTabs(accounts, false).map((t) => t.value);
  it("offers Loans & cards only when the budget holds a loan, card or other-liability account", () => {
    expect(names([chk])).not.toContain("loans");
    expect(names([chk, visa])).toContain("loans");
    expect(names([chk, mortgage])).toContain("loans");
    expect(names([chk, { id: "tax", name: "Tax", accountClass: "other-liability", treatment: "current-liability", offBudget: true }])).toContain("loans");
    expect(names([chk, visa]).slice(-1)).toEqual(["loans"]);
  });
});

describe("Loans & cards by month, quarter or year", () => {
  const pills = (name: string) => within(screen.getByRole("group", { name }));

  it("offers the buttons on each month-by-month chart, and they work independently", () => {
    show(data([chk, visa, mortgage], base));
    for (const name of ["Show loan payments by", "Show card balances by", "Show interest and fees by"]) expect(screen.getByRole("group", { name })).toBeInTheDocument();
    fireEvent.click(pills("Show card balances by").getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("group", { name: "What you owe on each credit card at every year end" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Principal, interest and fees paid into loans in each month/ })).toBeInTheDocument();
  });

  it("adds up loan payments by quarter and opens the transactions of the whole quarter", () => {
    const onDrill = jest.fn();
    show(data([chk, visa, mortgage], [...base, ...pay("2026-07", "mortgage", 20_000)]), onDrill);
    fireEvent.click(pills("Show loan payments by").getByRole("button", { name: "Quarterly" }));
    expect(screen.getByRole("group", { name: /Principal, interest and fees paid into loans in each quarter/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What your loan payments did" })).toHaveTextContent("Q3 2026");
  });

  it("regroups interest and fees, keeping the drill to the cards' own categories", () => {
    useCardCosts.mockReturnValue({ state: "ready", cards: [{ accountId: "visa", interestCategoryId: "int", feeCategoryId: null }] } satisfies CardCostSettings);
    show(data([chk, visa, mortgage], [...base, row("2026-09", "visa", -1_500, { categoryId: "int" })]));
    fireEvent.click(pills("Show interest and fees by").getByRole("button", { name: "Quarterly" }));
    expect(screen.getByRole("region", { name: "Interest & fees on credit cards" })).toHaveTextContent("Charged in each quarter");
  });
});

describe("the Loans & cards interest and fees tile", () => {
  it("is the fifth tile, says None without a loan or card, and flags loans not tracked", () => {
    const { unmount } = show(data([chk, mortgage], base));
    expect(screen.getByText("Interest & fees paid")).toBeInTheDocument();
    expect(screen.getByText("Interest & fees paid").closest("div")).toHaveTextContent("Some are not included");
    unmount();
    show(data([chk], [row("2026-01", "chk", 100)]));
    expect(screen.getByText("Interest & fees paid").closest("div")).toHaveTextContent("None");
  });

  it("adds the card interest and fees where the categories are set", () => {
    useCardCosts.mockReturnValue({ state: "ready", cards: [{ accountId: "visa", interestCategoryId: "int", feeCategoryId: null }] } satisfies CardCostSettings);
    show(data([chk, visa], [...base, row("2026-09", "visa", -1_500, { categoryId: "int" })]));
    expect(screen.getByText("Interest & fees paid").closest("div")).toHaveTextContent("cards 15.00");
  });
});

describe("the account table", () => {
  it("is the last card on the page and starts collapsed, with only its title showing", () => {
    show(data([chk, visa, mortgage], base));
    const table = screen.getByRole("region", { name: "What you owe, account by account" });
    expect(within(table).queryByRole("table")).not.toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Expand What you owe, account by account" })).toHaveAttribute("aria-expanded", "false");
    const regions = screen.getAllByRole("region");
    expect(regions[regions.length - 1]).toBe(table);
    fireEvent.click(within(table).getByRole("button", { name: "Expand What you owe, account by account" }));
    expect(within(table).getByRole("table")).toBeInTheDocument();
  });
});
