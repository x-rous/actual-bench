import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AutomationsView } from "./AutomationsView";
import * as api from "../lib/automationsApi";
import type { AutomationListItem } from "../lib/automationsApi";
import { toast } from "sonner";
import type { AutomationRun } from "@/lib/app-db/types";

jest.mock("../lib/automationsApi");
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

function automation(overrides: Partial<AutomationListItem> = {}): AutomationListItem {
  return {
    id: "auto-1",
    type: "budget-file-sync",
    name: "Household → Joint",
    enabled: true,
    executionMode: "server",
    scheduleKind: "interval",
    intervalMinutes: 30,
    cronExpression: null,
    timezone: "UTC",
    targetRef: { version: 1, data: {} },
    credentialRef: "server-a",
    config: { version: 1, data: { flowId: "flow-1" } },
    failurePolicy: {
      backoffMinutes: 5,
      backoffCeilingMinutes: 60,
      pauseAfterConsecutiveFailures: 5,
    },
    consecutiveFailures: 0,
    autoPausedAt: null,
    autoPauseReason: null,
    lastRunAt: "2026-08-25T10:00:00.000Z",
    lastSuccessAt: "2026-08-25T10:00:00.000Z",
    nextRunAt: "2026-08-25T10:30:00.000Z",
    runningSince: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    scheduleLabel: "Every 30 minutes",
    running: false,
    lastRun: run(),
    typeLabel: "Budget File Sync",
    status: "ok",
    statusSummary: "Last run finished successfully.",
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    type: "budget-file-sync",
    status: "succeeded",
    startedAt: "2026-08-25T10:00:00.000Z",
    finishedAt: "2026-08-25T10:00:20.000Z",
    trigger: "schedule",
    attempt: 1,
    executionMode: "server",
    result: { version: 1, data: { flowId: "flow-1", syncRunId: "sync-run-1", applied: 3, updated: 0, deleted: 0 } },
    rollup: { outcome: "ok", itemCount: 3, message: "3 added" },
    error: null,
    ...overrides,
  };
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationsView />
    </QueryClientProvider>
  );
}

describe("AutomationsView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.listAutomations.mockResolvedValue({ automations: [automation()], jobTypes: [] });
    mockedApi.listAutomationRuns.mockResolvedValue([run()]);
    mockedApi.runAutomationNow.mockResolvedValue({
      automationId: "auto-1",
      runId: "run-2",
      status: "succeeded",
      message: "3 added",
    });
    mockedApi.patchAutomation.mockResolvedValue(automation());
    mockedApi.listReviewQueue.mockResolvedValue([]);
  });

  it("shows schedule, last run and next run without opening anything", async () => {
    renderView();

    expect(await screen.findByText("Household → Joint")).toBeInTheDocument();
    expect(screen.getByText(/Every 30 minutes/)).toBeInTheDocument();
    // The job type is named rather than inferred: "Household → Joint" says
    // nothing about what kind of automation it is once bank sync exists.
    expect(screen.getByText("Budget File Sync")).toBeInTheDocument();
    expect(screen.getByText(/3 added/)).toBeInTheDocument();
  });

  it("states on every row whether the automation runs with Bench closed", async () => {
    mockedApi.listAutomations.mockResolvedValue({
      automations: [
        automation(),
        automation({ id: "auto-2", name: "Browser job", executionMode: "browser" }),
      ],
      jobTypes: [],
    });

    renderView();

    // Stated once for the page...
    expect(await screen.findByText(/run on a schedule even with Actual Bench closed/i)).toBeInTheDocument();
    // ...and per row, where a browser-only automation cannot be mistaken for an
    // unattended one. The full explanation is on the control itself.
    const browserCell = screen.getByText("Browser only");
    expect(browserCell).toHaveAttribute("title", expect.stringMatching(/only runs while Actual Bench is open/i));
    expect(screen.getAllByText("Server").length).toBeGreaterThan(0);
  });

  it("runs an automation on demand", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /run .* now/i }));

    // react-query passes its own context as a second argument; assert on the id.
    await waitFor(() => expect(mockedApi.runAutomationNow).toHaveBeenCalled());
    expect(mockedApi.runAutomationNow.mock.calls[0][0]).toBe("auto-1");
  });

  it("does not claim every automation is running when one of them is", async () => {
    // Regression: the pending state was global, so starting one run disabled
    // "Run now" everywhere and showed a spinner on every card.
    let resolveRun: () => void = () => {};
    mockedApi.runAutomationNow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = () =>
            resolve({ automationId: "auto-1", runId: "run-2", status: "succeeded" });
        })
    );
    mockedApi.listAutomations.mockResolvedValue({
      automations: [automation(), automation({ id: "auto-2", name: "Second automation" })],
      jobTypes: [],
    });

    renderView();
    await screen.findByText("Second automation");

    const buttons = screen.getAllByRole("button", { name: /run .* now/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(buttons[0]).toBeDisabled());
    expect(buttons[1]).not.toBeDisabled();

    resolveRun();
  });

  it("does not offer Run now while a run is already in flight", async () => {
    mockedApi.listAutomations.mockResolvedValue({
      automations: [automation({ running: true })],
      jobTypes: [],
    });

    renderView();

    expect(await screen.findByLabelText("Running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run .* now/i })).toBeDisabled();
  });

  it("surfaces the pause reason and offers Resume rather than a bare toggle", async () => {
    mockedApi.listAutomations.mockResolvedValue({
      automations: [
        automation({
          enabled: false,
          autoPausedAt: "2026-08-25T09:00:00.000Z",
          autoPauseReason: "Paused after 5 consecutive failures: provider unreachable",
          consecutiveFailures: 5,
          status: "paused",
          statusSummary: "Paused after 5 consecutive failures: provider unreachable",
        }),
      ],
      jobTypes: [],
    });

    renderView();

    // A row in trouble earns the extra line that explains it.
    expect(await screen.findByText(/provider unreachable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    await waitFor(() => expect(mockedApi.patchAutomation).toHaveBeenCalledWith("auto-1", { resume: true }));
  });

  it("does not claim a next run for a paused automation", async () => {
    mockedApi.listAutomations.mockResolvedValue({
      automations: [
        automation({ enabled: false, autoPausedAt: "2026-08-25T09:00:00.000Z", autoPauseReason: "broken" }),
      ],
      jobTypes: [],
    });

    renderView();

    expect(await screen.findByText("Not scheduled")).toBeInTheDocument();
  });

  it("explains the empty state instead of showing a bare table", async () => {
    mockedApi.listAutomations.mockResolvedValue({ automations: [], jobTypes: [] });

    renderView();

    expect(await screen.findByText(/No automations yet/i)).toBeInTheDocument();
    // The empty page must explain *why* it is empty: which flows qualify, and
    // that a just-enrolled one is not missing, only not picked up yet.
    expect(screen.getByText(/Auto-sync on a server schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/stays out of here on purpose/i)).toBeInTheDocument();
    expect(screen.getByText(/appears as soon as you refresh this page/i)).toBeInTheDocument();
  });

  it("opens run history with the job type's own result rendering", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Household → Joint" }));

    expect(await screen.findByText("Run history")).toBeInTheDocument();
    // The sync renderer's vocabulary, not the engine's.
    expect(await screen.findByText("Added")).toBeInTheDocument();
    expect(screen.getByText(/Open Budget File Sync/)).toBeInTheDocument();
  });

  it("shows review work with a link into the job type's own review screen", async () => {
    mockedApi.listReviewQueue.mockResolvedValue([
      {
        automationId: "auto-1",
        automationName: "Household → Joint",
        type: "budget-file-sync",
        typeLabel: "Budget File Sync",
        subjects: ["transaction"],
        pendingCount: 2,
        lastRunAt: "2026-08-25T10:00:00.000Z",
        href: "/sync",
        summary: "2 items from the last run need a decision.",
      },
    ]);

    renderView();

    expect(await screen.findByText("Waiting for you to decide")).toBeInTheDocument();
    expect(screen.getByText("2 items from the last run need a decision.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review in Budget File Sync/ })).toHaveAttribute("href", "/sync");
  });

  it("shows no review section when nothing is waiting", async () => {
    renderView();

    await screen.findByText("Household → Joint");
    expect(screen.queryByText("Waiting for you to decide")).not.toBeInTheDocument();
  });

  it("says a run failed instead of reporting it finished", async () => {
    mockedApi.runAutomationNow.mockResolvedValue({
      automationId: "auto-1",
      runId: "run-3",
      status: "failed",
      message: "provider unreachable",
    });

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /run .* now/i }));

    // A run that happened answers 200 whatever it concluded, so the toast has
    // to read the outcome rather than the HTTP status.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Run failed: provider unreachable"));
  });

  it("warns rather than congratulates when a run did not start", async () => {
    mockedApi.runAutomationNow.mockResolvedValue({
      automationId: "auto-1",
      runId: null,
      status: "skipped",
      message: "A run is already in progress",
    });

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /run .* now/i }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith("A run is already in progress")
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("animates the refresh control only while a requested refresh is running", async () => {
    let releaseRefresh: () => void = () => {};
    mockedApi.listAutomations
      .mockResolvedValueOnce({ automations: [automation()], jobTypes: [] })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRefresh = () => resolve({ automations: [automation()], jobTypes: [] });
          })
      );

    renderView();
    await screen.findByText("Household → Joint");

    const refresh = screen.getByRole("button", { name: /refresh automations/i });
    const icon = refresh.querySelector("svg");

    // At rest it must not spin: the page polls on its own, and an icon that is
    // always moving tells the user nothing about their click.
    expect(icon).not.toHaveClass("animate-spin");

    fireEvent.click(refresh);

    await waitFor(() => expect(refresh).toBeDisabled());
    expect(refresh.querySelector("svg")).toHaveClass("animate-spin");

    releaseRefresh();
    await waitFor(() => expect(refresh).not.toBeDisabled());
    expect(refresh.querySelector("svg")).not.toHaveClass("animate-spin");
  });
});
