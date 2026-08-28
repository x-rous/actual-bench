import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { BackupsView } from "./BackupsView";
import * as api from "../lib/backupsApi";
import type { ArtifactWithLocations, RecoveryCenterData } from "../lib/backupsApi";

jest.mock("../lib/backupsApi");
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

function artifact(overrides: Partial<ArtifactWithLocations> = {}): ArtifactWithLocations {
  return {
    id: "art-1",
    policyId: "pol-1",
    kind: "budget",
    createdAt: "2026-08-27T02:00:00.000Z",
    sourceBudgetId: "budget-1",
    sourceBudgetName: "Household",
    sizeBytes: 2_400_000,
    checksumSha256: "a".repeat(64),
    plaintextChecksumSha256: null,
    encrypted: false,
    encryption: null,
    encryptionCredentialRef: null,
    tier: "daily",
    pinned: false,
    protectedUntil: null,
    takenBefore: null,
    verificationLevel: "data",
    verificationStatus: "passed",
    verifiedAt: "2026-08-27T02:00:10.000Z",
    verification: null,
    manifestVersion: 1,
    benchVersion: null,
    notes: null,
    locations: [
      {
        id: "loc-1",
        artifactId: "art-1",
        destinationId: "dest-1",
        destinationName: "NAS volume",
        objectKey: "budget/household/2026/2026-08-27T020000-art1.zip",
        status: "stored",
        uploadedAt: "2026-08-27T02:00:20.000Z",
        lastVerifiedAt: "2026-08-27T02:00:20.000Z",
        lastError: null,
        createdAt: "2026-08-27T02:00:20.000Z",
        updatedAt: "2026-08-27T02:00:20.000Z",
      },
    ],
    ...overrides,
  };
}

function data(overrides: Partial<RecoveryCenterData> = {}): RecoveryCenterData {
  return {
    readiness: {
      status: "protected",
      headline: "You could restore a verified backup from 3 hours ago.",
      detail: "1 stored copy across 1 destination.",
      newestVerified: {
        artifactId: "art-1",
        createdAt: "2026-08-27T02:00:00.000Z",
        ageHours: 3,
        budgetName: "Household",
      },
      totalCopies: 1,
      destinationCount: 1,
      redundant: false,
      issues: [],
    },
    destinations: [
      {
        id: "dest-1",
        name: "NAS volume",
        kind: "local",
        enabled: true,
        config: { version: 1, data: { path: "/mnt/backups" } },
        credentialRef: null,
        lastSuccessAt: "2026-08-27T02:00:20.000Z",
        lastFailureAt: null,
        lastFailureReason: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-27T02:00:20.000Z",
      },
    ],
    policies: [
      {
        automation: null,
        id: "pol-1",
        name: "Nightly",
        enabled: true,
        contents: "both",
        sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
        destinationIds: ["dest-1"],
        verificationLevel: "data",
        encryption: "none",
        encryptionCredentialRef: null,
        retention: {
          daily: 7,
          weekly: 4,
          monthly: 12,
          yearly: 3,
          minimumAgeHours: 24,
          autoProtectionDays: 14,
          autoProtectionCount: 10,
        },
        scheduleKind: "cron",
        cronExpression: "0 2 * * *",
        intervalMinutes: null,
        timezone: "UTC",
        scrubEnabled: true,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    artifacts: [artifact()],
    sources: [
      {
        connectionFingerprint: "conn-1",
        label: "Household",
        baseUrl: "https://actual.example.com",
        budgetSyncId: "budget-1",
      },
    ],
    heldPassphrases: [],
    vaultEnabled: true,
    ...overrides,
  };
}

/** The tab someone lands on depends on whether anything is configured. */
async function openSetup() {
  fireEvent.click(await screen.findByRole("tab", { name: /^setup/i }));
}

async function openBackups() {
  fireEvent.click(await screen.findByRole("tab", { name: /^backups/i }));
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BackupsView />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // The chosen tab and filters persist to sessionStorage, so one test's choice
  // would otherwise decide the next test's starting tab.
  sessionStorage.clear();
  mockedApi.fetchRecoveryCenter.mockResolvedValue(data());
});

describe("the Recovery Center", () => {
  it("leads with what you would actually get back", async () => {
    renderView();
    expect(
      await screen.findByText("You could restore a verified backup from 3 hours ago.")
    ).toBeInTheDocument();
  });

  it("shows each copy's state in words, not only in colour", async () => {
    renderView();
    // In the row, not merely as a filter option.
    expect(await screen.findByText("Verified", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Household")).toBeInTheDocument();
    expect(screen.getByText("NAS volume", { selector: "span.rounded" })).toBeInTheDocument();
  });

  it("says a backup with no surviving copy is gone, whatever it once verified as", async () => {
    // The single most misleading thing this page could do is show a verified
    // badge on a backup that is not there any more.
    mockedApi.fetchRecoveryCenter.mockResolvedValue(
      data({
        artifacts: [
          artifact({
            verificationStatus: "passed",
            locations: [
              {
                ...artifact().locations[0],
                status: "missing",
              },
            ],
          }),
        ],
      })
    );

    renderView();
    expect(await screen.findByText("No copy")).toBeInTheDocument();
    expect(screen.queryByText("Verified", { selector: "span" })).not.toBeInTheDocument();
  });

  it("reports a failed manual backup as a failure rather than as finished", async () => {
    mockedApi.backUpNow.mockResolvedValue({
      policyId: "pol-1",
      trigger: "manual",
      startedAt: "2026-08-27T09:00:00.000Z",
      finishedAt: "2026-08-27T09:00:05.000Z",
      artifacts: [],
      stored: false,
      verified: false,
      message: "No enabled destination",
    });

    renderView();
    await openSetup();
    fireEvent.click(await screen.findByRole("button", { name: /back up now/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No enabled destination"));
  });

  it("warns rather than congratulates when a copy stored but did not verify", async () => {
    mockedApi.backUpNow.mockResolvedValue({
      policyId: "pol-1",
      trigger: "manual",
      startedAt: "2026-08-27T09:00:00.000Z",
      finishedAt: "2026-08-27T09:00:05.000Z",
      artifacts: [],
      stored: true,
      verified: false,
      message: "Stored, but Bench could not confirm the copy is readable.",
    });

    renderView();
    await openSetup();
    fireEvent.click(await screen.findByRole("button", { name: /back up now/i }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith("Stored, but Bench could not confirm the copy is readable.")
    );
  });

  it("tells you when a destination is broken, on the destination", async () => {
    mockedApi.fetchRecoveryCenter.mockResolvedValue(
      data({
        destinations: [
          {
            ...data().destinations[0],
            // After the last success: a destination that failed and then
            // succeeded is working, and must not be shown as broken.
            lastFailureAt: "2026-08-27T06:00:00.000Z",
            lastFailureReason: "No space left on device",
          },
        ],
      })
    );

    renderView();
    await openSetup();
    // The reason sits inline with the destination name, so it spans nodes.
    await screen.findByText("NAS volume", { selector: "span.font-medium" });
    await waitFor(() =>
      expect(document.body.textContent).toContain("No space left on device")
    );
  });

  it("opens a fresh install on Setup, where the only useful action is", async () => {
    mockedApi.fetchRecoveryCenter.mockResolvedValue(
      data({ artifacts: [], policies: [], destinations: [] })
    );

    renderView();

    // Nothing configured: the tab someone needs is the one they have not used.
    expect(await screen.findByRole("tab", { name: /^setup/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText(/Nowhere to put a backup yet/)).toBeInTheDocument();
    // A rule cannot be saved without somewhere to write it.
    expect(screen.getByRole("button", { name: /new backup rule/i })).toBeDisabled();
  });

  it("walks a new user through the order things have to happen in", async () => {
    mockedApi.fetchRecoveryCenter.mockResolvedValue(
      data({ artifacts: [], policies: [], destinations: [] })
    );

    renderView();
    await openBackups();

    // One guided path, not four separate empty messages.
    expect(await screen.findByText("Start by choosing where copies go")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go to setup/i })).toBeInTheDocument();
  });

  it("opens a configured install on the copies, not on the settings", async () => {
    renderView();

    expect(await screen.findByRole("tab", { name: /^backups/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("Household")).toBeInTheDocument();
  });

  it("names the prerequisite a scheduled backup has, before it bites", async () => {
    mockedApi.fetchRecoveryCenter.mockResolvedValue(
      data({ artifacts: [], policies: [], sources: [] })
    );

    renderView();
    await openBackups();

    expect(
      await screen.findByText(/enrolled for unattended use/)
    ).toBeInTheDocument();
  });

  it("says a rule is not running when its automation is paused", async () => {
    // The rule says what should happen; the automation says what does. Showing
    // the rule as enabled while nothing runs is the page telling a comfortable
    // lie.
    mockedApi.fetchRecoveryCenter.mockResolvedValue(
      data({
        policies: [
          {
            ...data().policies[0],
            automation: {
              id: "auto-1",
              enabled: false,
              running: false,
              autoPausedAt: "2026-08-27T02:00:00.000Z",
              autoPauseReason: "The destination could not be written to 5 times",
              lastRunAt: "2026-08-27T02:00:00.000Z",
              nextRunAt: null,
              status: "paused",
              statusSummary: "Paused",
              lastRunMessage: null,
            },
          },
        ],
      })
    );

    renderView();
    await openSetup();
    expect(
      await screen.findByText(/paused after repeated failures: The destination could not be written to 5 times/)
    ).toBeInTheDocument();
  });

  it("keeps deleting a rule behind a menu, and asks before doing it", async () => {
    // "Back up now" is what people come here for; the action that deletes
    // things should not sit beside it at the same weight.
    renderView();
    await openSetup();
    fireEvent.click(await screen.findByRole("button", { name: /more actions for nightly/i }));

    fireEvent.click(await screen.findByRole("menuitem", { name: /delete rule/i }));

    expect(await screen.findByText('Delete "Nightly"?')).toBeInTheDocument();
    expect(screen.getByText(/backups it already took are kept/)).toBeInTheDocument();
    expect(mockedApi.deletePolicy).not.toHaveBeenCalled();
  });

  it("lists a passphrase it is still holding for backups whose rule is gone", async () => {
    mockedApi.fetchRecoveryCenter.mockResolvedValue(
      data({
        heldPassphrases: [
          {
            ref: "pol-old",
            label: "Off-site",
            createdAt: "2026-01-01T00:00:00.000Z",
            ruleExists: false,
            artifactCount: 4,
            newestArtifactAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      })
    );

    renderView();
    await openSetup();

    expect(await screen.findByText("Passphrases Bench still holds")).toBeInTheDocument();
    expect(screen.getByText(/4 encrypted backups still need it/)).toBeInTheDocument();
  });

  it("opens a backup from the keyboard, not only by clicking its row", async () => {
    // Every action a backup has lives behind opening it, so a mouse-only row
    // would put the whole feature out of reach for anyone not using one.
    renderView();

    const opener = await screen.findByRole("button", { name: /ago$/i });
    fireEvent.click(opener);

    expect(await screen.findByText("Restoring this")).toBeInTheDocument();
  });

  it("says what scanning does in a tooltip, and then just does it", async () => {
    // A dialog to explain a harmless, idempotent action is a dialog people
    // learn to dismiss without reading.
    mockedApi.discoverBackups.mockResolvedValue([]);
    renderView();
    await openSetup();

    const scan = await screen.findByRole("button", { name: /scan for backups/i });
    expect(scan).toHaveAttribute(
      "title",
      expect.stringContaining("only adds - nothing is changed, moved or deleted")
    );

    fireEvent.click(scan);
    await waitFor(() => expect(mockedApi.discoverBackups).toHaveBeenCalled());
  });

  it("labels the operational buttons with what they actually do", async () => {
    renderView();

    expect(await screen.findByRole("button", { name: /verify now/i })).toHaveAttribute(
      "title",
      expect.stringContaining("still readable")
    );
    expect(screen.getByRole("button", { name: /recovery sheet/i })).toHaveAttribute(
      "title",
      expect.stringContaining("without Bench")
    );
  });

  it("reports damage found by a manual verify as an error", async () => {
    mockedApi.scrubNow.mockResolvedValue([
      {
        destinationId: "dest-1",
        destinationName: "NAS volume",
        checked: 3,
        passed: 2,
        failed: 1,
        missing: 0,
        skipped: 0,
        artifacts: [],
      },
    ]);

    renderView();
    // Wait for the inventory: "Verify now" is disabled until there is something
    // to verify, and clicking a disabled button proves nothing.
    await screen.findByText("Verified", { selector: "span" });
    fireEvent.click(screen.getByRole("button", { name: /verify now/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("1 of 3 copies are damaged or missing")
    );
  });
});
