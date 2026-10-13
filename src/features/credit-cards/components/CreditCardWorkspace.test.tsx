import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreditCardWorkspace } from "./CreditCardWorkspace";
import { getTransport } from "@/lib/actual";
import type { ActivityRow } from "../lib/activity";
import { creditCardStore } from "../lib/memory";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";

const mockSync = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/actual", () => ({ getTransport: jest.fn(() => ({ sync: mockSync })) }));

const mockDirectory = {
  data: { accounts: [{ id: "account", name: "Actual Visa", offBudget: false, closed: false }], balances: new Map([["account", { signedBalanceMinor: -315000, debtMinor: 315000, creditMinor: 0 }]]), fetchedAt: "2026-10-10T12:00:00Z" },
  isFetching: false, isError: false, refetch: jest.fn(),
};
jest.mock("../hooks/useCreditCardDirectory", () => ({ useCreditCardDirectory: () => mockDirectory, useCreditCardCategories: () => ({ data: { categories: [{ id: "interest", name: "Card interest" }, { id: "fees", name: "Bank fees" }] }, isFetching: false, isError: false, refetch: jest.fn() }) }));
const mockActivity = { data: { accountId: "account", from: "2026-01-01", to: "2026-12-31", rows: [] as ActivityRow[], counterparts: [] as ActivityRow[], issues: [], fetchedAt: "2026-10-10T12:00:00Z", signature: "empty" }, isFetching: false, isError: false, refetch: jest.fn() };
jest.mock("../hooks/useCreditCardActivity", () => ({ useCreditCardActivities: (_connection: unknown, cards: unknown[]) => cards.map(() => mockActivity) }));
jest.mock("@/features/accounts/hooks/useAccountClasses", () => ({ useAccountClasses: () => ({ available: true, maps: { accounts: new Map([["account", "credit-card"]]), groups: new Map() } }) }));
const connection: ConnectionInstance = { id: "connection", budgetSyncId: "budget", label: "Budget", mode: "http-api", baseUrl: "http://localhost", apiKey: "test" };

const queryClient = new QueryClient();
function TestWorkspace() { return <QueryClientProvider client={queryClient}><CreditCardWorkspace /></QueryClientProvider>; }

beforeEach(() => {
  queryClient.clear();
  mockSync.mockReset().mockResolvedValue(undefined);
  mockDirectory.refetch.mockReset().mockResolvedValue({ isError: false });
  mockActivity.refetch.mockReset().mockResolvedValue({ isError: false });
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  mockActivity.data.from = "2026-01-01";
  mockActivity.data.to = "2026-12-31";
  mockActivity.data.rows = [];
  mockActivity.data.counterparts = [];
  mockActivity.isFetching = false;
  mockActivity.isError = false;
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
  mockDirectory.isFetching = false;
  mockDirectory.isError = false;
});

function register() {
  return creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "account", nickname: "My Visa", issuer: "", last4: "4482", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "Asia/Dubai", status: "active" });
}

it("registers a labelled card without touching Actual or browser storage", () => {
  render(<TestWorkspace />);
  expect(screen.getByRole("heading", { name: "No credit cards yet" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Add card" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Add card" }));
  const dialog = screen.getByRole("dialog", { name: "Add credit card" });
  fireEvent.change(within(dialog).getByLabelText("Nickname"), { target: { value: "My Visa" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save card" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "My Visa" })).toBeInTheDocument();
  expect(screen.getByText("3,150.00")).toBeInTheDocument();
  expect(screen.queryByText(/Session only|memory.only/i)).not.toBeInTheDocument();
  expect(screen.getByText("Changes saved")).toBeInTheDocument();
  expect(creditCardStore.getState().workspaces.budget.cards).toHaveLength(1);
});

it("records an opening statement without claiming verification or paid status", () => {
  const card = register();
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add latest statement" }));
  const dialog = screen.getByRole("dialog", { name: "Add latest statement" });
  for (const [label, value] of [["Period start", "2026-09-05"], ["Closing date", "2026-10-04"], ["Payment due date", "2026-10-29"]]) {
    const input = within(dialog).getByLabelText(label);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }
  fireEvent.change(within(dialog).getByLabelText("Statement balance"), { target: { value: "2,850.00" } });
  fireEvent.change(within(dialog).getByLabelText("Minimum due"), { target: { value: "150.00" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save statement" }));
  expect(screen.getByRole("region", { name: "Review statement · 04 Oct 2026" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Add latest statement" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close review" }));
  fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0]).toMatchObject({ cardId: card.id, officialBalanceMinor: 285000, minimumDueMinor: 15000, verification: "recorded", coverage: "unknown" });
  expect(screen.getByText("Bank recorded · opening anchor")).toBeInTheDocument();
  expect(screen.getByText(/not remaining amounts due/)).toBeInTheDocument();
});

it("preserves editor drafts through refresh, hides bank facts across budgets and restores committed records on navigation", () => {
  register();
  const view = render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Unsaved draft" } });
  mockDirectory.isFetching = true;
  view.rerender(<TestWorkspace />);
  expect(screen.getByLabelText("Nickname")).toHaveValue("Unsaved draft");
  const other: ConnectionInstance = { ...connection, id: "other", budgetSyncId: "other-budget" };
  act(() => useConnectionStore.setState({ instances: [connection, other], activeInstanceId: other.id }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/My Visa/)).not.toBeInTheDocument();
  act(() => useConnectionStore.setState({ activeInstanceId: connection.id }));
  expect(screen.getByRole("button", { name: /My Visa/ })).toBeInTheDocument();
  expect(creditCardStore.getState().workspaces.budget.cards[0].nickname).toBe("My Visa");
});

it("retains official facts during source failure, without showing cached balances as current", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-05", closingDate: "2026-10-04", dueDate: "2026-10-29", officialBalanceMinor: 285000, minimumDueMinor: 15000 });
  mockDirectory.isError = true;
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  expect(screen.getByText("2,850.00")).toBeInTheDocument();
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText("3,150.00")).not.toBeInTheDocument();
  expect(screen.getByText(/Actual data unavailable/)).toBeInTheDocument();
});


it("prepares cycle drafts from Actual and allows undoing a saved card", () => {
  const card = register();
  const { id, revision, ...input } = card;
  creditCardStore.getState().updateCard("budget", id, revision, { ...input, closingDay: 4, dueRule: { kind: "days-after-close", days: 25 }, minimumPercentBps: 200, minimumFloorMinor: 2500 });
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Statements" }));
  expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button", { name: "Confirm bank values" })[0]);
  expect(screen.getByLabelText("Statement balance")).toHaveValue("3150.00");
  expect(screen.getByLabelText("Minimum due")).toHaveValue("63.00");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].closingDay).toBeNull();
  expect(screen.getByText("Last change undone")).toBeInTheDocument();
});

it("keeps card metrics on Overview and shows complete payment notes and funding details", () => {
  register();
  const payment: ActivityRow = { id: "payment", accountId: "account", date: "2026-10-08", amountMinor: 10000, label: "Checking transfer", notes: "Monthly card repayment", categoryId: null, categoryName: null, cleared: true, transferId: "funding", transferKnown: true, parentId: null, fingerprint: "payment" };
  mockActivity.data.rows = [payment];
  mockActivity.data.counterparts = [{ ...payment, id: "funding", accountId: "checking", amountMinor: -10000, notes: "Funding account memo", transferId: "payment" }];
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  expect(screen.getByText("Current debt")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
  expect(screen.queryByText("Current debt")).not.toBeInTheDocument();
  expect(screen.getByText("Monthly card repayment")).toBeVisible();
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Allocate payment" })).not.toBeInTheDocument();
  expect(document.querySelector("details, summary")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /View payment details/ }));
  const details = screen.getByRole("dialog", { name: "Payment details" });
  expect(within(details).getByText("Funding account memo")).toBeVisible();
  expect(within(details).getByText("Monthly card repayment")).toBeVisible();
  fireEvent.click(within(details).getByRole("button", { name: "Close details" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getAllByText("Cleared").length).toBeGreaterThan(0);
});

it("sorts recorded statements together with automatic drafts and shows the closing date", () => {
  const card = register();
  const { id, revision, ...input } = card;
  const store = creditCardStore.getState();
  store.updateCard("budget", id, revision, { ...input, closingDay: 4, dueRule: { kind: "days-after-close", days: 25 } });
  store.recordStatement("budget", id, revision + 1, { periodStart: "2026-07-05", closingDate: "2026-08-04", dueDate: "2026-08-29", officialBalanceMinor: 315000, minimumDueMinor: 1000 }, true);
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Statements" }));
  const table = screen.getByRole("table", { name: "Statements for My Visa" });
  expect(within(table).getByRole("columnheader", { name: "Statement date" })).toBeInTheDocument();
  const dates = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].querySelector("p")!.textContent!);
  expect(dates).toEqual([...dates].sort((a, b) => Date.parse(b) - Date.parse(a)));
  expect(dates.indexOf("04 Aug 2026")).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Search Statements for My Visa"), { target: { value: "04 Aug 2026" } });
  expect(within(table).getAllByRole("row")).toHaveLength(2);
});

it("shows statement total paid, full payment date and lateness independently of spending review", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-05", closingDate: "2026-09-04", dueDate: "2026-09-29", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  const payment: ActivityRow = { id: "payment", accountId: "account", date: "2026-10-01", amountMinor: 10000, label: "Checking", notes: "#2026-10", categoryId: null, categoryName: null, cleared: true, transferId: "missing-peer", transferKnown: true, parentId: null, fingerprint: "payment" };
  mockActivity.data.rows = [payment, { ...payment, id: "spend", amountMinor: -500, transferId: null, cleared: false }];
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Statements" }));
  const table = screen.getByRole("table", { name: "Statements for My Visa" });
  const statement = within(table).getAllByRole("row")[1];
  expect(statement).toHaveTextContent("100.00");
  expect(within(statement).getByRole("button", { name: "Read full full payment timing" })).toHaveAttribute("title", expect.stringContaining("01 Oct 2026"));
  expect(statement).toHaveTextContent("2 days late");
  fireEvent.change(screen.getByLabelText("Search Statements for My Visa"), { target: { value: "2026-10-01" } });
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
  const payments = screen.getByRole("table", { name: "Card repayments" });
  expect(within(payments).getAllByRole("row")[1]).toHaveTextContent("04 Sep 2026");
  expect(screen.queryByText(/Repayment evidence needs review/)).not.toBeInTheDocument();
});

it("offers all Actual categories without card activity and defaults new cards to Actual/365", async () => {
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "Add card" }));
  const dialog = screen.getByRole("dialog", { name: "Add credit card" });
  expect(within(dialog).getByLabelText("Interest illustration")).toHaveTextContent("Daily simple Actual/365");
  for (const label of ["Card network", "Card colour", "Rewards notes", "Joint / authorized users notes"]) expect(within(dialog).queryByLabelText(label)).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Interest category in Actual")).toBeVisible();
  fireEvent.click(within(dialog).getByLabelText("Interest category in Actual"));
  const interestOption = screen.getByRole("option", { name: "Card interest" });
  fireEvent.pointerDown(interestOption, { pointerType: "mouse" });
  fireEvent.pointerUp(interestOption, { pointerType: "mouse" });
  fireEvent.mouseUp(interestOption);
  fireEvent.click(interestOption);
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  fireEvent.click(within(dialog).getByLabelText("Fees category in Actual"));
  const feesOption = screen.getByRole("option", { name: "Bank fees" });
  fireEvent.pointerDown(feesOption, { pointerType: "mouse" });
  fireEvent.pointerUp(feesOption, { pointerType: "mouse" });
  fireEvent.mouseUp(feesOption);
  fireEvent.click(feesOption);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ interestModel: "daily-simple-365", interestCategoryId: "interest", feeCategoryId: "fees" });
});


it("shows pending and unmatched payments clearly and navigates to statement outcomes", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-05", closingDate: "2026-09-04", dueDate: "2026-09-29", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  const payment: ActivityRow = { id: "pending", accountId: "account", date: "2026-09-20", amountMinor: 10000, label: "Checking", notes: "#2026-12 pending payment", categoryId: null, categoryName: null, cleared: false, transferId: "missing", transferKnown: true, parentId: null, fingerprint: "pending" };
  mockActivity.data.rows = [payment, { ...payment, id: "early", date: "2026-04-01", notes: "Older payment", cleared: true }];
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
  const rows = within(screen.getByRole("table", { name: "Card repayments" })).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("Pending");
  expect(rows[1]).toHaveTextContent("04 Sep 2026");
  expect(rows[2]).toHaveTextContent("No statement in loaded history");
  fireEvent.click(within(rows[1]).getByRole("button", { name: /View payment details/ }));
  expect(screen.getByText(/Funding transaction details are unavailable/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "View statements" }));
  const statements = screen.getByRole("table", { name: "Statements for My Visa" });
  expect(within(statements).getAllByRole("row")[1]).toHaveTextContent("100.00 pending");
  expect(within(within(statements).getAllByRole("row")[1]).getByRole("button", { name: "Read full minimum payment status" })).toHaveAttribute("title", expect.stringContaining("Minimum recorded · pending"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not present cached payment matches as current after source failure", () => {
  register();
  mockActivity.data.rows = [{ id: "payment", accountId: "account", date: "2026-10-08", amountMinor: 10000, label: "Checking", notes: "Stored memo", categoryId: null, categoryName: null, cleared: true, transferId: "missing", transferKnown: true, parentId: null, fingerprint: "payment" }];
  mockActivity.isError = true;
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
  expect(screen.getAllByText("Refresh needed")).toHaveLength(2);
  expect(screen.queryByText("No payments found")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /View payment details/ }));
  expect(screen.getByText(/Refresh Actual data to confirm this payment/)).toBeVisible();
});


it.each(["http-api", "browser-api"] as const)("syncs %s before refreshing and retains an open editor draft", async (mode) => {
  useConnectionStore.setState({ instances: [{ ...connection, mode } as ConnectionInstance], activeInstanceId: connection.id });
  let finishSync!: () => void;
  mockSync.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSync = resolve; }));
  register();
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Draft during sync" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh", hidden: true }));
  expect(getTransport).toHaveBeenCalledWith(expect.objectContaining({ mode }));
  expect(mockSync).toHaveBeenCalledTimes(1);
  expect(mockDirectory.refetch).not.toHaveBeenCalled();
  await act(async () => { finishSync(); });
  await waitFor(() => expect(mockDirectory.refetch).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Nickname")).toHaveValue("Draft during sync");
});

it("does not reload stale data as current when sync fails and permits retry", async () => {
  mockSync.mockRejectedValueOnce(new Error("Offline"));
  register();
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Actual sync failed"));
  expect(mockDirectory.refetch).not.toHaveBeenCalled();
  expect(screen.queryByText("3,150.00")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mockDirectory.refetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});


it("reports partial refresh failures and keeps existing bank facts", async () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-05", closingDate: "2026-10-04", dueDate: "2026-10-29", officialBalanceMinor: 285000, minimumDueMinor: 15000 });
  mockActivity.refetch.mockResolvedValueOnce({ isError: true });
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be refreshed completely"));
  expect(screen.getByText("2,850.00")).toBeInTheDocument();
  expect(screen.queryByText("3,150.00")).not.toBeInTheDocument();
});

it("labels a carried balance separately from overdue minimums", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-01", officialBalanceMinor: 10000, minimumDueMinor: 2500 });
  mockActivity.data.rows = [{ id: "payment", accountId: "account", date: "2026-09-01", amountMinor: 3000, transferId: "peer", transferKnown: true, notes: "#2026-01", cleared: true, label: "Checking", categoryId: null, categoryName: null, parentId: null, fingerprint: "payment" }];
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Statements" }));
  expect(screen.getByText("Full: balance carried")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Read full minimum payment status" })).toHaveTextContent("Minimum met");
  expect(screen.queryByText(/days overdue/)).not.toBeInTheDocument();
});

it("keeps feedback in the header and suppresses duplicate account names", () => {
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "account", nickname: "Actual Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  render(<TestWorkspace />);
  expect(screen.getAllByText("Actual Visa", { exact: true })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Actual Visa" }));
  expect(screen.getAllByText("Actual Visa", { exact: true })).toHaveLength(1);
  expect(screen.getByText("Changes saved").closest("header")).not.toBeNull();
  expect(creditCardStore.getState().workspaces.budget.cards[0].id).toBe(card.id);
});

it("consolidates missing statement values into actionable explanations and compact actions", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-05", closingDate: "2026-09-04", dueDate: "2026-09-29", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  mockActivity.data.rows = [{ id: "cutoff", accountId: "account", date: "2026-09-04", amountMinor: -10000, label: "Cutoff shop", notes: null, categoryId: null, categoryName: null, cleared: true, transferId: null, transferKnown: true, parentId: null, fingerprint: "cutoff" }];
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Statements" }));
  const table = screen.getByRole("table", { name: "Statements for My Visa" });
  expect(within(table).queryByText("Unavailable")).not.toBeInTheDocument();
  for (const label of ["Statement balance", "Due date", "Balance movement", "Payment progress", "Payment timing", "Status"]) {
    expect(within(table).getByRole("columnheader", { name: label })).toBeInTheDocument();
  }
  expect(within(table).getByRole("button", { name: "Read full statement status" })).toHaveAttribute("title", expect.stringMatching(/Review .*transaction decisions/));
  const headers = within(table).getAllByRole("columnheader").map((header) => header.textContent);
  expect(headers.slice(0, 3)).toEqual(["Statement date", "Statement balance", "Due date"]);
  expect(within(table).getByRole("button", { name: "Read full statement minimum due" }).closest("td")).toHaveTextContent("100.00Minimum due: 10.00");
  expect(within(table).getByRole("button", { name: "Correct bank facts" })).toHaveTextContent("Edit");
  expect(within(table).getByRole("button", { name: "Review transactions" })).toHaveTextContent("Review");
});

 it("separates the last verification action from current source-changed statement health", () => {
  const card = register();
  const statement = creditCardStore.getState().recordOpeningStatement("budget", card.id, card.revision, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  const workspace = creditCardStore.getState().workspaces.budget;
  creditCardStore.setState({ workspaces: { budget: { ...workspace, statements: [{ ...statement, verification: "verified", reviewedSnapshot: "older-source" }] } }, notices: { budget: "Statement verified" } });
  render(<TestWorkspace />);
  expect(screen.getByText("Statement verified")).toBeVisible();
  expect(screen.getByRole("button", { name: "Read full saved statement health" })).toHaveAttribute("title", expect.stringContaining("1 source changed"));
  expect(screen.getByRole("button", { name: "Read full saved statement health" })).toHaveAttribute("title", expect.stringContaining("0 verified"));
});

it("exposes reset and deletion with confirmation and Undo without changing Actual", () => {
  const card = register();
  const first = creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Statements" }));
  fireEvent.click(screen.getByRole("button", { name: "Statement actions 30 Sep 2026" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset transaction review" }));
  const reset = screen.getByRole("dialog", { name: "Reset transaction review" });
  expect(reset).toHaveTextContent("Bank values and activity classifications stay saved");
  fireEvent.click(within(reset).getByRole("button", { name: "Reset review" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0]).toMatchObject({ officialBalanceMinor: 10000, verification: "needs-review" });
  fireEvent.click(screen.getByRole("button", { name: "Statement actions 30 Sep 2026" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete saved statement" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Delete saved statement" })).getByRole("button", { name: "Delete statement" }));
  expect(creditCardStore.getState().workspaces.budget.statements).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0].id).toBe(first.id);
  expect(mockSync).not.toHaveBeenCalled();
});

it("shows the per-card tracking start in settings separately from the loading range", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = screen.getByRole("dialog", { name: "Card settings" });
  expect(within(dialog).getByLabelText("First tracked statement")).toHaveValue("30 Sep 2026");
  expect(dialog).toHaveTextContent("The toolbar range only controls loading and viewing");
});

 it("reports unloaded older statement evidence as unavailable rather than source changed", () => {
  const card = register();
  const first = creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  const workspace = creditCardStore.getState().workspaces.budget;
  creditCardStore.setState({ workspaces: { budget: { ...workspace, statements: [{ ...first, verification: "verified", reviewedSnapshot: "earlier-evidence" }] } } });
  mockActivity.data.from = "2026-09-01";
  render(<TestWorkspace />);
  expect(screen.getByRole("button", { name: "Read full saved statement health" })).toHaveAttribute("title", expect.stringContaining("1 awaiting source"));
  expect(screen.getByRole("button", { name: "Read full saved statement health" })).toHaveAttribute("title", expect.stringContaining("0 source changed"));
});

it("shows monthly debt periods, omits an empty interest panel and expires action feedback", () => {
  jest.useFakeTimers();
  try {
    const card = register();
    creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-07-01", closingDate: "2026-07-31", dueDate: "2026-08-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
    creditCardStore.getState().recordStatement("budget", card.id, 2, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-20", officialBalanceMinor: 12000, minimumDueMinor: 1000 }, true);
    creditCardStore.setState({ notices: { budget: "Statement verified" } });
    render(<TestWorkspace />);
    expect(screen.getByRole("button", { name: "Read full saved statement health" })).toHaveTextContent("2 statements need review");
    expect(screen.getByText("Statement verified")).toBeVisible();
    expect(screen.queryByText("Observed interest charges")).not.toBeInTheDocument();
    expect(screen.queryByText("Interest charged by month")).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(6000));
    expect(screen.queryByText("Statement verified")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read full saved statement health" })).toHaveTextContent("2 statements need review");
    fireEvent.click(screen.getByRole("button", { name: "View trend values" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("columnheader", { name: "Month" })).toBeVisible();
    expect(within(dialog).getByText("Aug 2026")).toBeVisible();
    expect(within(dialog).queryByText("01 Aug 2026")).not.toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});

it("shows identified interest even when there is only one reporting month", () => {
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "account", nickname: "My Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, interestCategoryId: "interest", bankTimeZone: "UTC", status: "active" });
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-07-01", closingDate: "2026-07-31", dueDate: "2026-08-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  mockActivity.data.from = "2026-07-01";
  mockActivity.data.to = "2026-07-31";
  mockActivity.data.rows = ["2026-07-12"].map((date) => ({ id: date, accountId: "account", date, amountMinor: -250, cleared: true, categoryId: "interest", categoryName: "Interest", label: "Interest", notes: null, transferId: null, transferKnown: true, parentId: null, fingerprint: date }));
  render(<TestWorkspace />);
  expect(screen.getByText("Interest charged by month")).toBeVisible();
  expect(screen.getByText("Interest charged by month").closest("figure")).not.toBeNull();
  expect(screen.queryByText("Observed interest charges")).not.toBeInTheDocument();
});

it("groups overview facts without duplicate repayment actions or an empty attention panel", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-25", officialBalanceMinor: 315000, minimumDueMinor: 15000 });
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  const statement = screen.getByRole("region", { name: "Statement and payment" });
  expect(within(statement).getByText("Billed statement balance")).toBeVisible();
  expect(within(statement).getByText("Minimum due: 150.00")).toBeVisible();
  expect(within(statement).getByText("Full payment remaining")).toBeVisible();
  expect(within(statement).getByText("Minimum remaining")).toBeVisible();
  expect(within(statement).getByText("25 Oct 2026")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Review repayments" })).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "Needs attention" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Card terms" })).toHaveTextContent("Auto-pay");
  expect(screen.getByRole("region", { name: "Current balance and activity" })).toHaveTextContent("Unexplained difference");
  expect(screen.queryByText("Net transactions")).not.toBeInTheDocument();
  const source = screen.getByRole("button", { name: "View contributing transactions" });
  fireEvent.click(source);
  expect(screen.getByRole("button", { name: "Hide contributing transactions" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("table", { name: "Transactions since statement closing" })).toBeVisible();
});

it("keeps a distinct transaction total when it does not explain the balance change", () => {
  const card = register();
  creditCardStore.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-25", officialBalanceMinor: 285000, minimumDueMinor: 15000 });
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: /My Visa/ }));
  const balance = screen.getByRole("region", { name: "Current balance and activity" });
  expect(within(balance).getByText("Net activity since statement")).toBeVisible();
  expect(within(balance).getByText("Net transactions")).toBeVisible();
  expect(within(balance).getByText("Unexplained difference")).toBeVisible();
});
