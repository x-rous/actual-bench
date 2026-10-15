import { render, screen, within } from "@testing-library/react";
import { CardOverview } from "./CardOverview";
import { StatementsList } from "./StatementsList";
import { DebtHistory } from "./DebtHistory";
import { settlements } from "../lib/repayments";
import { statementScenario } from "../lib/statementScenarios.fixture";

jest.mock("./HistoryChart", () => ({ HistoryChart: () => null }));

/** Compare public surfaces for the same statement; no copied outcome algorithm in this test. */
it.each([
  { kind: "full", mode: "normal" }, { kind: "late", mode: "normal" }, { kind: "carry", mode: "normal" },
  { kind: "full", mode: "pending" }, { kind: "full", mode: "credits" }, { kind: "full", mode: "coverage" },
] as const)("keeps $kind/$mode outcomes and timing identical across statement screens", ({ kind, mode }) => {
  const scenario = statementScenario(kind);
  if (mode === "pending" || mode === "credits") scenario.snapshot.rows = scenario.snapshot.rows.map((row) => row.date !== "2026-10-01" ? row : { ...row, fingerprint: `${row.fingerprint}-${mode}`, cleared: mode !== "pending", transferId: mode === "credits" ? null : row.transferId });
  if (mode === "coverage") scenario.snapshot.to = "2026-10-10";
  scenario.statuses = settlements(scenario.card, scenario.workspace, scenario.snapshot, "2026-10-15");
  const shared = { ...scenario, available: true, today: "2026-10-15" };
  const bank = scenario.rows.find((row) => row.closingDate === "2026-09-30")!;
  const payment = scenario.statuses.find((row) => row.statementId === bank.id)!;
  render(<>
    <CardOverview {...shared} budget="scenarios" bank={bank} payment={payment} onStatement={jest.fn()} onSettings={jest.fn()} onPayments={jest.fn()} />
    <StatementsList {...shared} eligible attentionOnly={false} onAdd={jest.fn()} onEdit={jest.fn()} onReview={jest.fn()} onPayments={jest.fn()} onAction={jest.fn()} />
    <DebtHistory {...shared} onSettings={jest.fn()} />
  </>);
  const recent = within(screen.getByRole("region", { name: "Recent statements" })).getByRole("table");
  const statements = screen.getByRole("table", { name: `Statements for ${scenario.card.nickname}` });
  const history = screen.getByRole("table", { name: "Actual statement debt history" });
  for (const date of ["30 Sep 2026", "31 Aug 2026", "31 Jul 2026", "30 Jun 2026", "31 May 2026"]) {
    const rowFor = (table: HTMLElement) => within(table).getByText(date).closest("tr")!;
    const label = `Read full payment outcome for ${date}`;
    const recentOutcome = within(rowFor(recent)).getByRole("button", { name: label });
    const listOutcome = within(rowFor(statements)).getByRole("button", { name: label });
    const historyOutcome = within(rowFor(history)).getByRole("button", { name: label });
    expect(recentOutcome).toHaveTextContent(listOutcome.textContent!);
    expect(historyOutcome).toHaveTextContent(listOutcome.textContent!);
    expect(recentOutcome.innerHTML).toBe(listOutcome.innerHTML);
    expect(historyOutcome.innerHTML).toBe(listOutcome.innerHTML);
    expect(rowFor(recent).children[2].textContent).toBe(rowFor(statements).children[6].textContent);
  }
  if (mode !== "normal") {
    const latest = within(recent).getByText("30 Sep 2026").closest("tr")!;
    expect(within(latest).getByRole("button", { name: "Read full payment outcome for 30 Sep 2026" })).toHaveTextContent(mode === "coverage" ? "Payment history incomplete" : "Minimum overdue");
  }
  if (kind === "late") {
    const late = within(recent).getAllByText("Paid in full · late")[0];
    expect(late).toHaveAttribute("data-variant", "status-warning");
    expect(within(recent).getByText("14 days overdue · unpaid")).toHaveClass("text-destructive");
  }
});
