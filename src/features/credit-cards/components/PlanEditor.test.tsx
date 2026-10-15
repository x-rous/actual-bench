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
  fireEvent.change(screen.getByLabelText("Amount converted"), { target: { value: "600.00" } });
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
  expect(screen.queryByText("Expected schedule")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(creditCardStore.getState().workspaces.budget.plans![0].arrangement).toBe("promotional");
});
it("requires explicit acceptance of changed original evidence and preserves the draft on rejection", () => {
  const props = setup();
  const plan = repaymentPlanSchema.parse({ id: "plan", cardId: props.card.id, transactionId: props.row.id, fingerprint: "older", revision: 1, arrangement: "fixed", amountMinor: 60000, startDate: props.row.date, firstDueDate: "2026-10-20", months: 6, monthlyMinor: 10000, aprBps: 0, upfrontFeeMinor: 0, monthlyFeeMinor: 0, includesCosts: true, minimumPercentBps: 500, minimumFloorMinor: 10000, expiryDate: null, afterAprBps: null, conditions: "" });
  const close = jest.fn();
  render(<PlanEditor {...props} plan={plan} budget="budget" available onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(screen.getByRole("alert")).toHaveTextContent("accept the changed original");
  expect(screen.getByLabelText("Amount converted")).toHaveValue("600.00");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Accept current source" }));
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(creditCardStore.getState().workspaces.budget.plans![0].fingerprint).toBe("original");
});
