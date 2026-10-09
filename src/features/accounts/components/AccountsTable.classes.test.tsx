import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStagedStore } from "../../../store/staged";
import type { AccountClassRecord } from "@/lib/app-db/types";
import type { AccountClassChange } from "@/lib/account-class";
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
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../hooks/useAccountBalances", () => ({ useAccountBalances: () => ({ data: new Map() }) }));
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
});
