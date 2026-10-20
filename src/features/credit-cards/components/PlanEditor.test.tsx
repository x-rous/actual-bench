import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlanEditor } from "./PlanEditor";
import { creditCardStore } from "../lib/store/store";
import { resetCreditCardStore, addCard, BUDGET, CARD_INPUT, row, snapshot } from "../lib/fixtures/testKit";

function setup(extra: Parameters<typeof row>[0][] = []) {
  resetCreditCardStore();
  addCard(creditCardStore, { ...CARD_INPUT, purchaseAprBps: null, closingDay: 30 });
  const purchase = row({ id: "purchase", date: "2026-09-01", amount: -120000, payeeName: "Laptop store", categoryId: "tech" });
  const read = snapshot([purchase, ...extra.map(row)], { from: "2026-09-01", to: "2026-10-14" });
  const workspace = () => creditCardStore.getState().workspaces[BUDGET];
  return { card: workspace().cards[0], row: purchase, snapshot: read, workspace };
}

it("makes a plan from a purchase, with fees, without creating payments or source rows (§8.3)", async () => {
  const { card, row: purchase, snapshot: read, workspace } = setup();
  const close = jest.fn();
  render(<PlanEditor budget={BUDGET} card={card} row={purchase} workspace={workspace()} snapshot={read} available onClose={close} />);
  expect(screen.getByLabelText("Plan name")).toHaveValue("Laptop store");
  fireEvent.change(screen.getByLabelText("Original amount (if known)"), { target: { value: "600.00" } });
  fireEvent.click(screen.getByRole("radio", { name: "Bank bills instalments" }));
  fireEvent.change(screen.getByLabelText("Monthly instalment"), { target: { value: "110.00" } });
  fireEvent.change(screen.getByLabelText("Monthly plan fee"), { target: { value: "10.00" } });
  expect(screen.getByText("Expected total").nextElementSibling).toHaveTextContent("660.00");
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(workspace().plans[0]).toMatchObject({ originalAmountMinor: 60000, instalmentMinor: 11000, monthlyFeeMinor: 1000, includesCosts: true, recordedAs: "card-instalments" });
  expect(workspace().planEntries).toEqual([expect.objectContaining({ transactionId: "purchase", role: "original" })]);
  expect(read.rows).toHaveLength(1);
});

it("records promotional terms with a visible not-calculated schedule", () => {
  const { card, row: purchase, snapshot: read, workspace } = setup();
  render(<PlanEditor budget={BUDGET} card={card} row={purchase} workspace={workspace()} snapshot={read} available onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("radio", { name: "Bank bills instalments" }));
  fireEvent.click(screen.getByRole("radio", { name: "Other terms" }));
  expect(screen.getByText("Promotional terms; no instalment schedule")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(workspace().plans[0].scheduleKind).toBe("promotional");
});

it("needs a plan account for a plan-account plan and keeps the draft on rejection", () => {
  const { card, row: purchase, snapshot: read, workspace } = setup();
  const close = jest.fn();
  render(<PlanEditor budget={BUDGET} card={card} row={purchase} workspace={workspace()} snapshot={read} available onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose the plan account");
  expect(screen.getByLabelText("Plan name")).toHaveValue("Laptop store");
  expect(close).not.toHaveBeenCalled();
});

it("opens as a two-column dialog: settings beside a read-only What Bench sees panel, with no linking inside (§9.10)", () => {
  const { card, row: purchase, snapshot: read, workspace } = setup();
  render(<PlanEditor budget={BUDGET} card={card} row={purchase} workspace={workspace()} snapshot={read} available onClose={jest.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Add instalment plan" });
  expect(dialog).toHaveAttribute("data-slot", "dialog-content");
  expect(dialog.querySelector("details")).toBeNull();
  expect(screen.getByRole("region", { name: "What Bench sees" })).toBeVisible();
  expect(dialog).toHaveTextContent("Made from");
  expect(dialog).toHaveTextContent("Laptop store");
  expect(screen.queryByRole("textbox", { name: "Find an original purchase" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

it("blocks saving while data is refreshing", () => {
  const { card, row: purchase, snapshot: read, workspace } = setup();
  render(<PlanEditor budget={BUDGET} card={card} row={purchase} workspace={workspace()} snapshot={read} available={false} onClose={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
});

it("opens filled in from a plan found in a plan account, finished when its principal is all back on the card", () => {
  const { card, row: purchase, snapshot: read, workspace } = setup();
  void purchase;
  render(<PlanEditor budget={BUDGET} card={card} workspace={workspace()} snapshot={read} available onClose={jest.fn()} candidate={{
    key: "loans:#EMI_BT", accountId: "loans", accountName: "Credit card loans", tag: "#EMI_BT", alternativeTags: ["#BANK"], name: "BALANCE TRANSFER",
    startDate: "2025-08-09", originalMinor: 3864000, movedBackMinor: 3864000, remainingMinor: 0, finished: true, lastDate: "2025-11-25",
    transfers: 3, bookings: 1, rowIds: [],
  }} />);
  expect(screen.getByLabelText("Plan name")).toHaveValue("BALANCE TRANSFER");
  expect(screen.getByLabelText("Original amount (if known)")).toHaveValue("38640.00");
  expect(screen.getByLabelText("Plan tag (in the transfer notes)")).toHaveValue("#EMI_BT");
  expect(screen.getByText(/also carry #BANK/)).toBeVisible();
  expect(screen.getByLabelText("Plan status")).toHaveTextContent("Finished");
});

it("puts the status beside the name, uses segmented choices with their meaning, and lists what the schedule still needs", () => {
  const { card, workspace } = setup();
  render(<PlanEditor budget={BUDGET} card={card} workspace={workspace()} snapshot={snapshot([], { from: "2026-09-01", to: "2026-10-14" })} available onClose={jest.fn()} />);
  const what = screen.getByRole("region", { name: "Plan details" });
  expect(within(what).getByLabelText("Plan name")).toBeInTheDocument();
  expect(within(what).getByLabelText("Plan status")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Status" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Bank bills instalments" }));
  expect(screen.getByText("The bank converts the purchase and bills one instalment on each statement.")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Fixed instalments" }));
  const sees = screen.getByRole("region", { name: "What Bench sees" });
  expect(within(sees).getByText("Instalments billed on the card")).toBeVisible();
  expect(within(sees).getByText("Monthly instalment").parentElement).toHaveTextContent("(missing)");
});

it("lists the plan account among what the schedule still needs, so a complete schedule never waits silently", () => {
  const { card, workspace } = setup();
  render(<PlanEditor budget={BUDGET} card={card} workspace={workspace()} snapshot={snapshot([], { from: "2026-09-01", to: "2026-10-14" })} available onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Original amount (if known)"), { target: { value: "30000" } });
  fireEvent.click(screen.getByRole("radio", { name: "Fixed instalments" }));
  fireEvent.change(screen.getByLabelText("Number of instalments"), { target: { value: "6" } });
  fireEvent.change(screen.getByLabelText("Monthly instalment"), { target: { value: "5000" } });
  const sees = screen.getByRole("region", { name: "What Bench sees" });
  expect(within(sees).getByText("Plan account").parentElement).toHaveTextContent("(missing)");
  fireEvent.click(screen.getByLabelText("Shared with other plans"));
  expect(within(sees).getByText("Plan tag").parentElement).toHaveTextContent("(missing)");
});
