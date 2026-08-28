import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RunHistoryView } from "./RunHistoryView";
import * as api from "../lib/automationsApi";
import type { RunHistory, RunHistoryEntry } from "../lib/automationsApi";

jest.mock("../lib/automationsApi");
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/automations/runs",
}));

const mockedApi = api as jest.Mocked<typeof api>;

function run(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    id: "run-1",
    automationId: "auto-1",
    type: "backup",
    status: "failed",
    startedAt: "2026-08-28T02:00:00.000Z",
    finishedAt: "2026-08-28T02:00:20.000Z",
    trigger: "schedule",
    attempt: 1,
    executionMode: "server",
    result: null,
    rollup: { outcome: "failed", itemCount: 0, message: "No copy could be stored." },
    error: null,
    automationName: "Nightly backup",
    typeLabel: "Backup",
    ...overrides,
  };
}

function history(overrides: Partial<RunHistory> = {}): RunHistory {
  return {
    runs: [run(), run({ id: "run-2", status: "succeeded", rollup: { outcome: "ok", itemCount: 2 } })],
    automations: [{ id: "auto-1", name: "Nightly backup", type: "backup" }],
    jobTypes: [{ type: "backup", label: "Backup" }],
    ...overrides,
  };
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RunHistoryView />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.fetchRunHistory.mockResolvedValue(history());
});

describe("run history", () => {
  it("shows every automation's runs, named, without opening anything", async () => {
    renderView();

    expect(await screen.findAllByText("Nightly backup")).not.toHaveLength(0);
    expect(screen.getByText("No copy could be stored.")).toBeInTheDocument();
  });

  it("filters by outcome, which is the question people arrive with", async () => {
    renderView();
    await screen.findByText("No copy could be stored.");

    fireEvent.click(screen.getByRole("button", { name: "Failed" }));

    await waitFor(() =>
      expect(mockedApi.fetchRunHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ statuses: ["failed"] })
      )
    );
  });

  it("filters to one automation, for chasing a single thing", async () => {
    renderView();
    await screen.findByText("No copy could be stored.");

    fireEvent.change(screen.getByLabelText("Filter by automation"), {
      target: { value: "auto-1" },
    });

    await waitFor(() =>
      expect(mockedApi.fetchRunHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ automationId: "auto-1" })
      )
    );
  });

  it("says how many of the listed runs did not finish cleanly", async () => {
    renderView();
    expect(await screen.findByText(/1 of these run did not finish cleanly/)).toBeInTheDocument();
  });

  it("tells an empty result apart from an empty history", async () => {
    mockedApi.fetchRunHistory.mockResolvedValue(history({ runs: [] }));
    renderView();

    expect(await screen.findByText("Nothing has run yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(await screen.findByText("Nothing matches those filters")).toBeInTheDocument();
  });

  it("keeps the runs of a deleted automation, and says so", async () => {
    // The history of what happened is not undone by removing the thing that
    // did it.
    mockedApi.fetchRunHistory.mockResolvedValue(
      history({ runs: [run({ automationId: null, automationName: "Deleted automation" })] })
    );

    renderView();
    expect(await screen.findByText("Deleted automation")).toBeInTheDocument();
  });
});
