import { fireEvent, render, screen } from "@testing-library/react";
import { PlanEditor } from "./PlanEditor";
import { creditCardStore } from "../lib/memory";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { repaymentPlanSchema } from "../lib/models";

function setup() {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const original = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "account", nickname: "Example card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", closingDay: 30 });
  const row: ActivityRow = { id: "purchase", date: "2026-09-01", accountId: "account", amountMinor: -120000, fingerprint: "original", label: "Example purchase", notes: null, categoryId: null, categoryName: null, transferId: null, transferKnown: true, parentId: null, cleared: true };
  const snapshot: ActivitySnapshot = { accountId: "account", rows: [row], counterparts: [], issues: [], from: "2026-09-01", to: "2026-10-14", signature: "test", fetchedAt: "2026-10-14" };
  creditCardStore.getState().classify("budget", original.id, original.revision, snapshot, { cardId: original.id, transactionId: row.id, fingerprint: row.fingerprint, kind: "purchase", reason: "Confirmed charge" });
  const workspace = creditCardStore.getState().workspaces.budget;
  return { card: workspace.cards[0], row, snapshot, workspace };
}
it("saves a partial purchase plan with fees without creating payments or source rows", () => {
  const props = setup(); const close = jest.fn();
  render(<PlanEditor {...props} budget="budget" available onClose={close} />);
  fireEvent.change(screen.getByLabelText("Original / converted amount"), { target: { value: "600.00" } });
  fireEvent.change(screen.getByLabelText("Monthly instalment"), { target: { value: "110.00" } });
  fireEvent.change(screen.getByLabelText("Monthly plan fee"), { target: { value: "10.00" } });
  expect(screen.getByRole("button", { name: "Yes, included" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Expected total").nextElementSibling).toHaveTextContent("660.00");
  expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(creditCardStore.getState().workspaces.budget.plans![0]).toMatchObject({ amountMinor: 60000, monthlyMinor: 11000, monthlyFeeMinor: 1000, includesCosts: true });
  expect(creditCardStore.getState().workspaces.budget.allocations).toEqual([]);
  expect(props.snapshot.rows).toEqual([props.row]);
});
it("records unsupported terms with a visible Not calculated state", () => {
  const props = setup();
  render(<PlanEditor {...props} budget="budget" available onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Other terms" }));
  expect(screen.getAllByText("Not calculated").length).toBeGreaterThan(0);
  expect(screen.getByText("Expected schedule")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(creditCardStore.getState().workspaces.budget.plans![0].arrangement).toBe("promotional");
});
it("requires explicit acceptance of changed original evidence and preserves the draft on rejection", () => {
  const props = setup();
  const plan = repaymentPlanSchema.parse({ id: "plan", cardId: props.card.id, transactionId: props.row.id, fingerprint: "older", revision: 1, arrangement: "fixed", amountMinor: 60000, startDate: props.row.date, firstDueDate: "2026-10-20", months: 6, monthlyMinor: 10000, aprBps: 0, upfrontFeeMinor: 0, monthlyFeeMinor: 0, includesCosts: true, minimumPercentBps: 500, minimumFloorMinor: 10000, expiryDate: null, afterAprBps: null, conditions: "" });
  const close = jest.fn();
  render(<PlanEditor {...props} plan={plan} budget="budget" available onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(screen.getByRole("alert")).toHaveTextContent("original Actual charge changed");
  expect(screen.getByLabelText("Original / converted amount")).toHaveValue("600.00");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use current original transactions" }));
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(creditCardStore.getState().workspaces.budget.plans![0].fingerprint).toBe("original");
});

it("opens linked postings against the original purchase and stages amount-based matches in Transactions", () => {
  const props = setup();
  const posting = { ...props.row, id: "instalment", label: "Monthly bill", fingerprint: "bill", amountMinor: -20000, date: "2026-10-10" };
  const snapshot = { ...props.snapshot, rows: [...props.snapshot.rows, posting] };
  const plan = repaymentPlanSchema.parse({ id: "plan", cardId: props.card.id, transactionId: props.row.id, fingerprint: props.row.fingerprint, revision: 1, arrangement: "fixed", amountMinor: 120000, startDate: props.row.date, firstDueDate: "2026-10-20", months: 6, monthlyMinor: 20000, aprBps: 0, upfrontFeeMinor: 0, monthlyFeeMinor: 0, includesCosts: true, minimumPercentBps: 500, minimumFloorMinor: 10000, expiryDate: null, afterAprBps: null, conditions: "" });
  creditCardStore.getState().savePlan("budget", props.card.id, props.card.revision, snapshot, plan, []);
  const workspace = creditCardStore.getState().workspaces.budget;
  render(<PlanEditor {...props} card={workspace.cards[0]} workspace={workspace} snapshot={snapshot} row={posting} plan={workspace.plans![0]} initialTab="transactions" focusTransactionId={posting.id} budget="budget" available onClose={jest.fn()} />);
  expect(screen.getByRole("tab", { name: "Transactions (0)" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("table", { name: "Plan transactions and suggested matches" })).toHaveTextContent("200.00");
  expect(screen.getByText("Matches instalment 1 amount and period")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Link entry" }));
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  const saved = creditCardStore.getState().workspaces.budget;
  expect(saved.plans![0].transactionId).toBe(props.row.id);
  expect(saved.planLinks).toEqual([{ planId: plan.id, transactionId: posting.id, fingerprint: posting.fingerprint, role: "combined-instalment", instalment: 1 }]);
});

it("releases refund confirmation when the refund is explicitly unlinked", () => {
  const props = setup();
  const refund = { ...props.row, id: "refund", fingerprint: "refund", label: "Refund entry", amountMinor: 10000, date: "2026-10-01" };
  const snapshot = { ...props.snapshot, rows: [props.row, refund] };
  const plan = repaymentPlanSchema.parse({ id: "plan", cardId: props.card.id, transactionId: props.row.id, fingerprint: props.row.fingerprint, revision: 1, arrangement: "fixed", amountMinor: 120000, startDate: props.row.date, firstDueDate: "2026-10-20", months: 6, monthlyMinor: 20000, aprBps: 0, upfrontFeeMinor: 0, monthlyFeeMinor: 0, includesCosts: true, minimumPercentBps: 500, minimumFloorMinor: 10000, expiryDate: null, afterAprBps: null, conditions: "", refundReview: { treatment: "unchanged", signature: JSON.stringify([["refund", "refund"]]), remaining: [] } });
  creditCardStore.getState().savePlan("budget", props.card.id, props.card.revision, snapshot, plan, [{ planId: plan.id, transactionId: refund.id, fingerprint: refund.fingerprint, role: "refund", instalment: null }]);
  const workspace = creditCardStore.getState().workspaces.budget;
  render(<PlanEditor {...props} snapshot={snapshot} card={workspace.cards[0]} workspace={workspace} plan={workspace.plans![0]} budget="budget" available initialTab="transactions" focusTransactionId={refund.id} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(creditCardStore.getState().workspaces.budget.planLinks).toEqual([]);
  expect(creditCardStore.getState().workspaces.budget.plans![0].refundReview).toBeUndefined();
});
