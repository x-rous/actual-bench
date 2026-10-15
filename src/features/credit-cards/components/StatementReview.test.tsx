import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { StatementReview } from "./StatementReview";
import { creditCardStore } from "../lib/memory";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";

function chooseDecision(payee: string, label: string) {
  fireEvent.click(screen.getByRole("button", { name: `${label} ${payee}` }));
  expect(screen.getByRole("button", { name: `${label} ${payee}` })).toHaveAttribute("aria-pressed", "true");
}

it("searches notes, sorts columns and saves every decision even when rows are filtered", async () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const store = creditCardStore.getState();
  const card = store.register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "Bank", last4: "1234", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 2000, minimumDueMinor: 100 });
  const rows: ActivityRow[] = ["Zulu", "Alpha"].map((label, index) => ({ id: label, accountId: "card", date: "2026-09-30", amountMinor: -1000, label, notes: index ? "Train receipt" : "Hotel receipt", categoryId: null, categoryName: "Travel", cleared: true, transferId: null, transferKnown: true, parentId: null, fingerprint: label }));
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-01", to: "2026-11-01", rows, counterparts: [], issues: [], fetchedAt: "now", signature: "rows" };
  const close = jest.fn();
  render(<StatementReview budget="budget" statement={statement} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available onClose={close} />);
  const dialog = screen.getByRole("region", { name: /Review statement/ });
  fireEvent.click(screen.getByRole("button", { name: /^All \(/ }));
  expect(within(dialog).getByRole("button", { name: "Save decisions" })).toBeVisible();
  expect(within(dialog).getByText("Hotel receipt")).toBeVisible();
  expect(within(dialog).getAllByText("Travel")).toHaveLength(2);
  expect(within(dialog).getByRole("button", { name: "Classify Zulu" })).toBeVisible();
  expect(dialog.querySelector("details")).toBeNull();
  expect(within(dialog).getByRole("img", { name: "Reconciliation needs attention" })).toBeVisible();
  expect(within(dialog).queryByText("Statement evidence and saving")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "About Statement evidence and saving" })).toBeVisible();
  expect(within(dialog).getAllByRole("img", { name: "Cleared" })).toHaveLength(2);
  expect(within(dialog).getByRole("table")).toHaveClass("text-xs");
  expect(within(dialog).queryByRole("button", { name: "Bank posting dates" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("columnheader", { name: /Bank posted/ })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Transaction actions Zulu" }));
  expect(screen.queryByRole("menuitem", { name: "Set bank posting date" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Move to another statement" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(within(dialog).getByRole("heading", { name: /Review statement/ })).toHaveTextContent("30 Sep 2026");
  fireEvent.change(within(dialog).getByLabelText("Search statement transactions"), { target: { value: "30 Sep 2026" } });
  expect(within(dialog).getAllByRole("row")).toHaveLength(3);
  fireEvent.change(within(dialog).getByLabelText("Search statement transactions"), { target: { value: "" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Payee/ }));
  const bodyRows = within(dialog).getAllByRole("row").slice(1);
  expect(bodyRows[0]).toHaveTextContent("Alpha");
  fireEvent.change(within(dialog).getByLabelText("Search statement transactions"), { target: { value: "Hotel receipt" } });
  expect(within(dialog).queryByText("Alpha")).not.toBeInTheDocument();
  chooseDecision("Zulu", "Undecided");
  expect(screen.getByRole("button", { name: "Include Zulu" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Undecided Zulu" }).closest("tr")).toHaveClass("bg-chart-5/5");
  chooseDecision("Zulu", "Exclude");
  expect(screen.getByRole("button", { name: "Undecided Zulu" }).closest("tr")).not.toHaveClass("bg-chart-5/5");
  chooseDecision("Zulu", "Include");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save decisions" }));
  expect(close).toHaveBeenCalled();
  expect(creditCardStore.getState().workspaces.budget.memberships).toHaveLength(2);
  expect(creditCardStore.getState().workspaces.budget.memberships.find((entry) => entry.transactionId === "Zulu")?.decision).toBe("included");
});

it("confirms opening membership without falsely verifying its balance", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const store = creditCardStore.getState();
  const card = store.register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "Bank", last4: "1234", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 2000, minimumDueMinor: 100 });
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-01", to: "2026-11-01", rows: [], counterparts: [], issues: [], fetchedAt: "now", signature: "empty" };
  const close = jest.fn();
  render(<StatementReview budget="budget" statement={statement} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available onClose={close} />);
  expect(screen.getByRole("button", { name: "Confirm transactions" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm transactions" }));
  expect(close).toHaveBeenCalled();
  expect(creditCardStore.getState().workspaces.budget.statements[0]).toMatchObject({ verification: "membership-reviewed", lifecycle: "recorded" });
});

it("bulk edits selected transactions across filters without writing until Save", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const store = creditCardStore.getState();
  const card = store.register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 2000, minimumDueMinor: 100 });
  const rows: ActivityRow[] = ["Alpha", "Beta"].map((label) => ({ id: label, accountId: "card", date: "2026-09-10", amountMinor: -1000, label, notes: null, categoryId: null, categoryName: null, cleared: true, transferId: null, transferKnown: true, parentId: null, fingerprint: label }));
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-01", to: "2026-11-01", rows, counterparts: [], issues: [], fetchedAt: "now", signature: "rows" };
  render(<StatementReview budget="budget" statement={statement} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available onClose={jest.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Review statement/ })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: /^All \(/ }));
  fireEvent.click(screen.getByLabelText("Select visible transactions"));
  fireEvent.change(screen.getByLabelText("Search statement transactions"), { target: { value: "Alpha" } });
  fireEvent.click(screen.getByRole("button", { name: "Mark selected undecided" }));
  expect(screen.getByRole("button", { name: "Undecided Alpha" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Exclude selected" }));
  expect(screen.getByRole("button", { name: "Exclude Alpha" })).toHaveAttribute("aria-pressed", "true");
  expect(creditCardStore.getState().workspaces.budget.memberships).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Search statement transactions"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Exclude Beta" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Confirm transactions" }));
  expect(creditCardStore.getState().workspaces.budget.memberships.map((entry) => entry.decision)).toEqual(["excluded", "excluded"]);
});

it("colors negative amounts red and incoming transfer payments green without coloring refunds as payments", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const store = creditCardStore.getState();
  const card = store.register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 2000, minimumDueMinor: 100 });
  const base: ActivityRow = { id: "purchase", accountId: "card", date: "2026-09-10", amountMinor: -1000, label: "Shop", notes: null, categoryId: null, categoryName: null, cleared: true, transferId: null, transferKnown: true, parentId: null, fingerprint: "purchase" };
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-01", to: "2026-11-01", rows: [base, { ...base, id: "payment", fingerprint: "payment", amountMinor: 2000, transferId: "funding" }, { ...base, id: "refund", fingerprint: "refund", amountMinor: 500 }], counterparts: [], issues: [], fetchedAt: "now", signature: "rows" };
  render(<StatementReview budget="budget" statement={statement} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available onClose={jest.fn()} />);
  expect(screen.getByRole("cell", { name: "-10.00" })).toHaveClass("text-destructive");
  expect(screen.getByRole("cell", { name: "20.00" })).toHaveClass("text-green-700");
  expect(screen.getByRole("cell", { name: "5.00" })).not.toHaveClass("text-green-700");
});


it("locks three boundary transactions owned by September in October, including bulk edits, and releases excluded ownership", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const store = creditCardStore.getState();
  const card = store.register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const september = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 3000, minimumDueMinor: 100 });
  const october = store.recordStatement("budget", card.id, 2, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-20", officialBalanceMinor: 4000, minimumDueMinor: 100 }, true);
  const rows: ActivityRow[] = ["Border A", "Border B", "Border C", "October shop"].map((label, index) => ({ id: label, accountId: "card", date: index < 3 ? "2026-10-01" : "2026-10-10", amountMinor: -1000, label, notes: "#2026-10", categoryId: null, categoryName: null, cleared: true, transferId: null, transferKnown: true, parentId: null, fingerprint: label }));
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-01", to: "2026-11-03", rows, counterparts: [], issues: [], fetchedAt: "now", signature: "rows" };
  const membership = (row: ActivityRow) => ({ statementId: september.id, cardId: card.id, transactionId: row.id, fingerprint: row.fingerprint, decision: "included" as const, provenance: "manual" as const, bankPostingDate: null, reason: "Bank statement confirms cutoff" });
  store.saveReview("budget", september.id, 1, snapshot, rows.slice(0, 3).map(membership), false);
  const close = jest.fn();
  const { unmount } = render(<StatementReview budget="budget" statement={october} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: /^All \(/ }));
  for (const row of rows.slice(0, 3)) {
    expect(screen.queryByRole("button", { name: `Include ${row.label}` })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText(`Reason for ${row.label}`).closest("tr")!).getByRole("img", { name: "Excluded and locked: Included in statement 30 Sep 2026" })).toBeVisible();
    expect(screen.getByLabelText(`Reason for ${row.label}`)).toHaveValue("Included in statement 30 Sep 2026");
  }
  fireEvent.click(screen.getByLabelText("Select visible transactions"));
  fireEvent.click(screen.getByRole("button", { name: "Include selected" }));
  fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));
  expect(close).toHaveBeenCalled();
  const workspace = creditCardStore.getState().workspaces.budget;
  expect(workspace.memberships.filter((entry) => entry.statementId === october.id && entry.decision === "included").map((entry) => entry.transactionId)).toEqual(["October shop"]);
  // Direct save attempts must also fail, without silently stealing membership.
  expect(() => store.saveReview("budget", october.id, 2, snapshot, [{ ...membership(rows[0]), statementId: october.id }], false)).toThrow("A transaction cannot belong to two statements");
  unmount();
  store.saveReview("budget", september.id, 2, snapshot, rows.slice(0, 3).map((row) => ({ ...membership(row), decision: "excluded" as const })), false);
  render(<StatementReview budget="budget" statement={workspace.statements.find((entry) => entry.id === october.id)!} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^All \(/ }));
  expect(screen.getByRole("button", { name: "Include Border A" })).toBeEnabled();
});

it("opens on All and stages reassignment without changing either statement until save", async () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const store = creditCardStore.getState();
  const card = store.register({ budgetSyncId: "budget", accountId: "card", nickname: "Example card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const first = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 1000, minimumDueMinor: 100 });
  const second = store.recordStatement("budget", card.id, 2, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-20", officialBalanceMinor: 2000, minimumDueMinor: 100 }, true);
  const base: ActivityRow = { id: "matched", accountId: "card", date: "2026-09-10", amountMinor: -1000, label: "Matched shop", notes: "#2026-09", categoryId: null, categoryName: null, cleared: true, transferId: null, transferKnown: true, parentId: null, fingerprint: "matched" };
  const source: ActivitySnapshot = { accountId: "card", from: "2026-08-01", to: "2026-12-01", rows: [base, { ...base, id: "exception", fingerprint: "exception", label: "Cutoff shop", notes: "#2026-09 #2026-10" }], counterparts: [], issues: [], fetchedAt: "now", signature: "rows" };
  render(<StatementReview budget="budget" statement={first} workspace={creditCardStore.getState().workspaces.budget} snapshot={source} available onClose={jest.fn()} />);
  expect(screen.getByRole("button", { name: "All (2)" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Needs review (1)" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Include Matched shop" })).toHaveAttribute("aria-pressed", "true");
  const unresolvedRow = screen.getByRole("button", { name: "Include Cutoff shop" }).closest("tr")!;
  expect(unresolvedRow).toHaveClass("bg-chart-5/5");
  expect(within(unresolvedRow).getByRole("button", { name: "Undecided Cutoff shop" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: "Review selected" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undecided Cutoff shop" })).toHaveTextContent("");
  expect(screen.getByRole("button", { name: "Include Cutoff shop" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Exclude Cutoff shop" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByLabelText("Select transaction Cutoff shop 10 Sep 2026 exception"));
  fireEvent.click(screen.getByRole("button", { name: "Move selected" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Destination statement" }));
  const destination = screen.getByRole("option", { name: "31 Oct 2026" });
  fireEvent.pointerDown(destination, { pointerType: "mouse" });
  fireEvent.pointerUp(destination, { pointerType: "mouse" });
  fireEvent.mouseUp(destination);
  fireEvent.click(destination);
  await waitFor(() => expect(screen.getByRole("button", { name: "Stage move" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Stage move" }));
  expect(creditCardStore.getState().workspaces.budget.memberships).toHaveLength(0);
  expect(await screen.findByText(/1 transaction moves staged/)).toBeVisible();
  expect(unresolvedRow).not.toHaveClass("bg-chart-5/5");
  expect(within(unresolvedRow).queryByText("Needs review")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm transactions" }));
  const saved = creditCardStore.getState().workspaces.budget;
  expect(saved.memberships.find((entry) => entry.transactionId === "exception" && entry.statementId === first.id)?.decision).toBe("excluded");
  expect(saved.memberships.find((entry) => entry.transactionId === "exception" && entry.statementId === second.id)?.decision).toBe("included");
  expect(saved.statements.find((entry) => entry.id === second.id)).toMatchObject({ verification: "needs-review", revision: 2 });
});

it("verifies the first statement using an explicit balance brought forward", async () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, openingBalanceMinor: 10000 });
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-30", to: "2026-10-02", rows: [], counterparts: [], issues: [], fetchedAt: "now", signature: "empty" };
  render(<StatementReview budget="budget" statement={statement} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "About Statement evidence and saving" }));
  await waitFor(() => expect(screen.getByText(/Balance brought forward: 100.00/)).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "About Statement evidence and saving" }));
  expect(screen.getByRole("button", { name: "Save & verify" })).toBeVisible();
  expect(screen.getByRole("img", { name: "Bank balance matches" })).toBeVisible();
  expect(screen.queryByRole("img", { name: "Reconciliation needs attention" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm transactions" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save & verify" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0].verification).toBe("verified");
});


it("shows attention rather than a success icon when Actual evidence is unavailable", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const store = creditCardStore.getState();
  const card = store.register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = store.recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, openingBalanceMinor: 10000 });
  const snapshot: ActivitySnapshot = { accountId: "card", from: "2026-08-30", to: "2026-10-02", rows: [], counterparts: [], issues: [], fetchedAt: "now", signature: "empty" };
  render(<StatementReview budget="budget" statement={statement} workspace={creditCardStore.getState().workspaces.budget} snapshot={snapshot} available={false} onClose={jest.fn()} />);
  expect(screen.getByRole("img", { name: "Reconciliation needs attention" })).toBeVisible();
  expect(screen.getByText("Evidence unavailable")).toBeVisible();
  expect(screen.queryByRole("img", { name: "Bank balance matches" })).not.toBeInTheDocument();
});
