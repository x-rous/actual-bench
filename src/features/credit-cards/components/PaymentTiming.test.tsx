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

it("keeps an upcoming obligation separate from recorded payment rows and totals", () => {
  const card = cardSchema.parse({ id: "card", revision: 1, budgetSyncId: "budget", accountId: "account", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC" });
  const onStatements = jest.fn();
  const settlement = { statementId: statement.id, fullRemainingMinor: 10000, confirmedPaidMinor: 0, confirmedCreditMinor: 0, minimumRemainingMinor: 1000, status: "Upcoming" } as Parameters<typeof PaymentsList>[0]["settlement"];
  render(<PaymentsList card={card} payments={[]} available bank={statement} settlement={settlement} today="2026-10-01" onStatements={onStatements} onDetails={jest.fn()} />);
  expect(screen.getByText(/Statement payment/)).toBeVisible();
  expect(screen.getByRole("table", { name: "Card repayments" }).querySelectorAll("tbody tr")).toHaveLength(0);
  expect(screen.getByText("0 · all cleared")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "View statement" }));
  expect(onStatements).toHaveBeenCalledWith(statement.id);
});
