import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreditCardWorkspace } from "./CreditCardWorkspace";
import { getTransport } from "@/lib/actual";
import type { ActivityRow } from "../lib/activity";
import { creditCardStore, EMPTY_WORKSPACE } from "../lib/store/store";
import { CreditCardUnavailableError, memoryPersistence } from "../lib/store/persistence";
import { EMPTY_CHANGES } from "@/lib/credit-cards/changes";
import { NEW_CARD_DEFAULTS, cardSchema } from "../lib/models";
import { resetCreditCardStore, addStatement, addCard, row as normalised } from "../lib/fixtures/testKit";
import type { StatementFactsInput } from "../lib/models";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { currentSearch, navigationRouter, resetNavigation } from "./testing/navigationMock";
import { axeViolations } from "./testing/axe";

/** Clicks a control whose command commits asynchronously, then lets the commit settle. */
const saveClick = (element: HTMLElement) => act(async () => { fireEvent.click(element); });

jest.mock("next/navigation", () => jest.requireActual("./testing/navigationMock").navigation);
const mockSync = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/actual", () => ({ getTransport: jest.fn(() => ({ sync: mockSync })) }));

const mockDirectory = {
  data: {
    accounts: [{ id: "account", name: "Actual Visa", offBudget: false, closed: false }],
    balances: new Map([["account", { signedBalanceMinor: -315000, debtMinor: 315000, creditMinor: 0 }]]),
    fetchedAt: "2026-10-10T12:00:00Z",
  },
  isFetching: false,
  isError: false,
  refetch: jest.fn(),
};
jest.mock("../hooks/useCreditCardDirectory", () => ({
  useCreditCardDirectory: () => mockDirectory,
  useCreditCardCategories: () => ({
    data: { categories: [{ id: "interest", name: "Card interest" }, { id: "fees", name: "Bank fees" }] },
    isFetching: false, isError: false, refetch: jest.fn(),
  }),
}));
const mockActivity = {
  data: {
    accountId: "account", from: "2026-01-01", to: "2026-12-31", rows: [] as ActivityRow[], counterparts: [] as ActivityRow[],
    issues: [] as string[], fetchedAt: "2026-10-10T12:00:00Z", directBalanceAdjustmentMinor: 0, signature: "empty",
  } as Record<string, unknown> & { rows: ActivityRow[]; counterparts: ActivityRow[]; from: string; to: string; issues: string[] } | undefined,
  isFetching: false,
  isError: false,
  refetch: jest.fn(),
};
jest.mock("../hooks/useCreditCardActivity", () => ({
  useCreditCardPlanAccounts: () => [],
  useCreditCardActivities: (_connection: unknown, cards: unknown[]) => cards.map(() => mockActivity),
}));
jest.mock("@/features/accounts/hooks/useAccountClasses", () => ({
  useAccountClasses: () => ({ available: true, maps: { accounts: new Map([["account", "credit-card"]]), groups: new Map() } }),
}));
const connection: ConnectionInstance = { id: "connection", budgetSyncId: "budget", label: "Budget", mode: "http-api", baseUrl: "http://localhost", apiKey: "test" };

const queryClient = new QueryClient();
function TestWorkspace() {
  return <QueryClientProvider client={queryClient}><CreditCardWorkspace /></QueryClientProvider>;
}

const emptyActivity = () => ({
  accountId: "account", from: "2026-01-01", to: "2026-12-31", rows: [] as ActivityRow[], counterparts: [] as ActivityRow[],
  issues: [] as string[], fetchedAt: "2026-10-10T12:00:00Z", directBalanceAdjustmentMinor: 0, signature: "empty",
});

beforeEach(() => {
  queryClient.clear();
  mockSync.mockReset().mockResolvedValue(undefined);
  mockDirectory.refetch.mockReset().mockResolvedValue({ isError: false });
  mockActivity.refetch.mockReset().mockResolvedValue({ isError: false });
  resetCreditCardStore();
  resetNavigation();
  mockActivity.data = emptyActivity();
  mockActivity.isFetching = false;
  mockActivity.isError = false;
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
  mockDirectory.isFetching = false;
  mockDirectory.isError = false;
  mockDirectory.data.balances = new Map([["account", { signedBalanceMinor: -315000, debtMinor: 315000, creditMinor: 0 }]]);
});

const row = (entry: Parameters<typeof normalised>[0]) => normalised({ accountId: "account", ...entry });

function register(extra: Record<string, unknown> = {}) {
  return addCard(creditCardStore, { budgetSyncId: "budget", accountId: "account", bankTimeZone: "Asia/Dubai", ...extra });
}
/** Cards are rows in the All cards table; a click (or Enter) opens one. */
/** Body rows only: statement tables have two header rows and a totals row. */
const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").filter((row) => row.hasAttribute("data-row-key"));
const openCard = () => fireEvent.click(screen.getByRole("row", { name: /^Actual Visa ·/ }));
const record = (cardId: string, facts: StatementFactsInput) => addStatement(creditCardStore, "budget", cardId, facts);
const september: StatementFactsInput = { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", balanceMinor: 10000, minimumDueMinor: 1000 };

it("confirms deletion in settings, preserves cancellation and restores the card with Undo without Actual writes", async () => {
  const card = register();
  const statement = record(card.id, september);
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const settings = screen.getByRole("dialog", { name: "Card settings" });
  const before = creditCardStore.getState().workspaces;
  const transportCalls = jest.mocked(getTransport).mock.calls.length;
  fireEvent.click(within(settings).getByRole("button", { name: "Delete card" }));
  let confirmation = screen.getByRole("dialog", { name: "Delete credit card?" });
  expect(confirmation).toHaveTextContent("Actual Visa");
  const cancel = within(confirmation).getByRole("button", { name: "Cancel" });
  await waitFor(() => expect(cancel).toHaveFocus());
  fireEvent.click(cancel);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete credit card?" })).not.toBeInTheDocument());
  expect(creditCardStore.getState().workspaces).toBe(before);
  fireEvent.click(within(settings).getByRole("button", { name: "Delete card" }));
  confirmation = screen.getByRole("dialog", { name: "Delete credit card?" });
  await saveClick(within(confirmation).getByRole("button", { name: "Delete card" }));
  expect(creditCardStore.getState().workspaces.budget.cards).toEqual([]);
  await waitFor(() => expect(screen.getByRole("heading", { name: "Credit cards" })).toHaveFocus());
  await saveClick(screen.getByRole("button", { name: "Undo last change" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0].id).toBe(statement.id);
  expect(screen.getByRole("row", { name: /^Actual Visa ·/ })).toBeVisible();
  expect(jest.mocked(getTransport).mock.calls.length).toBe(transportCalls);
  expect(mockSync).not.toHaveBeenCalled();
});

it("registers a card with default billing days, named from the Actual account", async () => {
  render(<TestWorkspace />);
  expect(screen.getByRole("heading", { name: "No credit cards yet" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add card" }));
  await saveClick(within(screen.getByRole("dialog", { name: "Add credit card" })).getByRole("button", { name: "Save card" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Actual Visa" })).toBeInTheDocument();
  expect(screen.getAllByText("3,150.00").length).toBeGreaterThan(0);
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ closingDay: 10, dueRule: { kind: "day-of-month", value: 3 }, billingDaysSource: "default" });
});

it("records the first statement, updates default billing days from it and opens its review", async () => {
  register({ closingDay: 10, dueRule: { kind: "day-of-month", value: 3 }, billingDaysSource: "default" });
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  fireEvent.click(screen.getByRole("button", { name: "Enter statement" }));
  const dialog = screen.getByRole("dialog", { name: "Add statement" });
  for (const [label, value] of [["Period start", "2026-09-05"], ["Closing date", "2026-10-04"], ["Payment due date", "2026-10-29"]]) {
    const input = within(dialog).getByLabelText(label);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }
  fireEvent.change(within(dialog).getByLabelText("Statement balance"), { target: { value: "2,850.00" } });
  fireEvent.change(within(dialog).getByLabelText("Minimum due"), { target: { value: "150.00" } });
  await saveClick(within(dialog).getByRole("button", { name: "Save and review" }));
  expect(screen.getByRole("region", { name: "Review statement · 04 Oct 2026" })).toBeInTheDocument();
  const workspace = creditCardStore.getState().workspaces.budget;
  expect(workspace.statements[0]).toMatchObject({ balanceMinor: 285000, minimumDueMinor: 15000, reviewState: "not_reviewed" });
  expect(workspace.cards[0]).toMatchObject({ closingDay: 4, dueRule: { kind: "day-of-month", value: 29 }, billingDaysSource: "statement" });
});

it("keeps editor drafts and figures through a refresh, and separates budgets", () => {
  const card = register();
  record(card.id, { ...september, balanceMinor: 285000, minimumDueMinor: 15000 });
  const view = render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Credit limit (optional)"), { target: { value: "123.45" } });
  mockDirectory.isFetching = true;
  mockActivity.isFetching = true;
  view.rerender(<TestWorkspace />);
  expect(screen.getByLabelText("Credit limit (optional)")).toHaveValue("123.45");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  // UI-2: figures stay visible while refreshing; only saving actions wait.
  expect(screen.getAllByText("3,150.00").length).toBeGreaterThan(0);
  const other: ConnectionInstance = { ...connection, id: "other", budgetSyncId: "other-budget" };
  act(() => useConnectionStore.setState({ instances: [connection, other], activeInstanceId: other.id }));
  expect(screen.queryByText(/Actual Visa/)).not.toBeInTheDocument();
  act(() => useConnectionStore.setState({ activeInstanceId: connection.id }));
  // The open card is in the URL, so returning to the budget returns to the card.
  expect(screen.getByRole("heading", { name: "Actual Visa" })).toBeInTheDocument();
});

it("shows an amber notice and keeps the last data when a refresh fails, and permits retry", async () => {
  mockSync.mockRejectedValueOnce(new Error("Offline"));
  register();
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't refresh"));
  expect(mockDirectory.refetch).not.toHaveBeenCalled();
  expect(screen.getAllByText("3,150.00").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mockDirectory.refetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each(["http-api", "browser-api"] as const)("syncs %s before refreshing and keeps an open editor draft", async (mode) => {
  useConnectionStore.setState({ instances: [{ ...connection, mode } as ConnectionInstance], activeInstanceId: connection.id });
  let finishSync!: () => void;
  mockSync.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSync = resolve; }));
  register();
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Credit limit (optional)"), { target: { value: "234.56" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh", hidden: true }));
  await waitFor(() => expect(getTransport).toHaveBeenCalledWith(expect.objectContaining({ mode })));
  expect(mockDirectory.refetch).not.toHaveBeenCalled();
  await act(async () => { finishSync(); });
  await waitFor(() => expect(mockDirectory.refetch).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Credit limit (optional)")).toHaveValue("234.56");
});

it("prepares estimates from Actual, pre-fills the editor with a check hint, and supports Undo", async () => {
  const card = register();
  const { id, revision, ...input } = card;
  creditCardStore.getState().updateCard("budget", id, revision, { ...input, closingDay: 4, dueRule: { kind: "days-after-close", value: 25 }, minimumPercentBps: 200, minimumFloorMinor: 2500 });
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Enter statement" }));
  expect(screen.getByLabelText("Statement balance")).toHaveValue("3,150.00");
  expect(screen.getByLabelText("Minimum due")).toHaveValue("63.00");
  expect(screen.getAllByText("Pre-filled from Actual - check each marked value against your statement")).toHaveLength(1);
  expect(screen.getAllByText("(pre-filled from Actual)").length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await saveClick(screen.getByRole("button", { name: "Undo last change" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].closingDay).toBeNull();
  expect(screen.getByText("Last change undone")).toBeInTheDocument();
});

it("shows payment notes and funding details, and the bill each payment pays", async () => {
  const card = register();
  record(card.id, { periodStart: "2026-08-05", closingDate: "2026-09-04", dueDate: "2026-09-29", balanceMinor: 10000, minimumDueMinor: 1000 });
  const payment = row({ id: "payment", date: "2026-10-01", amount: 10000, payeeName: "Checking transfer", notes: "Monthly card repayment", transferId: "funding" });
  mockActivity.data!.rows = [payment];
  mockActivity.data!.counterparts = [normalised({ id: "funding", accountId: "checking", date: "2026-10-01", amount: -10000, notes: "Funding account memo", transferId: "payment" })];
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Payments/ }));
  const payments = screen.getByRole("table", { name: "Payments to Actual Visa" });
  const first = within(payments).getAllByRole("row")[1];
  expect(first).toHaveTextContent("04 Sep");
  expect(first).toHaveTextContent("2 days late");
  expect(within(payments).getByText("Monthly card repayment")).toBeVisible();
  fireEvent.click(first);
  const details = screen.getByRole("complementary", { name: /^Payment 01 Oct/ });
  expect(currentSearch().get("payment")).toBe("payment");
  expect(within(details).getByText("Funding account memo")).toBeVisible();
  expect(within(details).getByText("Left to pay after this payment")).toBeVisible();
  fireEvent.keyDown(details, { key: "Escape" });
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  await waitFor(() => expect(first).toHaveFocus());
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  const statements = screen.getByRole("table", { name: "Statements for Actual Visa" });
  expect(bodyRows(statements)[0]).toHaveTextContent("Paid late");
});

it("shows a pending payment as pending in Payments and Statements", () => {
  const card = register();
  record(card.id, { periodStart: "2026-08-05", closingDate: "2026-09-04", dueDate: "2026-09-29", balanceMinor: 10000, minimumDueMinor: 1000 });
  mockActivity.data!.rows = [
    row({ id: "pending", date: "2026-09-20", amount: 10000, payeeName: "Checking", cleared: false, transferId: "missing" }),
    row({ id: "early", date: "2026-04-01", amount: 10000, payeeName: "Checking", transferId: "missing-early" }),
  ];
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Payments/ }));
  const rows = within(screen.getByRole("table", { name: "Payments to Actual Visa" })).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("Pending");
  expect(rows[1]).toHaveTextContent("04 Sep");
  expect(rows[2]).toHaveTextContent("Before tracking");
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  const statements = screen.getByRole("table", { name: "Statements for Actual Visa" });
  expect(bodyRows(statements)[0]).toHaveTextContent("Pending");
});

it("labels a minimum-paid bill with a carried balance, not overdue", () => {
  const card = register();
  record(card.id, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-01", balanceMinor: 10000, minimumDueMinor: 2500 });
  mockActivity.data!.rows = [row({ id: "payment", date: "2026-09-01", amount: 3000, payeeName: "Checking", transferId: "peer" })];
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  expect(screen.getAllByText("Minimum paid").length).toBeGreaterThan(0);
  expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
});

it("exposes reset and deletion with confirmation and Undo without changing Actual", async () => {
  const card = register();
  const statement = record(card.id, september);
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  fireEvent.click(screen.getByRole("button", { name: "Actions for statement 30 Sep 2026" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete statement" }));
  const dialog = screen.getByRole("dialog", { name: "Delete statement 30 Sep 2026?" });
  await saveClick(within(dialog).getByRole("button", { name: "Delete statement" }));
  expect(creditCardStore.getState().workspaces.budget.statements).toEqual([]);
  await saveClick(screen.getByRole("button", { name: "Undo last change" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0].id).toBe(statement.id);
  expect(mockSync).not.toHaveBeenCalled();
});

it("shows the tracking start in settings, clearable, separate from the loading range", async () => {
  const card = register({ firstTrackedStatementDate: "2026-09-30" });
  record(card.id, september);
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const field = screen.getByLabelText("First tracked statement");
  expect(field).toHaveValue("30 Sep 2026");
  fireEvent.change(field, { target: { value: "" } });
  fireEvent.blur(field);
  await saveClick(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].firstTrackedStatementDate).toBeNull();
});

it("lists what needs attention on the Overview and filters Statements to it, in the URL", () => {
  const card = register();
  record(card.id, { ...september, previousBalanceMinor: 0 });
  mockActivity.data!.rows = [row({ id: "boundary", date: "2026-09-30", amount: -10000, payeeName: "Cutoff shop" })];
  render(<TestWorkspace />);
  openCard();
  const attention = screen.getByRole("region", { name: "Needs your attention" });
  expect(attention).toHaveTextContent("Needs your attention (1)");
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Needs attention/ }));
  expect(currentSearch().get("view")).toBe("attention");
  const statements = screen.getByRole("table", { name: "Statements for Actual Visa" });
  expect(bodyRows(statements)).toHaveLength(1);
  expect(within(statements).getByText("To review 1")).toBeVisible();
});

it("shows loading and error states on the Activity tab, never a blank tab (UI-17)", () => {
  register();
  mockActivity.data = undefined;
  mockActivity.isFetching = true;
  const view = render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Activity/ }));
  expect(screen.getByRole("status", { name: "Loading card activity" })).toBeInTheDocument();
  mockActivity.isFetching = false;
  mockActivity.isError = true;
  view.rerender(<TestWorkspace />);
  const alert = screen.getAllByRole("alert").find((element) => element.textContent?.includes("Card activity couldn't be read"))!;
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(mockActivity.refetch).toHaveBeenCalled();
});

it("shows cashback as a credit and keeps it out of Payments", () => {
  const card = register({ cashbackCategoryId: "cashback" });
  record(card.id, { periodStart: "2026-08-01", closingDate: "2026-08-31", dueDate: "2026-09-20", balanceMinor: 10000, minimumDueMinor: 1000 });
  mockActivity.data!.rows = [
    row({ id: "reward", date: "2026-09-10", amount: 500, payeeName: "Card reward credit", categoryId: "cashback", categoryName: "Rewards" }),
    row({ id: "payment", date: "2026-09-10", amount: 1000, payeeName: "Funding account", transferId: "peer" }),
  ];
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Payments/ }));
  const payments = screen.getByRole("table", { name: "Payments to Actual Visa" });
  expect(within(payments).getAllByRole("row")).toHaveLength(2);
  expect(within(payments).queryByText("Card reward credit")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /^Activity/ }));
  const reward = within(screen.getByRole("table", { name: "Activity for Actual Visa" })).getByText("Card reward credit").closest("tr")!;
  expect(within(reward).getByText("Cashback")).toBeVisible();
});

it("loads saved records from the app database, and offers Retry when it is unavailable", async () => {
  const saved = memoryPersistence();
  let fail = true;
  creditCardStore.setState({ status: {}, persistence: {
    read: (budget) => fail ? Promise.reject(new Error("The app database is locked")) : Promise.resolve(saved.read(budget)),
    commit: saved.commit,
  } });
  saved.commit("budget", { ...EMPTY_CHANGES, cards: { put: [{ ...cardSchema.parse({ ...NEW_CARD_DEFAULTS, budgetSyncId: "budget", accountId: "account", bankTimeZone: "UTC", id: "stored", revision: 1 }) }], remove: [] } });
  render(<TestWorkspace />);
  expect(screen.getByRole("status", { name: "Loading credit cards" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Credit-card data unavailable" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("The app database is locked");
  expect(screen.queryByRole("button", { name: "Add card" })).not.toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("row", { name: /^Actual Visa ·/ })).toBeVisible();
});

it("keeps the draft open with the reason when the app database rejects a save", async () => {
  creditCardStore.setState({ persistence: { read: () => ({ ...EMPTY_WORKSPACE }), commit: () => Promise.reject(new CreditCardUnavailableError()) } });
  render(<TestWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Add card" }));
  const dialog = screen.getByRole("dialog", { name: "Add credit card" });
  await saveClick(within(dialog).getByRole("button", { name: "Save card" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Credit-card data unavailable");
  expect(creditCardStore.getState().workspaces.budget.cards).toEqual([]);
});

it("keeps the card, tab and panel in the URL so Back works and views are linkable (§9.2)", async () => {
  const card = register();
  const statement = record(card.id, september);
  const { container } = render(<TestWorkspace />);
  openCard();
  expect(currentSearch().get("card")).toBe(card.id);
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  expect(currentSearch().get("tab")).toBe("statements");
  fireEvent.click(bodyRows(screen.getByRole("table", { name: "Statements for Actual Visa" }))[0]);
  expect(currentSearch().get("statement")).toBe(statement.id);
  expect(screen.getByRole("complementary", { name: "Statement 30 Sep" })).toBeVisible();
  expect(await axeViolations(container)).toEqual([]);
  act(() => navigationRouter.back());
  expect(screen.getByRole("tab", { name: /^Overview/ })).toHaveAttribute("aria-selected", "true");
  act(() => navigationRouter.back());
  expect(screen.getByRole("heading", { name: "Credit cards" })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("row", { name: /^Actual Visa ·/ })).toHaveFocus());
});

it("opens the Credit cards guide on the current screen's section, with the glossary one click away", async () => {
  register();
  render(<TestWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "Guide" }));
  const guide = screen.getByRole("dialog", { name: "Credit cards guide" });
  expect(within(guide).getByRole("heading", { name: "Getting started" })).toBeVisible();
  fireEvent.click(within(guide).getByRole("button", { name: "Glossary" }));
  expect(guide).toHaveTextContent("your bank may call this Total Payment Due");
  fireEvent.change(within(guide).getByRole("textbox", { name: "Search the glossary" }), { target: { value: "plan account" } });
  fireEvent.click(within(guide).getAllByRole("button", { name: "Instalment plans →" })[0]);
  expect(within(guide).getByRole("tablist", { name: "How the plan is recorded in Actual" })).toBeVisible();
  expect(await axeViolations(guide)).toEqual([]);
  fireEvent.keyDown(guide, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Credit cards guide" })).not.toBeInTheDocument());
});

it("shows one status-based action per statement row and returns to the reviewed row with the panel closed", async () => {
  const card = register();
  const statement = record(card.id, { ...september, previousBalanceMinor: 0 });
  mockActivity.data!.rows = [row({ id: "boundary", date: "2026-09-30", amount: -10000, payeeName: "Cutoff shop" })];
  render(<TestWorkspace />);
  openCard();
  fireEvent.click(screen.getByRole("tab", { name: /^Statements/ }));
  const table = screen.getByRole("table", { name: "Statements for Actual Visa" });
  const saved = bodyRows(table).find((item) => item.getAttribute("data-row-key") === statement.id)!;
  fireEvent.click(within(saved).getByRole("button", { name: "Review" }));
  expect(currentSearch().get("review")).toBe(statement.id);
  fireEvent.click(screen.getByRole("button", { name: "Statements" }));
  await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Statements for Actual Visa" }))
    .find((item) => item.getAttribute("data-row-key") === statement.id)).toHaveFocus());
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(currentSearch().get("statement")).toBeNull();
});

it("doesn't pop up after routine saves, only after destructive ones", async () => {
  const card = register();
  const statement = record(card.id, september);
  render(<TestWorkspace />);
  openCard();
  await act(async () => { await creditCardStore.getState().resetReview("budget", statement.id, statement.revision); });
  expect(screen.getByText(/Transaction review reset/)).toBeVisible();
  const latest = creditCardStore.getState().workspaces.budget.cards[0];
  const { id, revision, ...input } = latest;
  await act(async () => { await creditCardStore.getState().updateCard("budget", id, revision, { ...input, creditLimitMinor: 1 }); });
  expect(screen.queryByText("Card settings saved")).not.toBeInTheDocument();
});
