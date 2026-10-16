import { HowToUse } from "./HowToUse";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { transferPlanScenario } from "../lib/planTracking.fixture";
import { CardOverview } from "./CardOverview";
import { DebtHistory } from "./DebtHistory";
import { statementScenario } from "../lib/statementScenarios.fixture";
import type { Card, Workspace } from "../lib/models";

jest.mock("./HistoryChart", () => ({ HistoryChart: ({ title }: { title: string }) => <figure aria-label={title}><figcaption>{title}</figcaption></figure> }));

const noop = () => {};
function overview(kind: "full" | "late") {
  const scenario = statementScenario(kind);
  const bank = scenario.rows.toSorted((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  return { ...scenario, bank, payment: scenario.statuses.find((entry) => entry.statementId === bank.id)! };
}

it("separates a verified overdue obligation from current debt and preserves timing rails", () => {
  const { card, workspace, snapshot, bank, payment, statuses } = overview("late");
  render(<CardOverview budget="scenarios" card={card} workspace={workspace} snapshot={snapshot} bank={bank} payment={payment} statuses={statuses} balance={{ signedBalanceMinor: -123000, debtMinor: 123000, creditMinor: 0 }} today="2026-10-15" available onStatement={noop} onSettings={noop} onPayments={noop} onReview={noop} />);
  const obligation = screen.getByRole("region", { name: "Statement and payment" });
  expect(within(obligation).getByText("Verified")).toBeVisible();
  expect(within(obligation).getByText("Payment remaining · late").nextElementSibling).toHaveTextContent("1,110.00");
  expect(within(obligation).getByText("Minimum overdue")).toBeVisible();
  expect(within(obligation).queryByText(/^Pay .* by /)).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Current balance and activity" })).getByText("Total debt").nextElementSibling).toHaveTextContent("1,230.00");
  expect(within(screen.getByRole("region", { name: "Recent statements" })).getAllByTitle(/ Due /).filter((element) => element.tagName === "SPAN")).toHaveLength(5);
});

it("leads with the outstanding minimum when credits cover the full balance", () => {
  const { card, workspace, snapshot, bank, payment } = overview("late");
  const credited = { ...payment, fullRemainingMinor: 0, minimumRemainingMinor: bank.minimumDueMinor, confirmedPaidMinor: 0, confirmedCreditMinor: bank.officialBalanceMinor };
  render(<CardOverview budget="scenarios" card={card} workspace={workspace} snapshot={snapshot} bank={bank} payment={credited} today="2026-10-15" available onStatement={noop} onSettings={noop} onPayments={noop} />);
  const obligation = screen.getByRole("region", { name: "Statement and payment" });
  expect(within(obligation).getByText("Minimum payment remaining").nextElementSibling).toHaveTextContent("25.00");
  expect(within(obligation).getByText("Remaining to pay").nextElementSibling).toHaveTextContent("0.00");
  expect(within(obligation).getByText("Minimum overdue")).toBeVisible();
  expect(within(obligation).queryByText("Minimum covered")).not.toBeInTheDocument();
});

it("compacts known-zero historical interest, keeps exact history available and links statements", () => {
  const { card, workspace, snapshot } = statementScenario("full");
  const onStatement = jest.fn();
  render(<DebtHistory card={{ ...card, minimumPercentBps: 500, minimumFloorMinor: 10000 }} workspace={workspace} snapshot={snapshot} today="2026-10-15" debtMinor={12000} available onSettings={noop} onStatement={onStatement} />);
  expect(screen.getByText("Cumulative interest charged: 0.00")).toBeVisible();
  expect(screen.queryByRole("figure", { name: "Cumulative interest charged" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show zero-interest chart" }));
  expect(screen.getByRole("figure", { name: "Cumulative interest charged" })).toBeVisible();
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
  expect(screen.getByText("Observed interest charges").nextElementSibling).toHaveTextContent("0.00");
  expect(screen.getByText("Observed fees").nextElementSibling).toHaveTextContent("0.00");
  expect(screen.queryByText(/Unknown charges are not zero/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show zero-interest chart" })).toBeVisible();
});


it("excludes zero opening anchors from the settlement streak and stops at unknown evidence", () => {
  const { card, workspace, snapshot, bank, payment, statuses } = overview("full");
  const props = { budget: "scenarios", card, workspace, snapshot, bank, payment, statuses, today: "2026-10-15", available: true, onStatement: noop, onSettings: noop, onPayments: noop };
  const view = render(<CardOverview {...props} />);
  expect(screen.getByText("Full balance settled by the due date for 12 consecutive tracked statements.")).toBeVisible();
  const gap = workspace.statements.find((entry) => entry.closingDate === "2026-08-31")!;
  view.rerender(<CardOverview {...props} workspace={{ ...workspace, statements: workspace.statements.map((entry) => entry.id === gap.id ? { ...entry, bankConfirmed: false } : entry) }} statuses={statuses.map((entry) => entry.statementId === gap.id ? { ...entry, fullByDue: null, minimumByDue: null } : entry)} />);
  expect(screen.getByText("Full balance settled by the due date for 1 consecutive tracked statement.")).toBeVisible();
});


it("shows full assigned plan debt separately from the billed statement and withholds stale tracking totals", () => {
  const { cards, sources, workspace } = transferPlanScenario();
  const card = { ...cards[0], creditLimitMinor: 5000000 };
  const props = { budget: "test", card, workspace, snapshot: sources[0], bank: workspace.statements[4], balance: { signedBalanceMinor: -450000, debtMinor: 450000, creditMinor: 0 }, today: "2026-10-16", available: true, onStatement: noop, onSettings: noop, onPayments: noop };
  const { rerender } = render(<CardOverview {...props} />);
  const panel = screen.getByRole("region", { name: "Current balance and activity" });
  expect(within(panel).getByText("Total debt").nextElementSibling).toHaveTextContent("14,500.00");
  expect(within(panel).getByText(/On card 4,500.00/)).toHaveTextContent("in plan account 10,000.00");
  expect(within(panel).getByText(/Before pending activity/)).toHaveTextContent("15,500.00");
  expect(within(panel).getByText("34,500.00 estimated available")).toBeVisible();
  rerender(<CardOverview {...props} snapshot={{ ...sources[0], trackingAccounts: [] }} />);
  expect(within(panel).getByText("Total debt").nextElementSibling).toHaveTextContent("-");
  expect(within(panel).queryByText("34,500.00 estimated available")).not.toBeInTheDocument();
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
