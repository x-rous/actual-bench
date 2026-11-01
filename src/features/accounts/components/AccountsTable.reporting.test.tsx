import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStagedStore } from "../../../store/staged";
import type { AccountReportingRecord } from "@/lib/app-db/types";
import type { AccountReportingChange } from "@/lib/app-db/accountReportingRepository";
import { chooseSelectOption } from "@/components/ui/select.testing";
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

function fakeServer() {
  const reporting = new Map<string, AccountReportingRecord>();
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith("/api/account-classes")) {
      return { ok: true, json: async () => ({ accountClasses: [
        { budgetSyncId: "budget-1", scope: "account", accountId: "inv", accountClass: "investment", updatedAt: "now" },
        { budgetSyncId: "budget-1", scope: "account", accountId: "prop", accountClass: "property", updatedAt: "now" },
      ] }) };
    }
    if (init?.method === "PUT") {
      for (const c of (JSON.parse(String(init.body)) as { changes: AccountReportingChange[] }).changes) {
        if (c.treatment) reporting.set(c.accountId, { budgetSyncId: "budget-1", accountId: c.accountId, treatment: c.treatment, updatedAt: "now" });
        else reporting.delete(c.accountId);
      }
    }
    return { ok: true, json: async () => ({ accountReporting: [...reporting.values()] }) };
  }) as unknown as typeof fetch;
}

describe("accounts table Financial Reporting", () => {
  beforeEach(() => {
    sessionStorage.removeItem("filters:accounts");
    useStagedStore.getState().discardAll();
    useStagedStore.getState().loadAccounts([
      { id: "inv", name: "Brokerage", offBudget: true, closed: false },
      { id: "prop", name: "Flat", offBudget: true, closed: false },
    ]);
    fakeServer();
  });

  it("highlights an account needing a choice, filters to it, and clears once it is chosen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <AccountsTable onCreateRule={jest.fn()} onDeleteIntentChange={jest.fn()} onInspectIdChange={jest.fn()} />
      </QueryClientProvider>
    );
    // The fixed treatment of a property account needs nothing from the user.
    expect(await screen.findByText("Non-current asset")).toBeInTheDocument();
    const attention = await screen.findByRole("button", { name: "1 needs a reporting choice" });

    fireEvent.click(attention);
    expect(screen.queryByText("Flat")).not.toBeInTheDocument();
    expect(screen.getByText("Brokerage")).toBeInTheDocument();

    const select = screen.getByRole("combobox", { name: "Financial Reporting of Brokerage (choice needed)" });
    await chooseSelectOption(select, "Current investment");
    await waitFor(() => expect(screen.queryByText(/needing a reporting choice/)).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" })).toHaveTextContent("Current investment");
  });
});
