import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BudgetImportDialog } from "./BudgetImportDialog";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import type { LoadedCategory, LoadedGroup, LoadedMonthState } from "../types";

jest.mock("@/store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1" })),
  selectActiveInstance: jest.fn(),
}));

/** Legacy Tracking income budgets (reflect_budgets): month → category → amount. */
let mockIncomeBudgets = new Map<string, Map<string, number>>();
jest.mock("../hooks/useIncomeBudgets", () => ({
  incomeBudgetsQueryOptions: (_connection: unknown, ids: string[]) => ({
    queryKey: ["income-budgets", "conn-1", [...ids].sort().join(",")],
    queryFn: async () => mockIncomeBudgets,
  }),
}));

/** What the server holds now, per month; a month missing here fails to load. */
let mockServerMonths: Record<string, LoadedMonthState> = {};
jest.mock("../lib/monthDataQuery", () => ({
  budgetMonthDataQueryOptions: (_connection: unknown, m: string) => ({
    queryKey: ["budget-month-data", "conn-1", m],
    queryFn: async () => {
      const state = mockServerMonths[m];
      if (!state) throw new Error("offline");
      return state;
    },
  }),
}));

function category(id: string, name: string, budgeted: number): LoadedCategory {
  return {
    id,
    name,
    groupId: "g1",
    groupName: "Food",
    isIncome: false,
    hidden: false,
    budgeted,
    actuals: 0,
    balance: 0,
    carryover: false,
  };
}

const group: LoadedGroup = {
  id: "g1",
  name: "Food",
  isIncome: false,
  hidden: false,
  categoryIds: ["c1"],
  budgeted: 0,
  actuals: 0,
  balance: 0,
};

function month(m: string, cats: LoadedCategory[]): LoadedMonthState {
  return {
    summary: {
      month: m,
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: 0,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: 0,
      totalBalance: 0,
    },
    groupsById: { g1: { ...group, categoryIds: cats.map((c) => c.id) } },
    categoriesById: Object.fromEntries(cats.map((c) => [c.id, c])),
    groupOrder: ["g1"],
  };
}

describe("BudgetImportDialog", () => {
  beforeEach(() => {
    useBudgetEditsStore.getState().discardAll();
    useBudgetEditsStore.setState({ budgetMode: "envelope" });
  });

  it("imports pasted spreadsheet cells, matching a category created mid-window and skipping unchanged cells", async () => {
    const jan = month("2026-01", [category("c1", "Groceries", 45000)]);
    // "Dining" only exists from February, so the first month does not list it.
    const feb = month("2026-02", [
      category("c1", "Groceries", 47500),
      category("c2", "Dining", 0),
    ]);
    mockServerMonths = { "2026-01": jan, "2026-02": feb };
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], jan);
    client.setQueryData(["budget-month-data", "conn-1", "2026-02"], feb);

    render(
      <QueryClientProvider client={client}>
        <BudgetImportDialog
          availableMonths={["2026-01", "2026-02"]}
          activeMonths={["2026-01", "2026-02"]}
          categories={Object.values(jan.categoriesById)}
          groups={[group]}
          categoriesById={jan.categoriesById}
          onClose={jest.fn()}
        />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByLabelText(/Or paste cells/), {
      target: {
        value:
          "Group Name\tCategory Name\tJan-26\tFeb-26\tNotes\n" +
          "Food\tGroceries\t450.00\t$500.00\tweekly\n" +
          "Food\tDining\t\t(not sure)\t\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use pasted data" }));

    expect(await screen.findByText("Review Matches")).toBeInTheDocument();
    expect(screen.getByText(/tab separated/)).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText(/1 cell is not an\s+amount/)).toBeInTheDocument();
    expect(screen.getAllByText("Exact")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Preview 2 approved rows/ }));
    expect(await screen.findByText("Preview Changes")).toBeInTheDocument();
    // Jan Groceries already holds 450.00; only Feb Groceries changes, from
    // its own month's saved 475.00.
    expect(screen.getByText(/1 already match/)).toBeInTheDocument();
    // The row and the net total both show it.
    expect(screen.getAllByText("+25.00")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Stage 1 import changes" }));
    expect(useBudgetEditsStore.getState().edits).toEqual({
      "2026-02:c1": {
        month: "2026-02",
        categoryId: "c1",
        nextBudgeted: 50000,
        previousBudgeted: 47500,
        source: "import",
      },
    });
  });

  function renderDialog(client: QueryClient, jan: LoadedMonthState) {
    render(
      <QueryClientProvider client={client}>
        <BudgetImportDialog
          availableMonths={["2026-01", "2026-02"]}
          activeMonths={["2026-01", "2026-02"]}
          categories={Object.values(jan.categoriesById)}
          groups={[group]}
          categoriesById={jan.categoriesById}
          onClose={jest.fn()}
        />
      </QueryClientProvider>
    );
  }

  async function pasteAndPreview(text: string) {
    fireEvent.change(screen.getByLabelText(/Or paste cells/), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Use pasted data" }));
    expect(await screen.findByText("Review Matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preview 1 approved row/ }));
  }

  it("compares with the server's current value, not a stale cached one", async () => {
    const cached = month("2026-01", [category("c1", "Groceries", 45000)]);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], cached);
    // Another client has since saved 500.00.
    mockServerMonths = { "2026-01": month("2026-01", [category("c1", "Groceries", 50000)]) };
    renderDialog(client, cached);

    await pasteAndPreview("Group Name\tCategory Name\tJan-26\nFood\tGroceries\t450.00\n");

    expect(await screen.findByText("Preview Changes")).toBeInTheDocument();
    expect(screen.getAllByText("−50.00").length).toBeGreaterThan(0);
  });

  it("does not preview a month whose saved amounts failed to load", async () => {
    const jan = month("2026-01", [category("c1", "Groceries", 45000)]);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], jan);
    client.setQueryData(["budget-month-data", "conn-1", "2026-02"], jan);
    mockServerMonths = { "2026-01": jan };
    renderDialog(client, jan);

    await pasteAndPreview("Group Name\tCategory Name\tFeb-26\nFood\tGroceries\t450.00\n");

    expect(await screen.findByText(/Could not load the saved amounts for Feb 26/)).toBeInTheDocument();
    expect(screen.queryByText("Preview Changes")).not.toBeInTheDocument();
  });

  it("compares Tracking income with the saved budget older servers keep apart", async () => {
    useBudgetEditsStore.setState({ budgetMode: "tracking" });
    const salary = { ...category("c9", "Salary", 0), groupId: "g9", groupName: "Income", isIncome: true };
    const jan: LoadedMonthState = {
      ...month("2026-01", [salary]),
      groupsById: { g9: { ...group, id: "g9", name: "Income", isIncome: true, categoryIds: ["c9"] } },
      groupOrder: ["g9"],
      // The month payload has no income budget for Salary.
      incomeBudgetFallbackIds: ["c9"],
    };
    mockServerMonths = { "2026-01": jan };
    mockIncomeBudgets = new Map([["2026-01", new Map([["c9", 500000]])]]);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], jan);
    render(
      <QueryClientProvider client={client}>
        <BudgetImportDialog
          availableMonths={["2026-01"]}
          activeMonths={["2026-01"]}
          categories={[salary]}
          groups={[{ ...group, id: "g9", name: "Income", isIncome: true, categoryIds: ["c9"] }]}
          categoriesById={jan.categoriesById}
          onClose={jest.fn()}
        />
      </QueryClientProvider>
    );

    await pasteAndPreview("Group Name\tCategory Name\tJan-26\nIncome\tSalary\t0.00\n");

    expect(await screen.findByText("Preview Changes")).toBeInTheDocument();
    expect(screen.getAllByText("−5,000.00").length).toBeGreaterThan(0);
  });
});
