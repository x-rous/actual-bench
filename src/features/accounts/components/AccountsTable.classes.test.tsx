import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStagedStore } from "../../../store/staged";
import type { AccountClassRecord } from "@/lib/app-db/types";
import type { AccountClassChange } from "@/lib/account-class";
import { toast } from "sonner";
import { AccountsTable } from "./AccountsTable";
import { AccountGroupsDialog } from "./AccountGroupsDialog";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/accounts",
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1", budgetSyncId: "budget-1" })),
  selectActiveInstance: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
const mockBalances = new Map<string, number>();
jest.mock("../hooks/useAccountBalances", () => ({ useAccountBalances: () => ({ data: mockBalances }) }));
jest.mock("../hooks/useAccountGroups", () => ({ useAccountGroups: () => ({ supported: true }) }));
jest.mock("@/hooks/useAllNotes", () => ({ useAllNotes: () => ({ data: undefined }) }));

function fakeServer() {
  const rows = new Map<string, AccountClassRecord>();
  const body = () => ({ ok: true, json: async () => ({ accountClasses: [...rows.values()] }) });
  global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      for (const c of (JSON.parse(String(init.body)) as { changes: AccountClassChange[] }).changes) {
        const key = `${c.scope}:${c.id}`;
        if (c.accountClass) rows.set(key, { budgetSyncId: "budget-1", scope: c.scope, accountId: c.id, accountClass: c.accountClass, updatedAt: "now" });
        else rows.delete(key);
      }
    }
    return body();
  }) as unknown as typeof fetch;
}

describe("accounts table and Groups dialog share account classes", () => {
  beforeEach(() => {
    mockBalances.clear();
    useStagedStore.getState().discardAll();
    useStagedStore.getState().loadAccounts([{ id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" }]);
    useStagedStore.getState().loadAccountGroups([{ id: "g1", name: "Everyday" }]);
    fakeServer();
  });

  it("shows a class set on a group against its accounts straight away", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <AccountsTable onCreateRule={jest.fn()} onDeleteIntentChange={jest.fn()} onInspectIdChange={jest.fn()} />
        <AccountGroupsDialog open onOpenChange={() => undefined} />
      </QueryClientProvider>
    );
    // The open dialog hides the table from the accessibility tree, so the table is queried with `hidden`.
    await screen.findByRole("combobox", { name: "Account class of Checking", hidden: true });

    fireEvent.click(await screen.findByRole("combobox", { name: "Account class of group Everyday" }));
    const option = await screen.findByRole("option", { name: "Bank" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.mouseUp(option);
    fireEvent.click(option);

    await waitFor(() => expect(screen.getByText("Inherited")).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "Account class of Checking", hidden: true })).not.toBeInTheDocument();
  });

  it("shows a class chosen on an account in its own row straight away", async () => {
    useStagedStore.getState().loadAccounts([{ id: "a2", name: "Wallet", offBudget: false, closed: false, groupId: null }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <AccountsTable onCreateRule={jest.fn()} onDeleteIntentChange={jest.fn()} onInspectIdChange={jest.fn()} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Account class of Wallet" })).toBeEnabled());
    fireEvent.click(screen.getByRole("combobox", { name: "Account class of Wallet" }));
    const option = await screen.findByRole("option", { name: "Cash" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.mouseUp(option);
    fireEvent.click(option);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Account class of Wallet" })).toHaveTextContent("Cash"));
  });

  async function pickOption(trigger: HTMLElement, name: string) {
    fireEvent.click(trigger);
    const option = await screen.findByRole("option", { name });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.mouseUp(option);
    fireEvent.click(option);
  }

  function renderTable() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <AccountsTable onCreateRule={jest.fn()} onDeleteIntentChange={jest.fn()} onInspectIdChange={jest.fn()} />
      </QueryClientProvider>
    );
  }

  const puts = () =>
    (global.fetch as jest.Mock).mock.calls
      .filter((c) => c[1]?.method === "PUT")
      .map((c) => (JSON.parse(String(c[1].body)) as { changes: unknown[] }).changes);

  it("sets a class on the selected accounts and leaves grouped ones to their group", async () => {
    useStagedStore.getState().loadAccounts([
      { id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" },
      { id: "a2", name: "Wallet", offBudget: false, closed: false, groupId: null },
      { id: "a3", name: "Petty", offBudget: false, closed: false, groupId: null },
    ]);
    // The group has a class, so its member "Checking" inherits it.
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ accountClasses: [{ budgetSyncId: "budget-1", scope: "group", accountId: "g1", accountClass: "bank", updatedAt: "now" }] }),
    }));
    renderTable();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Account class of Wallet" })).toBeEnabled());

    for (const name of ["Checking", "Wallet", "Petty"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select account ${name}` }));
    await pickOption(await screen.findByRole("combobox", { name: "Set the class of the selected accounts" }), "Cash");

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual([
      { scope: "account", id: "a2", accountClass: "cash" },
      { scope: "account", id: "a3", accountClass: "cash" },
    ]);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("1 account was left unchanged"));
  });

  it("sorts by class, assets before liabilities and unclassified last", async () => {
    useStagedStore.getState().loadAccounts([
      { id: "a1", name: "Mortgage", offBudget: true, closed: false, groupId: null },
      { id: "a2", name: "Unsorted", offBudget: false, closed: false, groupId: null },
      { id: "a3", name: "Wallet", offBudget: false, closed: false, groupId: null },
    ]);
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        accountClasses: [
          { budgetSyncId: "budget-1", scope: "account", accountId: "a1", accountClass: "loan", updatedAt: "now" },
          { budgetSyncId: "budget-1", scope: "account", accountId: "a3", accountClass: "cash", updatedAt: "now" },
        ],
      }),
    }));
    renderTable();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Account class of Wallet" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /^Class/ }));
    const order = () => screen.getAllByRole("row").slice(1).map((r) => r.getAttribute("data-row-id"));
    expect(order()).toEqual(["a3", "a1", "a2"]);
    fireEvent.click(screen.getByRole("button", { name: /^Class/ }));
    expect(order()).toEqual(["a2", "a1", "a3"]);
  });

  describe("grouped view", () => {
    beforeEach(() => {
      useStagedStore.getState().loadAccounts([
        { id: "a1", name: "Mortgage", offBudget: true, closed: false, groupId: null },
        { id: "a2", name: "Wallet", offBudget: false, closed: false, groupId: null },
        { id: "a3", name: "Petty", offBudget: false, closed: false, groupId: null },
        { id: "a4", name: "Unsorted", offBudget: false, closed: false, groupId: null },
      ]);
      mockBalances.set("a1", -200000.5);
      mockBalances.set("a2", 100.1);
      mockBalances.set("a3", 50.2);
      (global.fetch as jest.Mock).mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          accountClasses: [
            { budgetSyncId: "budget-1", scope: "account", accountId: "a1", accountClass: "loan", updatedAt: "now" },
            { budgetSyncId: "budget-1", scope: "account", accountId: "a2", accountClass: "cash", updatedAt: "now" },
            { budgetSyncId: "budget-1", scope: "account", accountId: "a3", accountClass: "cash", updatedAt: "now" },
          ],
        }),
      }));
    });

    async function groupByClass() {
      renderTable();
      await waitFor(() => expect(screen.getByRole("combobox", { name: "Account class of Wallet" })).toBeEnabled());
      await pickOption(screen.getByRole("combobox", { name: "Group the table by" }), "By class");
    }

    it("clusters accounts under class headings with exact subtotals and a total", async () => {
      await groupByClass();

      const cash = await screen.findByRole("button", { name: /Collapse Cash, 2 accounts/ });
      expect(cash.closest("tr")).toHaveTextContent("150.30"); // 100.10 + 50.20, with no float drift
      expect(screen.getByRole("button", { name: /Collapse Loan, 1 account$/ }).closest("tr")).toHaveTextContent("-200,000.50");
      expect(screen.getByRole("button", { name: /Collapse Unclassified, 1 account$/ }).closest("tr")).toHaveTextContent("-");

      const order = screen.getAllByRole("row").map((r) => r.getAttribute("data-row-id") ?? r.textContent?.slice(0, 4));
      expect(order.filter((id) => id?.startsWith("a"))).toEqual(["a2", "a3", "a1", "a4"]); // Cash, Loan, Unclassified
      expect(screen.getByText("Total").closest("tr")).toHaveTextContent("-199,850.20");
    });

    it("hides a collapsed cluster's rows, and select-all does not reach them", async () => {
      await groupByClass();
      fireEvent.click(await screen.findByRole("button", { name: /Collapse Cash/ }));

      expect(screen.queryByRole("checkbox", { name: "Select account Wallet" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Expand Cash/ })).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(screen.getAllByRole("checkbox")[0]); // select all
      await waitFor(() => expect(screen.getByText("2 selected")).toBeInTheDocument());
    });

    it("goes back to the flat table with No grouping", async () => {
      await groupByClass();
      await pickOption(screen.getByRole("combobox", { name: "Group the table by" }), "No grouping");
      await waitFor(() => expect(screen.queryByText("Total")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /Collapse Cash/ })).not.toBeInTheDocument();
    });
  });
});
