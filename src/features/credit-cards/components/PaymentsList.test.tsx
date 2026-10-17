import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PaymentsList } from "./PaymentsList";
import { cardSchema, statementSchema } from "../lib/models";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { statementScenario } from "../lib/statementScenarios.fixture";
import { settlements, matchedPaymentStatement } from "../lib/repayments";

const card = cardSchema.parse({ id: "card", revision: 1, budgetSyncId: "budget", accountId: "account", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC" });
const statement = statementSchema.parse({ id: "statement", cardId: "card", revision: 1, periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, bankConfirmed: true, lifecycle: "recorded", verification: "recorded", coverage: "complete", openingAnchor: true });
const row = (id: string, date: string, cleared: boolean | null): ActivityRow => ({ id, fingerprint: id, accountId: "account", date, amountMinor: 1000, cleared, label: "Funding account", notes: "Full payment memo", categoryId: null, categoryName: null, transferId: `peer-${id}`, transferKnown: true, parentId: null });
const rows = [row("cleared", "2026-10-01", true), row("pending", "2026-10-02", false), row("unknown", "2026-10-03", null), row("partial", "2026-10-04", true), { ...row("complete", "2026-10-05", true), amountMinor: 8000 }];
const snapshot: ActivitySnapshot = { accountId: "account", from: "2026-09-01", to: "2026-10-15", rows, counterparts: [{ ...rows[0], id: "peer-cleared", accountId: "funding", amountMinor: -1000 }], issues: [], fetchedAt: "now", signature: "rows" };
const workspace = { cards: [card], statements: [statement], memberships: [], plans: [], allocations: [], classifications: [] };

it("keeps split payments in one statement count with three plain totals and a separate details action", async () => {
  const onStatements = jest.fn(), onDetails = jest.fn();
  render(<PaymentsList accounts={[{ id: "funding", name: "Current account" }]} card={card} payments={rows.map((row) => ({ row, matchedStatement: statement }))} snapshot={snapshot} available onStatements={onStatements} onDetails={onDetails} workspace={workspace} statuses={settlements(card, workspace, snapshot, "2026-10-15")} today="2026-10-15" />);
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Payment Date", "Paid from", "Notes", "Amount", "Cleared", "For Statement", "Payment Effect", "Against the Due Date", "Details"]);
  expect(within(table).getByText("Current account")).toBeVisible();
  expect(within(table).getAllByRole("img", { name: "Cleared" })).toHaveLength(3);
  expect(within(table).getByRole("img", { name: "Uncleared" })).toBeVisible();
  expect(within(table).getByRole("img", { name: "Unknown clearing status" })).toBeVisible();
  const dataRows = within(table).getAllByRole("row").slice(1);
  expect(within(dataRows[0]).getAllByRole("cell")[0].querySelector("button")).toBeNull();
  expect(within(dataRows[0]).getAllByRole("cell")[8]).toContainElement(within(dataRows[0]).getByRole("button", { name: /View payment details/ }));
  expect(dataRows).toHaveLength(5);
  expect(dataRows.every((entry) => within(entry).getAllByRole("cell").length === 9)).toBe(true);
  const summary = screen.getByRole("region", { name: "When you pay" });
  expect(within(summary).getByRole("heading", { name: "When you pay" })).toBeVisible();
  const total = (label: string) => within(summary).getByText(label).nextElementSibling;
  expect(total("Repaid")).toHaveTextContent("100.00");
  expect(total("Paid in full")).toHaveTextContent("1");
  expect(total("Paid late")).toHaveTextContent("0");
  expect(within(summary).queryByText("Pending")).not.toBeInTheDocument();
  expect(within(summary).queryByText("Last payment")).not.toBeInTheDocument();
  expect(within(summary).queryByText("Matched to statements")).not.toBeInTheDocument();
  expect(within(table).getAllByRole("button", { name: "View statement 30 Sep 2026" })).toHaveLength(5);
  expect(within(table).getByRole("button", { name: /payment effect for 04 Oct/ })).toHaveTextContent("Partial payment");
  expect(within(table).getByRole("button", { name: /payment effect for 05 Oct/ })).toHaveTextContent("Completes statement");
  expect(within(table).getByRole("button", { name: /payment effect for 01 Oct/ })).toHaveTextContent("Minimum payment");
  expect(within(table).getByRole("button", { name: /payment effect for 02 Oct/ })).toHaveTextContent("Pending");
  fireEvent.click(within(table).getAllByRole("button", { name: "View statement 30 Sep 2026" })[0]);
  expect(onStatements).toHaveBeenCalledWith("statement");
  fireEvent.click(within(table).getByRole("button", { name: "View payment details for 01 Oct 2026 Funding account" }));
  expect(onDetails).toHaveBeenCalledWith("cleared");
  fireEvent.click(within(table).getByRole("button", { name: /payment effect for 01 Oct/ }));
  await waitFor(() => expect(screen.getByText(/minimum remaining 0.00/)).toBeVisible());
});

it("keeps unavailable clearing and summary totals distinct from confirmed evidence", () => {
  render(<PaymentsList card={card} payments={[{ row: rows[0], matchedStatement: statement }]} snapshot={snapshot} available={false} onStatements={jest.fn()} onDetails={jest.fn()} />);
  const table = screen.getByRole("table");
  expect(within(table).getByRole("img", { name: "Clearing status unavailable" })).toBeVisible();
  const summary = screen.getByRole("region", { name: "When you pay" });
  expect(within(summary).getByText("Repaid").nextElementSibling).toHaveTextContent("-");
  expect(within(summary).getByText("Paid in full").nextElementSibling).toHaveTextContent("-");
  expect(within(summary).getByText("Paid late").nextElementSibling).toHaveTextContent("-");
  expect(within(table).getAllByRole("cell")[6]).toHaveTextContent("Effect unavailable");
});

it("counts late completed statements once and excludes the latest unpaid bill", () => {
  const { card, workspace, snapshot, statuses } = statementScenario("late");
  const payments = snapshot.rows.filter((row) => row.transferId && row.amountMinor > 0).map((row) => ({ row, matchedStatement: matchedPaymentStatement(row.date, workspace.statements, statuses) }));
  render(<PaymentsList card={card} workspace={workspace} snapshot={snapshot} statuses={statuses} today="2026-10-15" payments={payments} available onStatements={jest.fn()} onDetails={jest.fn()} />);
  const summary = screen.getByRole("region", { name: "When you pay" });
  expect(within(summary).getByText("Repaid").nextElementSibling).toHaveTextContent("11,500.00");
  expect(within(summary).getByText("Paid in full").nextElementSibling).toHaveTextContent("11");
  expect(within(summary).getByText("Paid late").nextElementSibling).toHaveTextContent("10");
});

it("does not count a statement as paid in full when a refund covers the payment shortfall", () => {
  const payment = { ...row("partial", "2026-10-04", true), amountMinor: 7000 };
  const refund = { ...row("refund", "2026-10-05", true), amountMinor: 3000, transferId: null, categoryId: "purchases", label: "Merchant refund" };
  const source = { ...snapshot, rows: [payment, refund], counterparts: [] };
  render(<PaymentsList card={card} workspace={workspace} snapshot={source} statuses={settlements(card, workspace, source, "2026-10-15")} today="2026-10-15" payments={[{ row: payment, matchedStatement: statement }]} available onStatements={jest.fn()} onDetails={jest.fn()} />);
  const summary = screen.getByRole("region", { name: "When you pay" });
  expect(within(summary).getByText("Repaid").nextElementSibling).toHaveTextContent("70.00");
  expect(within(summary).getByText("Paid in full").nextElementSibling).toHaveTextContent("0");
  expect(within(summary).getByText("Paid late").nextElementSibling).toHaveTextContent("0");
  expect(screen.getByRole("button", { name: /payment effect for 04 Oct/ })).toHaveTextContent("Partial payment");
});
