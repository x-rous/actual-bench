/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { placeActuals, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { createPlanDocument, createRow } from "@/lib/cashflow-planning/document";
import { requestFor } from "../lib/transactions";
import { TransactionsDialog } from "./TransactionsDialog";

const runQuery = jest.fn();
jest.mock("@/lib/api/query", () => ({ runQuery: (...args: unknown[]) => runQuery(...args) }));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ getPayees: async () => [{ id: "p1", name: "Corner Shop" }] }) }));
jest.mock("@/store/connection", () => ({ selectActiveInstance: () => null, useConnectionStore: () => ({ id: "c1" }) }));

const row = (id: string, date: string, amount: number) => ({ id, date, amount, account: "bank", category: "groceries", notes: `note ${id}`, payee: "p1", "payee.transfer_acct": null });

function setup(listed: ReturnType<typeof row>[]) {
  runQuery.mockResolvedValue({ data: listed });
  const food = createRow({ name: "Food", section: "expenses", links: { categories: ["groceries"] } });
  const doc = { ...createPlanDocument({ name: "T", startMonth: "2026-01", years: 1 }), rows: [food] };
  const snapshot = {
    today: "2026-03-15",
    accounts: [{ id: "bank", name: "Bank", offBudget: false, closed: false, accountClass: "bank", access: "available", excluded: false, groupName: null }],
    categories: [{ id: "groceries", name: "Groceries", groupId: "g", groupName: "Living", isIncome: false, hidden: false }],
    movement: [{ month: "2026-03", accountId: "bank", categoryId: "groceries", transferAccountId: null, amountMinor: -5_000, count: 2 }],
    startingBalances: [], uncategorizedIn: [], transfersIn: [], schedules: [], loans: {}, loanCosts: [], shifts: [], budget: null,
  } as Snapshot;
  const placed = placeActuals(doc, snapshot);
  const line = { kind: "row" as const, key: `row:${food.id}`, row: food, result: { values: [], actual: [], plan: [], source: [], typical: null }, aggregate: "sum" as const, depth: 1 as const };
  const request = requestFor(doc, snapshot, placed, line, ["2026-03"], "Mar 2026")!;
  const onEdit = jest.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TransactionsDialog request={request} doc={doc} snapshot={snapshot} placed={placed} onEdit={onEdit} onClose={() => {}} />
    </QueryClientProvider>,
  );
  return { onEdit };
}

describe("the transactions dialog", () => {
  it("says when the list matches the figure, and when it does not", async () => {
    setup([row("a", "2026-03-05", -3_000), row("b", "2026-03-10", -2_000)]);
    expect(await screen.findByText(/Matches the figure/)).toBeInTheDocument();
  });

  it("flags a list that does not add up to the figure", async () => {
    setup([row("a", "2026-03-05", -3_000)]);
    expect(await screen.findByText(/Differs from the figure by/)).toBeInTheDocument();
  });

  it("groups with subtotals, and counts the chosen transactions in another month", async () => {
    const { onEdit } = setup([row("a", "2026-03-05", -3_000), row("b", "2026-03-10", -2_000)]);
    await screen.findByText("note a");
    fireEvent.click(screen.getByRole("button", { name: "Category" }));
    expect(screen.getByRole("button", { name: /Groceries/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("button", { name: /Bank/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select all the transactions shown"));
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "The month before" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
  });
});
