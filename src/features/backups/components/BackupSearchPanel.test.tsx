import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BackupComparePanel } from "./BackupComparePanel";
import { BackupSearchPanel } from "./BackupSearchPanel";
import * as api from "../lib/backupsApi";

jest.mock("../lib/backupsApi");

const mockedApi = api as jest.Mocked<typeof api>;

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

const transaction = {
  id: "t1",
  date: "2026-01-05",
  account: "Current",
  payee: "Corner Grocer",
  category: "Food",
  amountMinor: -1250,
  notes: "weekly shop",
  cleared: true,
  split: false,
};

describe("searching inside a backup", () => {
  beforeEach(() => jest.resetAllMocks());

  it("searches the copy and shows its rows as they were", async () => {
    mockedApi.searchBackup.mockResolvedValue({
      opened: true,
      kind: "transactions",
      total: 1,
      page: 0,
      pageSize: 100,
      rows: [transaction],
    });
    wrap(<BackupSearchPanel artifactId="art-1" passphrase="" />);

    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: " grocer " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Corner Grocer")).toBeInTheDocument();
    expect(within(table).getByText((-12.5).toLocaleString(undefined, { minimumFractionDigits: 2 }))).toBeInTheDocument();
    expect(screen.getByText(/1–1 of 1 transactions/)).toBeInTheDocument();
    expect(mockedApi.searchBackup).toHaveBeenCalledWith(
      "art-1",
      { kind: "transactions", text: "grocer", from: null, to: null, page: 0 },
      undefined
    );
  });

  it("says nothing matched the filters and offers to clear them", async () => {
    mockedApi.searchBackup.mockResolvedValue({ opened: true, kind: "transactions", total: 0, page: 0, pageSize: 100, rows: [] });
    wrap(<BackupSearchPanel artifactId="art-1" passphrase="secret" />);

    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "nothing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No results match your filters")).toBeInTheDocument();
    expect(mockedApi.searchBackup).toHaveBeenLastCalledWith("art-1", expect.objectContaining({ text: "nothing" }), "secret");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(mockedApi.searchBackup).toHaveBeenLastCalledWith("art-1", expect.objectContaining({ text: "" }), "secret")
    );
  });

  it("passes on why a copy could not be opened", async () => {
    mockedApi.searchBackup.mockResolvedValue({ opened: false, message: "Enter the passphrase to open it." });
    wrap(<BackupSearchPanel artifactId="art-1" passphrase="" />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Enter the passphrase to open it.")).toBeInTheDocument();
  });
});

describe("comparing a backup with the live budget", () => {
  beforeEach(() => jest.resetAllMocks());

  it("lists the accounts that changed and hides the unchanged ones until asked", async () => {
    const same = { name: "Savings", offBudget: false, closed: false, transactions: 4, balanceMinor: 1000 };
    mockedApi.compareBackup.mockResolvedValue({
      opened: true,
      takenAt: "2026-08-27T02:00:00.000Z",
      budgetName: "Household",
      totals: { backup: { accounts: 2, transactions: 14 }, live: { accounts: 2, transactions: 16 } },
      accounts: [
        {
          accountId: "a",
          name: "Current",
          change: "changed",
          backup: { ...same, name: "Current", transactions: 10, balanceMinor: 50000 },
          live: { ...same, name: "Current", transactions: 12, balanceMinor: 42500 },
          balanceDeltaMinor: -7500,
          transactionDelta: 2,
          details: {
            onlyInCopy: [],
            onlyNow: [
              { id: "t9", accountId: "a", date: "2026-11-20", payee: "Corner Grocer", category: "Food", amountMinor: -7500, notes: null },
            ],
            edited: [],
            counts: { onlyInCopy: 0, onlyNow: 1, edited: 0 },
          },
        },
        { accountId: "b", name: "Savings", change: "same", backup: same, live: same, balanceDeltaMinor: 0, transactionDelta: 0, details: null },
      ],
    });
    wrap(<BackupComparePanel artifactId="art-1" passphrase="" />);

    fireEvent.click(screen.getByRole("button", { name: "Compare with the live budget" }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Current")).toBeInTheDocument();
    expect(within(table).getByText("Changed")).toBeInTheDocument();
    expect(within(table).queryByText("Savings")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Show 1 unchanged account/));
    expect(within(table).getByText("Savings")).toBeInTheDocument();

    // A changed account opens to the rows that changed it.
    fireEvent.click(screen.getByRole("button", { name: /show the transactions that changed in current/i }));
    expect(within(table).getByText(/Only in the budget now/)).toBeInTheDocument();
    expect(within(table).getByText("Corner Grocer")).toBeInTheDocument();
  });

  it("explains when the live budget cannot be read", async () => {
    mockedApi.compareBackup.mockResolvedValue({ opened: false, message: "Bench has no stored credentials for this budget." });
    wrap(<BackupComparePanel artifactId="art-1" passphrase="" />);

    fireEvent.click(screen.getByRole("button", { name: "Compare with the live budget" }));

    expect(await screen.findByText("Bench has no stored credentials for this budget.")).toBeInTheDocument();
  });
});
