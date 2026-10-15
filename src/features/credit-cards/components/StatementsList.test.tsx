import { render, screen, within } from "@testing-library/react";
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
  render(<StatementsList card={card} rows={[statement]} workspace={workspace} snapshot={snapshot} statuses={settlements(card, workspace, snapshot, "2026-10-15")} available today="2026-10-15" eligible attentionOnly={false} onAdd={jest.fn()} onEdit={jest.fn()} onReview={jest.fn()} onAction={jest.fn()} />);
  const table = screen.getByRole("table");
  expect(within(table).getByText("01 Sep – 30 Sep")).toBeVisible();
  expect(within(table).getByText("30 Sep 2026")).toBeVisible();
  const cells = within(table).getAllByRole("row")[1].querySelectorAll("td");
  expect(cells).toHaveLength(11);
  expect(cells[2]).toHaveTextContent(covered ? "810.00" : "-");
  expect(cells[3]).toHaveTextContent(covered ? "100.00" : "-");
  expect(within(table).getByRole("columnheader", { name: "Balance" })).toBeVisible();
  expect(within(cells[8]).queryByText(/^Minimum due:/)).not.toBeInTheDocument();
  if (!covered) return;
  expect(within(table).getByText("65.00")).toHaveClass("text-left");
  expect(within(table).getByText("65.00").closest("td")).toHaveClass("text-destructive");
  expect(within(table).queryByText("Interest 25.00 · Fees 40.00")).not.toBeInTheDocument();
  expect(within(table).getByRole("columnheader", { name: "Carried at due" })).toBeVisible();
  expect(cells[7]).toHaveTextContent(paid ? "570.00" : "770.00");
  if (paid) expect(within(table).getByText("Minimum paid: 01 Oct 2026 · on time")).toBeVisible();
  else {
    expect(cells[5]).toHaveTextContent("100.00");
    expect(within(cells[8]).getByText("Minimum overdue")).toBeVisible();
  }
  expect(within(table).queryByText(/days past full-payment/)).not.toBeInTheDocument();
});
