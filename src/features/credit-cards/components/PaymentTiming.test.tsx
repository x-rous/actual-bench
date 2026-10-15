import { fireEvent, render, screen } from "@testing-library/react";
import { PaymentDistribution, PaymentTiming } from "./PaymentTiming";
import { cardSchema, statementSchema } from "../lib/models";
import type { ActivityRow } from "../lib/activity";
import { PaymentsList } from "./PaymentsList";

const statement = statementSchema.parse({ id: "statement", cardId: "card", revision: 1, periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, bankConfirmed: true, lifecycle: "recorded", verification: "recorded", coverage: "complete", openingAnchor: true });
const payment = (id: string, date: string, cleared: boolean | null = true): ActivityRow => ({ id, fingerprint: id, accountId: "account", date, amountMinor: 5000, cleared, label: "Funding account", notes: "Payment memo", categoryId: null, categoryName: null, transferId: "peer", transferKnown: true, parentId: null });

it("keeps exact dates and pending evidence in the timing description", () => {
  render(<PaymentTiming dueDate={statement.dueDate} date="2026-10-22" label="Clearing pending" pending />);
  expect(screen.getByTitle(/Due 20 Oct 2026; observed 22 Oct 2026; clearing pending/)).toHaveTextContent("Clearing pending");
});

it("plots only matched Actual transfers and opens existing details without shifting equal dates", () => {
  const details = jest.fn();
  const entries = [{ row: payment("first", "2026-10-20"), matchedStatement: statement }, { row: payment("second", "2026-10-20", false), matchedStatement: statement }, { row: payment("unmatched", "2026-09-01") }];
  render(<PaymentDistribution payments={entries} onDetails={details} />);
  const dots = screen.getAllByRole("button");
  expect(dots).toHaveLength(2);
  expect(dots[0].style.left).toBe(dots[1].style.left);
  expect(dots[1]).toHaveAccessibleName(/clearing pending/);
  fireEvent.click(dots[1]);
  expect(details).toHaveBeenCalledWith("second");
  expect(entries[1].row.cleared).toBe(false);
});

it("keeps the empty payments summary neutral and statement obligations in Statements", () => {
  const card = cardSchema.parse({ id: "card", revision: 1, budgetSyncId: "budget", accountId: "account", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC" });
  const onStatements = jest.fn();
  render(<PaymentsList card={card} payments={[]} available today="2026-10-01" onStatements={onStatements} onDetails={jest.fn()} />);
  expect(screen.queryByText(/Statement payment/)).not.toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Card repayments" }).querySelectorAll("tbody tr")).toHaveLength(0);
  expect(screen.getByText("Cleared paid").nextElementSibling).toHaveTextContent("0.00");
  expect(screen.getByText("Pending").nextElementSibling).toHaveTextContent("0.00 · 0 payments");
  expect(screen.getByText("Payments").nextElementSibling).toHaveTextContent("0");
  fireEvent.click(screen.getByRole("button", { name: "View statement payment status" }));
  expect(onStatements).toHaveBeenCalledWith();
});

it("marks an overdue obligation as an as-of observation, without inventing a payment", () => {
  render(<PaymentTiming dueDate="2026-10-01" date="2026-10-15" label="14 days overdue · unpaid" state="overdue" />);
  expect(screen.getByTitle(/overdue.*Due 01 Oct 2026; as of 15 Oct 2026/)).toHaveTextContent("14 days overdue · unpaid");
  expect(screen.getByText("14 days overdue · unpaid")).toHaveClass("text-destructive");
});
