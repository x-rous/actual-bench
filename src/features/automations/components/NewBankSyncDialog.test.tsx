import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewBankSyncDialog } from "./NewBankSyncDialog";
import * as api from "../lib/automationsApi";
import type { BankSyncAccountPreview } from "../lib/automationsApi";

jest.mock("../lib/automationsApi");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

const mockedApi = api as jest.Mocked<typeof api>;

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NewBankSyncDialog open onOpenChange={() => {}} onCreated={() => {}} />
    </QueryClientProvider>
  );
}

const connection = {
  connectionFingerprint: "srv-1",
  label: "Household",
  baseUrl: "https://budget.example.com",
  budgetSyncId: "budget-1",
};

function account(overrides: Partial<BankSyncAccountPreview> = {}): BankSyncAccountPreview {
  return { id: "a", name: "Checking", linked: true, syncSource: "simpleFin", lastSync: null, ...overrides };
}

describe("scheduling a bank sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.listVaultConnections.mockResolvedValue({ enabled: true, credentials: [connection] });
    mockedApi.listBankSyncAccounts.mockResolvedValue([
      account(),
      account({ id: "b", name: "Savings" }),
      account({ id: "c", name: "Cash", linked: false, syncSource: null }),
    ]);
    mockedApi.createAutomation.mockResolvedValue({} as never);
  });

  it("shows which accounts will sync instead of asking for faith", async () => {
    renderDialog();

    // The centre of the dialog: what this will actually do, by name.
    expect(await screen.findByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 accounts will sync/)).toBeInTheDocument();
    // And what it will not do, so an unlinked account is never a silent skip.
    expect(screen.getByText(/not connected to a bank — skipped/)).toBeInTheDocument();
  });

  it("refuses to schedule work that could never import anything", async () => {
    mockedApi.listBankSyncAccounts.mockResolvedValue([account({ linked: false, syncSource: null })]);

    renderDialog();

    // `getByText` inside `waitFor` re-queries the live DOM each attempt: the
    // dialog swaps its content node as it mounts, and `findByText` can resolve
    // with the node that was replaced.
    await waitFor(() =>
      expect(
        screen.getByText(/None of the accounts in this budget are connected to a bank/)
      ).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /schedule sync/i })).toBeDisabled();
    expect(mockedApi.createAutomation).not.toHaveBeenCalled();
  });

  it("says when the first run will happen, not just how often", async () => {
    renderDialog();
    await screen.findByText("Checking");

    // Someone choosing a schedule should see the consequence of choosing it.
    expect(screen.getByText(/First run/)).toBeInTheDocument();
  });

  it("offers plain cadences, keeping cron out of the way", async () => {
    renderDialog();
    await screen.findByText("Checking");

    const cadence = screen.getByLabelText("How often");
    expect(screen.queryByLabelText("Cron expression")).not.toBeInTheDocument();

    fireEvent.change(cadence, { target: { value: "daily" } });
    fireEvent.change(screen.getByLabelText("Time of day"), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: /schedule sync/i }));

    await waitFor(() => expect(mockedApi.createAutomation).toHaveBeenCalled());
    const payload = mockedApi.createAutomation.mock.calls[0][0];
    // "Once a day at 07:30" is stored as a schedule the engine understands,
    // without anyone having typed a cron expression.
    expect(payload.cronExpression).toBe("30 7 * * *");
    expect(payload.credentialRef).toBe("srv-1");
  });

  it("keeps cron available for the person who wants weekdays only", async () => {
    renderDialog();
    await screen.findByText("Checking");

    fireEvent.change(screen.getByLabelText("How often"), { target: { value: "cron" } });
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "@daily" } });

    expect(screen.getByText(/Five fields/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule sync/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "0 7 * * 1-5" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /schedule sync/i })).not.toBeDisabled()
    );
  });

  it("never schedules runs closer together than the unattended floor", async () => {
    renderDialog();
    await screen.findByText("Checking");

    fireEvent.change(screen.getByLabelText("Hours between runs"), { target: { value: "0.1" } });
    fireEvent.click(screen.getByRole("button", { name: /schedule sync/i }));

    await waitFor(() => expect(mockedApi.createAutomation).toHaveBeenCalled());
    expect(mockedApi.createAutomation.mock.calls[0][0].intervalMinutes).toBe(15);
  });

  it("does not ask which budget when there is only one", async () => {
    renderDialog();
    await screen.findByText("Checking");

    // A picker with one option is a question with one answer.
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
    // And no server URL is shown to someone who does not administer servers.
    expect(screen.queryByText(/https:\/\//)).not.toBeInTheDocument();
  });

  it("picks a time zone from a list, and only when the schedule has a clock", async () => {
    renderDialog();
    await screen.findByText("Checking");

    // "Every 6 hours" means the same thing everywhere, so asking would be
    // asking a question whose answer cannot matter.
    expect(screen.queryByLabelText("Time zone")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("How often"), { target: { value: "daily" } });

    const zone = screen.getByLabelText("Time zone");
    // A mistyped zone is a schedule that silently runs at the wrong hour, so it
    // is chosen, never typed.
    expect(zone.tagName).toBe("SELECT");
    // Labelled the way every other time-zone picker does, and the way the tz
    // database's own tables do — an IANA path alone is not an answer to "when".
    expect(zone.textContent).toMatch(/\(UTC[+-]\d{2}:\d{2}\)/);

    fireEvent.change(zone, { target: { value: "UTC" } });
    fireEvent.click(screen.getByRole("button", { name: /schedule sync/i }));

    await waitFor(() => expect(mockedApi.createAutomation).toHaveBeenCalled());
    expect(mockedApi.createAutomation.mock.calls[0][0].timezone).toBe("UTC");
  });

  it("does not schedule midnight when the time is cleared", async () => {
    renderDialog();
    await screen.findByText("Checking");

    fireEvent.change(screen.getByLabelText("How often"), { target: { value: "daily" } });
    fireEvent.change(screen.getByLabelText("Time of day"), { target: { value: "" } });

    // An empty time used to become `0 0 * * *` — a schedule nobody chose.
    expect(screen.getByText(/Enter a time of day/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule sync/i })).toBeDisabled();
    expect(mockedApi.createAutomation).not.toHaveBeenCalled();
  });
});
