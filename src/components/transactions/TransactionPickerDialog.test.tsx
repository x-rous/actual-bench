import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionPickerDialog } from "./TransactionPickerDialog";
import { fetchNoteTags, fetchPickerPage, PICKER_PAGE_SIZE, type PickedTransaction } from "./transactionPickerQuery";

jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: (select: (s: unknown) => unknown) => select({ id: "conn" }) }));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ getAccounts: async () => [], getCategoryGroups: async () => ({ groups: [{ id: "g", name: "Food", isIncome: false, hidden: false }], categories: [{ id: "c1", name: "Groceries", groupId: "g", isIncome: false, hidden: false }] }), getPayees: async () => [], getTags: async () => [{ id: "t1", name: "rent" }] }) }));
jest.mock("./transactionPickerQuery", () => ({ ...jest.requireActual("./transactionPickerQuery"), fetchPickerPage: jest.fn(), fetchNoteTags: jest.fn() }));
const row = (id: string, extra: Partial<PickedTransaction> = {}): PickedTransaction => ({ id, accountId: "a", accountName: "Bank", date: "2026-02-01", amountMinor: -1000, payeeId: "p", payeeName: `Payee ${id}`, categoryId: null, categoryName: null, notes: null, transferId: null, ...extra });
const page = (rows: PickedTransaction[], fetched = rows.length) => ({ rows, fetched });
const renderPicker = (props: Partial<React.ComponentProps<typeof TransactionPickerDialog>> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TransactionPickerDialog title="Pick" confirmLabel="Use" today="2026-10-24" onClose={jest.fn()} onConfirm={jest.fn()} {...props} />
  </QueryClientProvider>);
const lastState = () => jest.mocked(fetchPickerPage).mock.calls.at(-1)![1];
beforeEach(() => { jest.clearAllMocks(); jest.mocked(fetchNoteTags).mockResolvedValue(["#api", "#rent"]); jest.mocked(fetchPickerPage).mockResolvedValue(page([row("1"), row("2")])); });

it("searches everything by default (All time) and shows only the filters and columns the caller asks for", async () => {
  renderPicker({ filters: ["search", "date"], columns: ["date", "payee", "amount"] });
  await screen.findByText("Payee 1");
  expect(lastState().date).toEqual({ preset: "all" });
  expect(screen.getByLabelText("Search transactions")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Date filter/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Account filter/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Category")).not.toBeInTheDocument();
});
it("starts with every selectable match chosen when asked, and lets one be unticked", async () => {
  const onConfirm = jest.fn();
  renderPicker({ autoSelect: true, onConfirm, disabledReason: (r) => r.id === "2" ? "Already linked" : null });
  await screen.findByText("Payee 1");
  expect(screen.getByText(/1 selected/)).toBeInTheDocument(); // the disabled row is never chosen
  fireEvent.click(screen.getByRole("button", { name: "Use" }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ id: "1" })]));
});
it("shows the caller's rules as locked chips that cannot be removed, and hides the controls they replace", async () => {
  renderPicker({ constraints: { amountSign: "negative", excludeTransfers: true, excludeAccountIds: ["asset"], where: { notes: "x" } }, lockedLabels: { accounts: "Asset accounts excluded", where: "Rule: Rent unit 4" } });
  await screen.findByText("Payee 1");
  for (const label of ["Expenses only", "No transfers", "Asset accounts excluded", "Rule: Rent unit 4"]) expect(screen.getByLabelText(new RegExp(`^${label}\\.`))).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Clear Expenses only filter" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Type" })).not.toBeInTheDocument(); // the sign is fixed
  expect(screen.queryByRole("button", { name: /Transfers filter/ })).not.toBeInTheDocument();
});
it("re-queries as you type, and Clear all returns to the defaults", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.change(screen.getByLabelText("Search transactions"), { target: { value: "rent" } });
  await waitFor(() => expect(lastState().search).toBe("rent"));
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  await waitFor(() => expect(lastState().search).toBe(""));
});
it("filters by tags with Any or All, and applies the choice at once", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByRole("button", { name: "Tags filter" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "#rent" }));
  await waitFor(() => expect(lastState().tags).toMatchObject({ names: ["#rent"], match: "any" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Tag match" })).getByRole("button", { name: "All" }));
  await waitFor(() => expect(lastState().tags).toMatchObject({ names: ["#rent"], match: "all" }));
  expect(screen.getByRole("button", { name: "Clear Tags filter" })).toBeInTheDocument();
});
it("filters by amount without the sign", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByRole("button", { name: "Amount filter" }));
  fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "65,300.00" } });
  await waitFor(() => expect(lastState().amount).toEqual({ mode: "equals", a: 6530000 }));
});
it("reports the selection total, can show only what is selected, and selects a range with shift", async () => {
  jest.mocked(fetchPickerPage).mockResolvedValue(page([row("1"), row("2"), row("3"), row("4")]));
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByRole("checkbox", { name: /Select Payee 1/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Select Payee 3/ }), { shiftKey: true });
  expect(screen.getByText(/3 selected/)).toHaveTextContent("-30.00");
  fireEvent.click(screen.getByRole("checkbox", { name: "Show selected only" }));
  expect(screen.queryByText("Payee 4")).not.toBeInTheDocument();
  expect(screen.getByText("Payee 2")).toBeInTheDocument();
});
it("in single mode a second click on the chosen row confirms it", async () => {
  const onConfirm = jest.fn();
  renderPicker({ multiple: false, onConfirm });
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByText("Payee 2")); // chooses
  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Payee 2")); // confirms
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ id: "2" })]));
});
it("loads the next page when a full page came back, and says the count is so far", async () => {
  jest.mocked(fetchPickerPage).mockImplementation(async (_c, _s, _k, _t, offset) => offset === 0 ? { rows: [row("1"), row("2")], fetched: PICKER_PAGE_SIZE } : { rows: [row("3")], fetched: 1 });
  renderPicker();
  await screen.findByText("Payee 3");
  expect(jest.mocked(fetchPickerPage).mock.calls.map((c) => c[4])).toEqual([0, PICKER_PAGE_SIZE]);
  expect(screen.getByText(/3/, { selector: "span.font-medium" })).toBeInTheDocument(); // three rows over two pages; nothing more to load, so no "so far"
  expect(screen.queryByText(/so far/)).not.toBeInTheDocument();
});
it("keeps Advanced conditions out of the way until asked for", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  expect(screen.queryByLabelText("Conditions")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  expect(await screen.findByLabelText("Conditions")).toBeInTheDocument();
});
it("clears a category filter completely with its ×, including Uncategorized", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByRole("button", { name: "Category filter" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Groceries" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Uncategorized" }));
  await waitFor(() => expect(lastState().categories).toMatchObject({ ids: ["c1"], uncategorized: true }));
  fireEvent.click(screen.getByRole("button", { name: "Clear Category filter" }));
  await waitFor(() => expect(lastState().categories).toEqual({ ids: [], not: false, uncategorized: false }));
});
it("lets every amount comparison be chosen before a value is typed, then applies it", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByRole("button", { name: "Amount filter" }));
  const group = await screen.findByRole("group", { name: "Amount comparison" });
  for (const name of ["Between", "More", "Less", "Equals"]) { fireEvent.click(within(group).getByRole("button", { name })); expect(within(group).getByRole("button", { name })).toHaveAttribute("aria-pressed", "true"); }
  fireEvent.click(within(group).getByRole("button", { name: "Between" }));
  fireEvent.change(screen.getByLabelText("Amount from"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Amount to"), { target: { value: "20.50" } });
  await waitFor(() => expect(lastState().amount).toEqual({ mode: "between", a: 1000, b: 2050 }));
  fireEvent.click(within(group).getByRole("button", { name: "Less" }));
  await waitFor(() => expect(lastState().amount).toEqual({ mode: "less", a: 1000 }));
});
it("offers No payee, and every tag used in the budget even before its rows are loaded", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByRole("button", { name: "Payee filter" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "No payee" }));
  await waitFor(() => expect(lastState().payees).toMatchObject({ none: true }));
  fireEvent.click(screen.getByRole("button", { name: "Tags filter" }));
  expect(await screen.findByRole("checkbox", { name: "#api" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "#rent" })).toBeInTheDocument();
});
it("forgets a typed amount when the filters are cleared", async () => {
  renderPicker();
  await screen.findByText("Payee 1");
  fireEvent.click(screen.getByRole("button", { name: "Amount filter" }));
  fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "30" } });
  await waitFor(() => expect(lastState().amount).toMatchObject({ mode: "equals", a: 3000 }));
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  await waitFor(() => expect(lastState().amount.mode).toBe("any"));
  fireEvent.click(screen.getByRole("button", { name: "Amount filter" }));
  expect(await screen.findByLabelText("Amount")).toHaveValue("");
});
