import { PortfolioOverview } from "./PortfolioOverview";
import { ActivityTable } from "./ActivityTable";
import { HowToUse } from "./HowToUse";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { transferPlanScenario } from "../lib/planTracking.fixture";
import { CardOverview } from "./CardOverview";
import { DebtHistory } from "./DebtHistory";
import { statementScenario } from "../lib/statementScenarios.fixture";
import type { Card, Statement, Workspace } from "../lib/models";
import { settlements } from "../lib/repayments";
import type { ActivitySnapshot } from "../lib/activity";

jest.mock("./HistoryChart", () => ({ HistoryChart: ({ title }: { title: string }) => <figure aria-label={title}><figcaption>{title}</figcaption></figure> }));

const noop = () => {};
function overview(kind: "full" | "late") {
  const scenario = statementScenario(kind);
  const bank = scenario.rows.toSorted((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  return { ...scenario, bank, payment: scenario.statuses.find((entry) => entry.statementId === bank.id)! };
}

it("separates a verified overdue obligation from total owed and shows recent statement timing", () => {
  const { card, workspace, snapshot, bank, payment } = overview("late");
  const onStatements = jest.fn(), onPayments = jest.fn(), onPayment = jest.fn();
  render(<CardOverview onStatements={onStatements} onPayments={onPayments} onPayment={onPayment} budget="scenarios" card={card} workspace={workspace} snapshot={snapshot} bank={bank} payment={payment} balance={{ signedBalanceMinor: -123000, debtMinor: 123000, creditMinor: 0 }} today="2026-10-15" available onSettings={noop} />);
  const obligation = screen.getByRole("region", { name: "Statement and payment" });
  expect(within(obligation).getByText("Verified")).toBeVisible();
  expect(within(obligation).getByText("To pay").parentElement?.nextElementSibling).toHaveTextContent("1,110.00");
  expect(within(obligation).getByText("Minimum overdue")).toBeVisible();
  expect(within(obligation).queryByText(/^Pay .* by /)).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Total owed" })).getByText("Total owed").nextElementSibling).toHaveTextContent("1,230.00");
  expect(within(screen.getByRole("region", { name: "Recent statements" })).getAllByTitle(/ Due /).filter((element) => element.tagName === "SPAN")).toHaveLength(5);
  expect(screen.queryByText("New activity")).not.toBeInTheDocument();
  const recentPayments = screen.getByRole("region", { name: "Recent payments" });
  expect(within(recentPayments).getAllByRole("listitem")).toHaveLength(5);
  expect(within(recentPayments).getAllByRole("listitem")[0]).toHaveTextContent("04 Sep 2026");
  fireEvent.click(within(recentPayments).getAllByRole("button", { name: /View payment details/ })[0]);
  expect(onPayment).toHaveBeenCalledWith("late-payment-10");
  fireEvent.click(within(recentPayments).getByRole("button", { name: "View all payments" }));
  expect(onPayments).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByRole("region", { name: "Recent statements" })).getByRole("button", { name: "30 Sep 2026" }));
  expect(onStatements).toHaveBeenCalledWith(bank.id);
});

it("keeps the payment target and minimum outstanding when credits clear the recorded debt", () => {
  const { card, workspace, snapshot, bank, payment } = overview("late");
  const credited = { ...payment, fullRemainingMinor: 0, minimumRemainingMinor: bank.minimumDueMinor, confirmedPaidMinor: 0, confirmedCreditMinor: bank.officialBalanceMinor };
  render(<CardOverview budget="scenarios" card={card} workspace={workspace} snapshot={snapshot} bank={bank} payment={credited} today="2026-10-15" available onSettings={noop} />);
  const obligation = screen.getByRole("region", { name: "Statement and payment" });
  expect(within(obligation).getByText("Minimum to pay").nextElementSibling).toHaveTextContent("25.00");
  expect(within(obligation).getByText("To pay").parentElement?.nextElementSibling).toHaveTextContent("1,110.00");
  expect(within(obligation).getByText("Minimum overdue")).toBeVisible();
  expect(within(obligation).queryByText("Minimum covered")).not.toBeInTheDocument();
});

it("shows a carried balance without overdue minimum emphasis and exposes repayment details in a popover", async () => {
  const { card, workspace, snapshot, statuses } = statementScenario("carry");
  const bank = workspace.statements.toSorted((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  const payment = statuses.find((entry) => entry.statementId === bank.id)!;
  render(<CardOverview budget="scenarios" card={card} workspace={workspace} snapshot={snapshot} bank={bank} payment={payment} today="2026-10-15" available onSettings={noop} />);
  const obligation = screen.getByRole("region", { name: "Statement and payment" });
  expect(within(obligation).getByRole("heading", { name: "To pay" })).toBeVisible();
  expect(within(obligation).getByText("Minimum paid · carried")).toBeVisible();
  expect(within(obligation).queryByText(/days overdue/)).not.toBeInTheDocument();
  expect(within(obligation).getByText(/Due 01 Oct 2026/)).not.toHaveClass("text-destructive");
  expect(within(obligation).getByText("Repaid").nextElementSibling).toHaveTextContent("200.00");
  expect(obligation.querySelector("details")).toBeNull();
  const trigger = within(obligation).getByRole("button", { name: "Payment breakdown" });
  fireEvent.click(trigger);
  const breakdown = screen.getByRole("dialog", { name: "Payment breakdown" });
  expect(obligation).not.toContainElement(breakdown);
  expect(within(breakdown).getByText("Repaid").nextElementSibling).toHaveTextContent("200.00");
  await waitFor(() => expect(within(breakdown).getByText("Statement balance")).toBeVisible());
  fireEvent.keyDown(breakdown, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Payment breakdown" })).not.toBeInTheDocument());
});

it.each([true, false])("keeps refunds separate from repayments and minimum payments (cleared: %s)", (cleared) => {
  const scenario = overview("full");
  const bank: Statement = { ...scenario.bank, officialBalanceMinor: 200000, totalPaymentDueMinor: undefined, minimumDueMinor: 10000 };
  const workspace = { ...scenario.workspace, statements: scenario.workspace.statements.map((entry) => entry.id === bank.id ? bank : entry) };
  const template = scenario.snapshot.rows[0];
  const snapshot: ActivitySnapshot = { ...scenario.snapshot, rows: [
    { ...template, id: "new-purchase", date: "2026-10-08", amountMinor: -8000, transferId: null, cleared: true, fingerprint: "new-purchase" },
    { ...template, id: "refund-only", date: "2026-10-09", amountMinor: 2000, label: "Merchant refund", transferId: null, cleared, fingerprint: "refund-only" },
  ] };
  const view = (target = bank, source = snapshot, debtMinor = 206000) => {
    const current = { ...workspace, statements: workspace.statements.map((entry) => entry.id === bank.id ? target : entry) };
    const payment = settlements(scenario.card, current, source, "2026-10-15").find((entry) => entry.statementId === bank.id)!;
    return <CardOverview budget="scenarios" card={scenario.card} bank={target} payment={payment} workspace={current} snapshot={source} balance={{ signedBalanceMinor: -debtMinor, debtMinor, creditMinor: 0 }} today="2026-10-15" available onSettings={noop} />;
  };
  const { rerender } = render(view());
  const summary = screen.getByRole("region", { name: "Statement and payment" });
  const toPay = () => within(summary).getByRole("heading", { name: "To pay" }).parentElement?.nextElementSibling;
  const owed = () => within(screen.getByRole("region", { name: "Total owed" })).getByText("Total owed").nextElementSibling;
  expect(toPay()).toHaveTextContent("2,000.00");
  expect(owed()).toHaveTextContent("2,060.00");
  expect(within(summary).getByText("Repaid").nextElementSibling).toHaveTextContent("0.00");
  expect(within(summary).queryByText("Credits 20.00")).not.toBeInTheDocument();
  expect(within(summary).queryByText("20.00 credits pending")).not.toBeInTheDocument();
  expect(within(summary).getByText("Minimum to pay").nextElementSibling).toHaveTextContent("100.00");
  expect(within(summary).getByRole("progressbar", { name: "Payment target coverage" })).toHaveAttribute("aria-valuenow", "0");

  // A bank-revised target is used once: the refund is not deducted again.
  rerender(view({ ...bank, totalPaymentDueMinor: 198000 }));
  expect(toPay()).toHaveTextContent("1,980.00");
  expect(owed()).toHaveTextContent("2,060.00");

  const paidSource = { ...snapshot, rows: [...snapshot.rows, { ...template, id: "actual-payment", fingerprint: "actual-payment", date: "2026-10-10", amountMinor: 200000, cleared: true, transferId: "payment-peer" }] };
  rerender(view(bank, paidSource, 6000));
  expect(toPay()).toHaveTextContent("0.00");
  expect(owed()).toHaveTextContent("60.00");
  expect(within(summary).getByText("Repaid").nextElementSibling).toHaveTextContent("2,000.00");
  expect(within(summary).getByRole("progressbar", { name: "Payment target coverage" })).toHaveAttribute("aria-valuenow", "100");
});

it("compacts known-zero historical interest, keeps exact history available and links statements", () => {
  const { card, workspace, snapshot } = statementScenario("full");
  const onStatement = jest.fn();
  render(<DebtHistory card={{ ...card, minimumPercentBps: 500, minimumFloorMinor: 10000 }} workspace={workspace} snapshot={snapshot} today="2026-10-15" debtMinor={12000} available onSettings={noop} onStatement={onStatement} />);
  expect(screen.queryByText("Cumulative interest charged: 0.00")).not.toBeInTheDocument();
  expect(screen.queryByText("Interest and repayments")).not.toBeInTheDocument();
  expect(screen.queryByRole("figure", { name: "Cumulative interest charged" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show zero-interest chart" })).not.toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Actual statement debt history" });
  fireEvent.click(within(table).getByRole("button", { name: "30 Sep 2026" }));
  expect(onStatement).toHaveBeenCalledWith(workspace.statements.find((entry) => entry.closingDate === "2026-09-30")!.id);
  const simulation = screen.getByRole("button", { name: "What if I only pay the minimum?" });
  expect(simulation).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(simulation);
  expect(screen.getByText(/not a bank payoff quote/)).toBeVisible();
  expect(screen.getByText("Future interest with minimums")).toBeVisible();
  expect(screen.queryByText("Future interest if paid in full now")).not.toBeInTheDocument();
});

it("uses default classifications without requiring category mappings", () => {
  const scenario = statementScenario("full");
  const card: Card = { ...scenario.card, interestCategoryId: null, feeCategoryId: null };
  const workspace: Workspace = { ...scenario.workspace, cards: [card], classifications: [] };
  render(<DebtHistory card={card} workspace={workspace} snapshot={scenario.snapshot} today="2026-10-15" available onSettings={noop} />);
  expect(screen.getByText("Interest charged").nextElementSibling).toHaveTextContent("0.00");
  expect(screen.getByText("Fees charged").nextElementSibling).toHaveTextContent("0.00");
  expect(screen.queryByText(/Unknown charges are not zero/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show zero-interest chart" })).not.toBeInTheDocument();
});


it("keeps a useful overview without plans and omits the settlement streak", () => {
  const { card, workspace, snapshot, bank, payment } = overview("full");
  render(<CardOverview budget="scenarios" card={card} workspace={workspace} snapshot={snapshot} bank={bank} payment={payment} today="2026-10-15" available onSettings={noop} />);
  expect(screen.queryByText(/Full balance settled by the due date/)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Repayment plans" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Recent statements" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Recent payments" }).parentElement).toBe(screen.getByRole("region", { name: "Card terms" }).parentElement);
  expect(screen.getByRole("region", { name: "Current balance and activity" })).toBeVisible();
  const terms = screen.getByRole("region", { name: "Card terms" });
  expect(within(terms).getByText("Auto-pay")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Add plan" })).not.toBeInTheDocument();
  expect(screen.queryByText("Billed balances and payment timing")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Review statement" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Review repayments" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit bank values" })).not.toBeInTheDocument();
});


it("shows full assigned plan debt separately from the billed statement and withholds stale tracking totals", () => {
  const { cards, sources, workspace } = transferPlanScenario();
  const card = { ...cards[0], creditLimitMinor: 5000000 };
  const props = { budget: "test", card, workspace, snapshot: sources[0], bank: workspace.statements[4], balance: { signedBalanceMinor: -450000, debtMinor: 450000, creditMinor: 0 }, today: "2026-10-16", available: true, onSettings: noop };
  const { rerender } = render(<CardOverview {...props} />);
  const panel = screen.getByRole("region", { name: "Total owed" });
  expect(screen.getByRole("region", { name: "Card terms" }).compareDocumentPosition(screen.getByRole("region", { name: "Repayment plans" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(panel).getByText("Total owed").nextElementSibling).toHaveTextContent("14,500.00");
  const activitySummary = screen.getByRole("region", { name: "Current balance and activity" });
  const pending = within(activitySummary).getByText("1 uncleared transaction included.");
  expect(pending).toBeVisible();
  expect(within(activitySummary).getByLabelText("Net activity").parentElement).toContainElement(within(activitySummary).getByRole("button", { name: "View contributing transactions" }));
  expect(activitySummary).not.toHaveTextContent("Couldn’t load complete activity");
  fireEvent.click(screen.getByRole("button", { name: "View contributing transactions" }));
  const activity = screen.getByRole("region", { name: "Contributing activity" });
  expect(screen.getByRole("region", { name: "Current balance and activity" }).parentElement!.nextElementSibling).toBe(activity);
  expect(within(panel).getByText("On card").nextElementSibling).toHaveTextContent("4,500.00");
  expect(within(panel).getByText("In plan account").nextElementSibling).toHaveTextContent("10,000.00");
  expect(within(panel).queryByText("Other balance in shared plan account")).not.toBeInTheDocument();
  expect(within(panel).getByText(/Before pending activity/)).toHaveTextContent("15,500.00");
  const credit = screen.getByRole("region", { name: "Credit used" });
  expect(within(credit).getByText("Available").nextElementSibling).toHaveTextContent("34,500.00");
  expect(within(credit).getByText("Limit").nextElementSibling).toHaveTextContent("50,000.00");
  expect(within(credit).getByText("1,000.00 pending credits not yet available.")).toBeVisible();
  rerender(<CardOverview {...props} snapshot={{ ...sources[0], trackingAccounts: [] }} />);
  expect(within(panel).getByText("Total owed").nextElementSibling).toHaveTextContent("-");
  expect(within(credit).getByText("Available").nextElementSibling).toHaveTextContent("-");
});

it("explains the monthly target and optional tags through accessible help tabs and real actions", () => {
  const onSetup = jest.fn(), onStatements = jest.fn(), onPlans = jest.fn();
  render(<HowToUse onSetup={onSetup} onStatements={onStatements} onPlans={onPlans} />);
  fireEvent.click(screen.getByRole("button", { name: "How to use" }));
  const help = screen.getByRole("dialog", { name: "Credit cards, simply" });
  expect(within(help).getByRole("tab", { name: "Get started" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(within(help).getByRole("tab", { name: "Statements & payments" }));
  expect(within(help).getByText("Total Payment Due")).toBeVisible();
  fireEvent.click(within(help).getByRole("tab", { name: "Linking & tags" }));
  expect(within(help).getByText(/Tags are optional/)).toBeVisible();
  fireEvent.click(within(help).getByRole("button", { name: "Open plan linking" }));
  expect(onPlans).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows searchable categories and plan roles without treating plan amounts as transaction debt", () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const snapshot = { ...sources[0], accounts: [...sources[0].accounts!, { id: "funding", name: "Funding", offBudget: false }, { id: "card-a", name: "Card A", offBudget: false }], rows: sources[0].rows.map((row) => row.id === "purchase-a" ? { ...row, categoryId: "equipment", categoryName: "Equipment" } : row) };
  const reviewed = { ...workspace, plans: workspace.plans!.map((plan) => ({ ...plan, reference: plan.id === "a" ? "Laptop" : "Other card plan" })) };
  render(<ActivityTable budget="test" card={cards[0]} workspace={reviewed} snapshot={snapshot} available onMappings={noop} />);
  const table = screen.getByRole("table", { name: "Actual card activity classification" });
  expect(within(table).getByRole("columnheader", { name: "Category" })).toBeVisible();
  expect(within(table).getByRole("columnheader", { name: "Plan" })).toBeVisible();
  const firstRow = () => within(table).getAllByRole("row")[1];
  expect(within(table).getByRole("columnheader", { name: "Date" })).toHaveAttribute("aria-sort", "descending");
  expect(within(firstRow()).getByRole("checkbox", { name: "Select activity pending" })).toBeVisible();
  fireEvent.click(within(table).getByRole("button", { name: "Sort by Amount" }));
  expect(within(firstRow()).getByRole("checkbox", { name: "Select activity purchase-a" })).toBeVisible();
  fireEvent.click(within(table).getByRole("button", { name: "Sort by Amount, ascending" }));
  expect(within(firstRow()).getByRole("checkbox", { name: "Select activity conversion-a" })).toBeVisible();
  const original = within(table).getByText("purchase-a").closest("tr")!;
  expect(within(original).getByText("Equipment")).toBeVisible();
  expect(within(original).getByText("Laptop · Original")).toBeVisible();
  const cash = within(table).getByText("cash-a-10").closest("tr")!;
  expect(within(cash).getByText("Transfer")).toBeVisible();
  expect(within(cash).queryByText(/Laptop/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search activity classification" }), { target: { value: "Instalment 3/6" } });
  expect(within(table).getByText("instalment-a-9")).toBeVisible();
  expect(within(table).queryByText("purchase-a")).not.toBeInTheDocument();
  expect(within(table).queryByText(/Other card plan/)).not.toBeInTheDocument();
});

it("shows upcoming monthly targets separately from overdue amounts, pending-safe capacity in one six-metric summary", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-16T12:00:00Z"));
  try {
    const fixture = transferPlanScenario();
    const cards = fixture.cards.map((card) => ({ ...card, creditLimitMinor: card.id === "a" ? 5000000 : 2000000, interestCategoryId: "interest", feeCategoryId: "fees" }));
    const statements = fixture.workspace.statements.map((statement) => statement.id === "s-a-4" ? { ...statement, totalPaymentDueMinor: 200000, dueDate: "2026-10-23" } : statement.id === "s-b-4" ? { ...statement, dueDate: "2026-10-15" } : statement);
    const template = fixture.sources[0].rows.find((row) => row.id === "ordinary")!;
    const sources = fixture.sources.map((source, index) => index ? source : { ...source, rows: [...source.rows,
      { ...template, id: "month-interest", fingerprint: "month-interest", date: "2026-10-12", amountMinor: -1000, categoryId: "interest" },
      { ...template, id: "month-fee", fingerprint: "month-fee", date: "2026-10-12", amountMinor: -500, categoryId: "fees" },
      { ...template, id: "month-fee-refund", fingerprint: "month-fee-refund", date: "2026-10-13", amountMinor: 200, categoryId: "fees" },
      { ...template, id: "pending-fee", fingerprint: "pending-fee", date: "2026-10-14", amountMinor: -900, categoryId: "fees", cleared: false },
      { ...template, id: "future-fee", fingerprint: "future-fee", date: "2026-10-20", amountMinor: -900, categoryId: "fees" },
    ] });
    const workspace = { ...fixture.workspace, cards, statements };
    const balances = new Map([["card-a", { signedBalanceMinor: -450000, debtMinor: 450000, creditMinor: 0 }], ["card-b", { signedBalanceMinor: -200000, debtMinor: 200000, creditMinor: 0 }]]);
    const props = { workspace, balances, sources, trendStatements: statements, onOpen: noop, onReview: noop };
    const view = render(<PortfolioOverview {...props} />);
    const value = (label: string) => screen.getByText(label).nextElementSibling!;
    expect(value("Due in the next 7 days")).toHaveTextContent("2,000.00");
    expect(screen.getByText("Overdue 2,000.00")).toBeVisible();
    expect(value("Available credit")).toHaveTextContent("48,500.00");
    expect(screen.queryByText("Interest and fees this month")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Portfolio summary").querySelectorAll(":scope > div")).toHaveLength(6);
    // The seventh-day boundary is included; the next day is outside this KPI.
    view.rerender(<PortfolioOverview {...props} workspace={{ ...workspace, statements: statements.map((entry) => entry.id === "s-a-4" ? { ...entry, dueDate: "2026-10-24" } : entry) }} />);
    expect(value("Due in the next 7 days")).toHaveTextContent("0.00");
    view.rerender(<PortfolioOverview {...props} sources={[undefined, { ...sources[1], from: "2026-10-10" }]} />);
    expect(screen.queryByText("Interest and fees this month")).not.toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});

it.each([
  { mode: "end", message: "Activity loaded through 14 Oct 2026. Refresh for today." },
  { mode: "start", message: "Activity starts on 01 Oct 2026. Refresh to load the full period." },
  { mode: "issues", message: "Some transaction details are incomplete. Refresh to retry." },
])("explains $mode activity coverage without treating uncleared entries as read failures", ({ mode, message }) => {
  const { card, workspace, snapshot, bank } = overview("full");
  const source = { ...snapshot, ...(mode === "end" ? { to: "2026-10-14" } : mode === "start" ? { from: "2026-10-01" } : { issues: ["Split transaction needs its remaining child entries"] }) };
  render(<CardOverview budget="scenarios" card={card} workspace={workspace} snapshot={source} bank={bank} balance={{ signedBalanceMinor: -10000, debtMinor: 10000, creditMinor: 0 }} today="2026-10-15" available onSettings={noop} />);
  const summary = screen.getByRole("region", { name: "Current balance and activity" });
  expect(within(summary).getByRole("status")).toHaveTextContent(message);
  expect(screen.getByRole("region", { name: "Statement and payment" })).toHaveTextContent("Refresh Actual activity to update payments");
  expect(screen.queryByText("Confirm a statement to track payments")).not.toBeInTheDocument();
  if (mode === "issues") {
    fireEvent.click(within(summary).getByRole("button", { name: "About Incomplete activity details" }));
    expect(screen.getByRole("dialog", { name: "Incomplete activity details" })).toHaveTextContent("Split transaction needs its remaining child entries");
  }
});

it("filters activity by reviewed statement inclusion and clears selections when changing bills", async () => {
  const { card, workspace, snapshot, rows: statements } = statementScenario("full");
  const statement = statements.find((entry) => entry.closingDate === "2026-07-31")!;
  const moved = snapshot.rows.find((entry) => entry.date === "2026-08-10")!;
  const excluded = snapshot.rows.find((entry) => entry.date === "2026-07-10")!;
  const cyclePayment = snapshot.rows.find((entry) => entry.date === "2026-07-01" && entry.amountMinor > 0)!;
  const reviewed: Workspace = { ...workspace, memberships: [
    ...workspace.memberships.filter((entry) => entry.transactionId !== moved.id).map((entry) => entry.statementId === statement.id && entry.transactionId === excluded.id ? { ...entry, decision: "excluded" as const } : entry),
    { statementId: statement.id, cardId: card.id, transactionId: moved.id, fingerprint: moved.fingerprint, decision: "included", provenance: "manual", reason: "Confirmed bank posting cutoff", bankPostingDate: null },
  ] };
  render(<ActivityTable budget="scenarios" card={card} workspace={reviewed} snapshot={snapshot} available onMappings={noop} />);
  const table = screen.getByRole("table", { name: "Actual card activity classification" });
  fireEvent.click(within(table).getByRole("checkbox", { name: `Select activity ${excluded.id}` }));
  const actions = screen.getByRole("region", { name: "Activity classification actions" });
  expect(actions).toBeVisible();
  expect(table.parentElement).not.toContainElement(actions);
  fireEvent.click(within(actions).getByRole("button", { name: "Clear selection" }));
  expect(screen.queryByRole("region", { name: "Activity classification actions" })).not.toBeInTheDocument();
  fireEvent.click(within(table).getByRole("checkbox", { name: `Select activity ${excluded.id}` }));
  const select = async (name: RegExp) => {
    fireEvent.click(screen.getByRole("combobox", { name: "Activity statement filter" }));
    const option = screen.getByRole("option", { name });
    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
    fireEvent.click(option, { detail: 1 });
    await screen.findByRole("combobox", { name: "Activity statement filter", expanded: false });
  };
  await select(/Statement 31 Jul 2026/);
  expect(screen.queryByRole("region", { name: "Activity classification actions" })).not.toBeInTheDocument();
  const movedRow = within(table).getByRole("checkbox", { name: `Select activity ${moved.id}` }).closest("tr")!;
  expect(within(table).getByRole("columnheader", { name: "Statement" })).toBeVisible();
  expect(within(movedRow).getByText("31 Jul 2026")).toBeVisible();
  expect(within(table).queryByRole("checkbox", { name: `Select activity ${excluded.id}` })).not.toBeInTheDocument();
  const paymentRow = within(table).getByRole("checkbox", { name: `Select activity ${cyclePayment.id}` }).closest("tr")!;
  expect(within(paymentRow).getByRole("img", { name: "Cleared" })).toBeVisible();
  expect(within(paymentRow).getByText("31 Jul 2026")).toBeVisible(); // Posted cycle, not the bill this payment settles.
  await select(/Statement 31 Aug 2026/);
  expect(within(table).queryByRole("checkbox", { name: `Select activity ${moved.id}` })).not.toBeInTheDocument();
  await select(/^All activity$/);
  const excludedRow = within(table).getByRole("checkbox", { name: `Select activity ${excluded.id}` }).closest("tr")!;
  expect(within(excludedRow).getByText("Not assigned")).toBeVisible();
  expect(within(table).getByRole("checkbox", { name: `Select activity ${moved.id}` })).toBeVisible();
});
