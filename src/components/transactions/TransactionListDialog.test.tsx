import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionListDialog } from "./TransactionListDialog";
import { fetchFacet, fetchNoteTags, fetchPickerPage, type PickedTransaction } from "./transactionPickerQuery";

jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: (select: (s: unknown) => unknown) => select({ id: "conn" }) }));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ getAccounts: async () => [], getCategoryGroups: async () => ({ groups: [], categories: [] }), getPayees: async () => [], getTags: async () => [] }) }));
jest.mock("./transactionPickerQuery", () => ({ ...jest.requireActual("./transactionPickerQuery"), fetchPickerPage: jest.fn(), fetchNoteTags: jest.fn(), fetchFacet: jest.fn() }));

const row = (id: string, amountMinor: number): PickedTransaction => ({ id, accountId: "a", accountName: "Bank", date: "2026-02-01", amountMinor, payeeId: "p", payeeName: `Payee ${id}`, categoryId: null, categoryName: null, notes: null, transferId: null });
const renderList = (expectedMinor: number | null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TransactionListDialog title="Money spent" today="2026-10-24" expectedMinor={expectedMinor} onClose={jest.fn()} />
  </QueryClientProvider>);
beforeEach(() => { jest.clearAllMocks(); jest.mocked(fetchNoteTags).mockResolvedValue([]); jest.mocked(fetchFacet).mockImplementation(async (_c, _s, _k, _t, dim) => dim === "month" ? [{ key: "2026-02", amountMinor: -3500, count: 2 }] : [{ key: "c1", amountMinor: -3500, count: 2 }]); jest.mocked(fetchPickerPage).mockResolvedValue({ rows: [row("1", -1000), row("2", -2500)], fetched: 2 }); });

describe("read-only transaction list", () => {
  it("lists the entries without anything to select, and says when they match the figure", async () => {
    renderList(-3500);
    await screen.findByText("Payee 1");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/Matches the figure/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("says plainly when the entries do not add up to the figure", async () => {
    renderList(-3000);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Differs from the figure by/);
  });
});

describe("charts in the list", () => {
  it("are off unless asked for, and narrow the list and the verdict when a row is selected", async () => {
    const { unmount } = renderList(-3500);
    await screen.findByText("Payee 1");
    expect(screen.queryByRole("region", { name: "Charts" })).not.toBeInTheDocument();
    unmount();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TransactionListDialog title="Money spent" today="2026-10-24" expectedMinor={-3500} insights={{ kind: "spending" }} onClose={jest.fn()} />
      </QueryClientProvider>);
    await screen.findByRole("region", { name: "Charts" });
    expect(await screen.findByText(/Matches the figure/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /unknown category/i }));
    await waitFor(() => expect(JSON.stringify(jest.mocked(fetchPickerPage).mock.calls.at(-1)![2].where)).toContain('"category":{"$oneof":["c1"]}'));
    expect(await screen.findByText(/Part of the figure/)).toBeInTheDocument();
    // One result bar: what is listed now against the whole, with the selection as a chip, and one Clear all for everything.
    expect(await screen.findByText(/of 2 entries/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove Category:/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Remove Category:/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hide charts" }));
    expect(screen.queryByRole("region", { name: "Charts" })).not.toBeInTheDocument();
  });
});

it("loads long named memberships in bounded ID batches and totals only matching evidence", async () => {
  const ids = Array.from({ length: 301 }, (_, index) => `wanted-${index}`);
  const database = [...Array.from({ length: 20_001 }, (_, index) => row(`unrelated-${index}`, 1)), row("wanted-300", -3500)];
  jest.mocked(fetchPickerPage).mockImplementation(async (_connection, _state, constraints) => {
    const allowed = ((constraints.where as { id: { $oneof: string[] } }).id.$oneof);
    const rows = database.filter((item) => allowed.includes(item.id));
    return { rows, fetched: rows.length };
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TransactionListDialog title="Statement evidence" today="2026-10-24" constraints={{ namedIds: ids }} expectedMinor={-3500} onClose={jest.fn()} /></QueryClientProvider>);
  expect(await screen.findByText("Payee wanted-300")).toBeVisible();
  expect(screen.queryByText("Payee unrelated-0")).not.toBeInTheDocument();
  expect(await screen.findByText(/Matches the figure/)).toBeInTheDocument();
  expect(jest.mocked(fetchPickerPage)).toHaveBeenCalledTimes(2);
});
