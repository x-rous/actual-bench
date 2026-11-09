import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStagedStore } from "../../../store/staged";
import type { AccountFlagRecord, AccountReportingRecord } from "@/lib/app-db/types";
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

function fakeServer(options: { failFlags?: boolean } = {}) {
  const flags = new Map<string, AccountFlagRecord>();
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
    return { ok: true, json: async () => ({ accountReporting: [] as AccountReportingRecord[] }) };
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

describe("accounts table Financial Reporting and account settings", () => {
  beforeEach(() => {
    sessionStorage.removeItem("filters:accounts");
    useStagedStore.getState().discardAll();
    useStagedStore.getState().loadAccounts([
      { id: "inv", name: "Brokerage", offBudget: true, closed: false },
      { id: "prop", name: "Flat", offBudget: true, closed: false },
    ]);
    fakeServer();
  });

  it("asks for no choice: the fixed labels show as text and nothing is flagged as needing one", async () => {
    renderTable();
    expect(await screen.findByText("Fixed asset")).toBeInTheDocument();
    expect(screen.getAllByText("Investment").length).toBeGreaterThan(0);
    expect(screen.queryByText(/needs? a reporting choice/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose…/)).not.toBeInTheDocument();
  });

  it("leaves an account out of Financial Insights at once, filters to the left-out accounts, and forgets the filter when none are left", async () => {
    renderTable();
    await screen.findByText("Fixed asset");
    fireEvent.click(screen.getByRole("button", { name: "Settings of Brokerage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Include in Financial Insights/ }));
    const leftOut = await screen.findByRole("button", { name: "1 left out of Financial Insights" });
    expect(screen.getByText("Left out")).toBeInTheDocument();

    fireEvent.click(leftOut);
    expect(screen.queryByText("Flat")).not.toBeInTheDocument();
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem("filters:accounts") ?? "").toContain("excluded"));

    // Put it back: the list ends on its own and the stored filter ends with it.
    fireEvent.click(screen.getByRole("button", { name: "Settings of Brokerage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Include in Financial Insights/ }));
    await waitFor(() => expect(screen.queryByText(/left out of Financial Insights/)).not.toBeInTheDocument());
    expect(screen.getByText("Flat")).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem("filters:accounts") ?? "").not.toContain("excluded"));
  });

  it("says when the settings could not be loaded, and retries", async () => {
    fakeServer({ failFlags: true });
    renderTable();
    expect(await screen.findByRole("alert")).toHaveTextContent("account settings could not be loaded");
    fakeServer();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
