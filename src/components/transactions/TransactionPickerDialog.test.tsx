import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionPickerDialog } from "./TransactionPickerDialog";
import { fetchPickerTransactions, type PickedTransaction } from "./transactionPickerQuery";

jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: (select: (s: unknown) => unknown) => select({ id: "conn" }) }));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ getAccounts: async () => [], getCategoryGroups: async () => ({ groups: [], categories: [] }), getPayees: async () => [] }) }));
jest.mock("./transactionPickerQuery", () => ({ ...jest.requireActual("./transactionPickerQuery"), fetchPickerTransactions: jest.fn() }));
const row = (id: string, extra: Partial<PickedTransaction> = {}): PickedTransaction => ({ id, accountId: "a", accountName: "Bank", date: "2026-02-01", amountMinor: -1000, payeeId: "p", payeeName: `Payee ${id}`, categoryId: null, categoryName: null, notes: null, transferId: null, ...extra });
const renderPicker = (props: Partial<React.ComponentProps<typeof TransactionPickerDialog>> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TransactionPickerDialog title="Pick" confirmLabel="Use" today="2026-10-24" onClose={jest.fn()} onConfirm={jest.fn()} {...props} />
  </QueryClientProvider>);
beforeEach(() => jest.mocked(fetchPickerTransactions).mockResolvedValue([row("1"), row("2")]));

it("shows only the filters and columns the caller asks for", async () => {
  renderPicker({ filters: ["search"], columns: ["date", "payee", "amount"] });
  await screen.findByText("Payee 1");
  expect(screen.getByLabelText("Search payee, category or Notes")).toBeInTheDocument();
  expect(screen.queryByLabelText("Filter by accounts")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("From date")).not.toBeInTheDocument();
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
