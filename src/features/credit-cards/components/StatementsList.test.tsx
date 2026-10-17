import { fireEvent, render, screen, within } from "@testing-library/react";
import { statementScenario } from "../lib/statementScenarios.fixture";
import { StatementsList } from "./StatementsList";
import { createCreditCardStore } from "../lib/memory";
import { settlements } from "../lib/repayments";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";

it.each([{ covered: true, paid: true }, { covered: false, paid: true }, { covered: true, paid: false }])("separates statement amounts with coverage $covered and payments $paid", ({ covered, paid }) => {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC", closingDay: 31, firstTrackedStatementDate: "2026-09-30", interestCategoryId: "interest", feeCategoryId: "fees", cashbackCategoryId: "rewards" });
  const statement = store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-01", officialBalanceMinor: 77000, minimumDueMinor: 10000, openingBalanceMinor: 0 }, true);
  const row = (id: string, date: string, amountMinor: number, categoryId: string | null, transferId: string | null = null): ActivityRow => ({ id, date, amountMinor, categoryId, transferId, accountId: "card", label: id, notes: null, categoryName: null, cleared: true, transferKnown: true, parentId: null, fingerprint: id });
  const snapshot: ActivitySnapshot = { accountId: "card", from: covered ? "2026-09-01" : "2026-09-02", to: "2026-10-15", rows: [row("purchase", "2026-09-10", -80000, null), row("interest", "2026-09-20", -2500, "interest"), row("fee", "2026-09-20", -4000, "fees"), row("refund", "2026-09-15", 5000, null), row("cashback", "2026-09-16", 2000, "rewards"), row("other-credit", "2026-09-17", 3000, null), row("excluded-refund", "2026-09-17", 9000, null), row("other-charge", "2026-09-18", -1000, null), row("cycle-payment", "2026-09-19", 500, null, "peer0"), row("minimum", "2026-10-01", 20000, null, "peer1"), row("later", "2026-10-04", 10000, null, "peer2")], counterparts: [], issues: [], fetchedAt: "now", signature: "rows" };
  if (!paid) snapshot.rows = snapshot.rows.filter((entry) => entry.date <= statement.closingDate);
  store.getState().classify("budget", card.id, store.getState().workspaces.budget.cards[0].revision, snapshot, { cardId: card.id, transactionId: "other-charge", fingerprint: "other-charge", kind: "other-charge", reason: "Reviewed classification" });
  store.getState().saveReview("budget", statement.id, statement.revision, snapshot, snapshot.rows.map((entry) => ({ statementId: statement.id, cardId: card.id, transactionId: entry.id, fingerprint: entry.fingerprint, decision: entry.id !== "excluded-refund" && entry.date <= statement.closingDate ? "included" : "excluded", provenance: "manual", bankPostingDate: null, reason: "Reviewed cutoff" })), false);
  const workspace = store.getState().workspaces.budget;
  render(<StatementsList card={card} rows={[statement]} workspace={workspace} snapshot={snapshot} statuses={settlements(card, workspace, snapshot, "2026-10-15")} available today="2026-10-15" eligible attentionOnly={false} onAdd={jest.fn()} onEdit={jest.fn()} onReview={jest.fn()} onPayments={jest.fn()} onAction={jest.fn()} />);
  const table = screen.getByRole("table");
  expect(within(table).getByText("01 Sep – 30 Sep")).toBeVisible();
  expect(within(table).getByText("30 Sep 2026")).toBeVisible();
  const cells = within(table).getAllByRole("row")[1].querySelectorAll("td");
  expect(cells).toHaveLength(12);
  expect(cells[6]).toHaveTextContent(covered ? "5.00" : "-");
  expect(cells[2]).toHaveTextContent(covered ? "810.00" : "-");
  expect(cells[3]).toHaveTextContent(covered ? "0.00" : "-");
  expect(cells[3]).toHaveTextContent(covered ? "100.00" : "-");
  expect(within(table).getByRole("columnheader", { name: "Statement balance" })).toBeVisible();
  expect(within(cells[9]).queryByText(/^Minimum due:/)).not.toBeInTheDocument();
  if (!covered) return;
  expect(within(table).getByText("65.00")).toHaveClass("text-right");
  expect(within(table).getByText("65.00").closest("td")).toHaveClass("text-destructive");
  expect(within(table).queryByText("Interest 25.00 · Fees 40.00")).not.toBeInTheDocument();
  expect(within(table).getByRole("columnheader", { name: "Carried at due" })).toBeVisible();
  expect(cells[8]).toHaveTextContent(paid ? "570.00" : "770.00");
  if (paid) expect(within(table).getByText("01 Oct 2026 · on time")).toBeVisible();
  else {
    expect(cells[5]).toHaveTextContent("100.00");
    expect(within(cells[9]).getByText("Minimum overdue")).toBeVisible();
  }
  expect(within(table).queryByText(/days past full-payment/)).not.toBeInTheDocument();
});

it.each(["full", "late", "carry"] as const)("makes the RD098 %s scenario scannable and keeps row actions accessible", (kind) => {
  const scenario = statementScenario(kind);
  const review = jest.fn(), edit = jest.fn(), payments = jest.fn();
  render(<StatementsList {...scenario} available today="2026-10-15" eligible attentionOnly={false} onAdd={jest.fn()} onEdit={edit} onReview={review} onPayments={payments} onAction={jest.fn()} />);
  const table = screen.getByRole("table");
  expect(screen.getByText("13 statements · 13 reviewed · 13 verified")).toHaveClass("text-muted-foreground");
  expect(screen.queryByText(/payments late|minimum overdue ·/)).not.toBeInTheDocument();
  expect(within(table).getAllByRole("row")).toHaveLength(14);
  expect(within(table).queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  const last = scenario.rows.find((row) => row.closingDate === "2026-09-30")!;
  const latest = within(table).getByRole("button", { name: "Open statement 30 Sep 2026" }).closest("tr")!;
  fireEvent.click(within(latest).getAllByRole("cell")[1]);
  expect(review).toHaveBeenCalledWith(last);
  review.mockClear();
  const open = within(latest).getByRole("button", { name: "Open statement 30 Sep 2026" });
  open.focus();
  expect(open).toHaveFocus();
  fireEvent.click(open);
  expect(review).toHaveBeenCalledTimes(1);
  review.mockClear();
  fireEvent.click(within(latest).getByRole("button", { name: /Read full payment outcome/ }));
  expect(review).not.toHaveBeenCalled();
  if (kind === "full") {
    expect(within(latest).queryByText("Review")).not.toBeInTheDocument();
    expect(within(latest).getByText("Paid in full")).toHaveAttribute("data-variant", "status-active");
  } else if (kind === "late") {
    expect(within(latest).getByText("14 days overdue · unpaid")).toBeVisible();
    expect(within(latest).getByText("Minimum overdue")).toBeVisible();
    expect(within(table).getAllByText("Paid in full · late")).toHaveLength(10);
    fireEvent.click(within(latest).getByRole("button", { name: "View payments" }));
    expect(payments).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
  } else {
    expect(within(latest).getByText("Minimum paid · carried")).toBeVisible();
    expect(within(latest).queryByText("Minimum met")).not.toBeInTheDocument();
    expect(within(latest).getByText("25.00").closest("td")).toHaveClass("text-destructive");
  }
  const baseline = within(table).getByRole("button", { name: "Open statement 30 Sep 2025" }).closest("tr")!;
  expect(within(baseline).getByText("Tracking starts here")).toBeVisible();
  expect(within(baseline).queryByText("No payment required")).not.toBeInTheDocument();
  expect(within(latest).getAllByRole("cell")[3]).toHaveClass("text-muted-foreground");
});


it("keeps summary counts tied to current review evidence", () => {
  const scenario = statementScenario("full");
  const props = { ...scenario, available: true, today: "2026-10-15", eligible: true, attentionOnly: false, onAdd: jest.fn(), onEdit: jest.fn(), onReview: jest.fn(), onPayments: jest.fn(), onAction: jest.fn() };
  const { rerender } = render(<StatementsList {...props} />);
  expect(screen.getByText("13 statements · 13 reviewed · 13 verified")).toBeVisible();
  const rows = scenario.rows.map((row) => row.closingDate === "2026-09-30" ? { ...row, reviewedSnapshot: "changed source" } : row);
  rerender(<StatementsList {...props} rows={rows} workspace={{ ...scenario.workspace, statements: rows }} />);
  expect(screen.getByText("13 statements · 12 reviewed · 12 verified")).toBeVisible();
  rerender(<StatementsList {...props} available={false} snapshot={undefined} />);
  expect(screen.getByText("13 statements · 0 reviewed · 0 verified")).toBeVisible();
});


it("keeps evidence review as the primary action when an overdue statement's source changed", () => {
  const scenario = statementScenario("late");
  const rows = scenario.rows.map((row) => row.closingDate === "2026-09-30" ? { ...row, reviewedSnapshot: "changed source" } : row);
  const review = jest.fn(), payments = jest.fn();
  render(<StatementsList {...scenario} rows={rows} workspace={{ ...scenario.workspace, statements: rows }} available today="2026-10-15" eligible attentionOnly={false} onAdd={jest.fn()} onEdit={jest.fn()} onReview={review} onPayments={payments} onAction={jest.fn()} />);
  const latest = screen.getByRole("button", { name: "Open statement 30 Sep 2026" }).closest("tr")!;
  expect(within(latest).queryByRole("button", { name: "View payments" })).not.toBeInTheDocument();
  fireEvent.click(within(latest).getByRole("button", { name: "Review" }));
  expect(review).toHaveBeenCalledWith(rows.find((row) => row.closingDate === "2026-09-30"));
  expect(payments).not.toHaveBeenCalled();
});
