import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PaymentsList } from "./PaymentsList";
import { cardSchema, statementSchema } from "../lib/models";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { settlements } from "../lib/repayments";

const card = cardSchema.parse({ id: "card", revision: 1, budgetSyncId: "budget", accountId: "account", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC" });
const statement = statementSchema.parse({ id: "statement", cardId: "card", revision: 1, periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, bankConfirmed: true, lifecycle: "recorded", verification: "recorded", coverage: "complete", openingAnchor: true });
const row = (id: string, date: string, cleared: boolean | null): ActivityRow => ({ id, fingerprint: id, accountId: "account", date, amountMinor: 1000, cleared, label: "Funding account", notes: "Full payment memo", categoryId: null, categoryName: null, transferId: `peer-${id}`, transferKnown: true, parentId: null });
const rows = [row("cleared", "2026-10-01", true), row("pending", "2026-10-02", false), row("unknown", "2026-10-03", null), row("partial", "2026-10-04", true), { ...row("complete", "2026-10-05", true), amountMinor: 8000 }];
const snapshot: ActivitySnapshot = { accountId: "account", from: "2026-09-01", to: "2026-10-15", rows, counterparts: [{ ...rows[0], id: "peer-cleared", accountId: "funding", amountMinor: -1000 }], issues: [], fetchedAt: "now", signature: "rows" };
const workspace = { cards: [card], statements: [statement], memberships: [], plans: [], allocations: [], classifications: [] };

it("keeps five payments for one statement in eight columns with compact totals and existing navigation", async () => {
  const onStatements = jest.fn(), onDetails = jest.fn();
  render(<PaymentsList accounts={[{ id: "funding", name: "Current account" }]} card={card} payments={rows.map((row) => ({ row, matchedStatement: statement }))} snapshot={snapshot} available onStatements={onStatements} onDetails={onDetails} workspace={workspace} statuses={settlements(card, workspace, snapshot, "2026-10-15")} today="2026-10-15" />);
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Payment Date", "Paid from", "Notes", "Amount", "Cleared", "For Statement", "Payment Effect", "Against the Due Date"]);
  expect(within(table).getByText("Current account")).toBeVisible();
  expect(within(table).getAllByRole("img", { name: "Cleared" })).toHaveLength(3);
  expect(within(table).getByRole("img", { name: "Uncleared" })).toBeVisible();
  expect(within(table).getByRole("img", { name: "Unknown clearing status" })).toBeVisible();
  const dataRows = within(table).getAllByRole("row").slice(1);
  expect(dataRows).toHaveLength(5);
  expect(dataRows.every((entry) => within(entry).getAllByRole("cell").length === 8)).toBe(true);
  const summary = screen.getByRole("region", { name: "When you pay" });
  const total = (label: string) => within(summary).getByText(label).nextElementSibling;
  expect(total("Cleared paid")).toHaveTextContent("100.00");
  expect(total("Pending")).toHaveTextContent("10.00 · 1 payment");
  expect(total("Pending")).toHaveTextContent("10.00 · 1 unknown clearing");
  expect(total("Payments")).toHaveTextContent("5");
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
  expect(within(summary).getByText("Cleared paid").nextElementSibling).toHaveTextContent("-");
  expect(within(summary).getByText("Pending").nextElementSibling).toHaveTextContent("-");
  expect(within(table).getAllByRole("cell")[6]).toHaveTextContent("Effect unavailable");
});
