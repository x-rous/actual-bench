import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStagedStore } from "../../../store/staged";
import type { AccountFlagRecord } from "@/lib/app-db/types";
import { chooseSelectOption } from "@/components/ui/select.testing";
import type { AccountFlagChange } from "@/lib/account-class/flags";
import { AccountsTable } from "./AccountsTable";

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
jest.mock("../hooks/useAccountBalances", () => ({ useAccountBalances: () => ({ data: new Map() }) }));
jest.mock("../hooks/useAccountGroups", () => ({ useAccountGroups: () => ({ supported: false }) }));
jest.mock("../hooks/useClosedAccountActivity", () => ({ useClosedAccountActivity: () => ({ data: new Map() }) }));
jest.mock("@/hooks/useAllNotes", () => ({ useAllNotes: () => ({ data: undefined }) }));

let flags = new Map<string, AccountFlagRecord>();
function fakeServer(options: { failFlags?: boolean } = {}) {
  flags = new Map<string, AccountFlagRecord>();
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.startsWith("/api/account-classes")) {
      return { ok: true, json: async () => ({ accountClasses: [
        { budgetSyncId: "budget-1", scope: "account", accountId: "inv", accountClass: "investment", updatedAt: "now" },
        { budgetSyncId: "budget-1", scope: "account", accountId: "prop", accountClass: "property", updatedAt: "now" },
      ] }) };
    }
    if (path.startsWith("/api/account-flags")) {
      if (options.failFlags) return { ok: false, json: async () => ({}) };
      if (init?.method === "PUT") {
        for (const c of (JSON.parse(String(init.body)) as { changes: AccountFlagChange[] }).changes) {
          const key = `${c.scope}:${c.id}:${c.flag}`;
          if (c.on) flags.set(key, { budgetSyncId: "budget-1", scope: c.scope, targetId: c.id, flag: c.flag, updatedAt: "now" });
          else flags.delete(key);
        }
      }
      return { ok: true, json: async () => ({ accountFlags: [...flags.values()] }) };
    }
    return { ok: false, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountsTable onCreateRule={jest.fn()} onDeleteIntentChange={jest.fn()} onInspectIdChange={jest.fn()} />
    </QueryClientProvider>
  );
}

describe("accounts table access and reports", () => {
  beforeEach(() => {
    sessionStorage.removeItem("filters:accounts");
    useStagedStore.getState().discardAll();
    useStagedStore.getState().loadAccounts([
      { id: "inv", name: "Brokerage", offBudget: true, closed: false },
      { id: "prop", name: "Flat", offBudget: true, closed: false },
    ]);
    fakeServer();
  });

  it("shows each class's access: a choice off budget, text where the class has none", async () => {
    renderTable();
    expect(await screen.findByText("Sell to use")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Accessible: Brokerage" })).toHaveTextContent("Locked");
  });

  it("marks an investment available now with one saved flag", async () => {
    renderTable();
    await chooseSelectOption(await screen.findByRole("combobox", { name: "Accessible: Brokerage" }), "Available now");
    await waitFor(() => expect([...flags.keys()]).toEqual(["account:inv:accessible"]));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Accessible: Brokerage" })).toHaveTextContent("Available now"));
  });

  it("leaves an account out of reports at once, filters to the left-out accounts, and forgets the filter when none are left", async () => {
    renderTable();
    await screen.findByText("Sell to use");
    fireEvent.click(screen.getByRole("button", { name: "Leave out Brokerage of reports" }));
    const leftOut = await screen.findByRole("button", { name: "1 left out of reports" });
    expect(screen.getByText("Left out of reports")).toBeInTheDocument();

    fireEvent.click(leftOut);
    expect(screen.queryByText("Flat")).not.toBeInTheDocument();
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem("filters:accounts") ?? "").toContain("excluded"));

    // Put it back: the list ends on its own and the stored filter ends with it.
    fireEvent.click(screen.getByRole("button", { name: "Include Brokerage in reports" }));
    await waitFor(() => expect(screen.queryByText(/left out of reports ·/)).not.toBeInTheDocument());
    expect(screen.getByText("Flat")).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem("filters:accounts") ?? "").not.toContain("excluded"));
  });

  it("sets access for the selected accounts at once, and says which it left unchanged", async () => {
    renderTable();
    await screen.findByText("Sell to use");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select account Brokerage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select account Flat" }));
    await chooseSelectOption(screen.getByRole("combobox", { name: "Set the access of the selected accounts" }), "Available now");
    await waitFor(() => expect([...flags.keys()]).toEqual(["account:inv:accessible"]));
    expect(jest.requireMock("sonner").toast.info).toHaveBeenCalledWith(expect.stringContaining("1 account was left unchanged"));
  });

  it("says when the settings could not be loaded, and retries", async () => {
    fakeServer({ failFlags: true });
    renderTable();
    expect(await screen.findByRole("alert")).toHaveTextContent("report settings could not be loaded");
    fakeServer();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
