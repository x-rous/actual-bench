import type { BackupArtifact } from "@/lib/app-db/backupRepository";
import { contentOf, detectBackupAnomalies } from "./anomaly";

function previousArtifact(overrides: Partial<BackupArtifact> = {}): BackupArtifact {
  return {
    id: "art-prev",
    policyId: "pol-1",
    kind: "budget",
    createdAt: "2026-08-26T02:00:00.000Z",
    sourceBudgetId: "budget-1",
    sourceBudgetName: "Household",
    sizeBytes: 2_000_000,
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
    verifiedAt: "2026-08-26T02:00:05.000Z",
    verification: {
      version: 1,
      data: { content: { transactions: 5000, accounts: 12 }, findings: [] },
    },
    manifestVersion: 1,
    benchVersion: null,
    notes: null,
    ...overrides,
  };
}

describe("noticing a backup that got suspiciously smaller", () => {
  it("says nothing about the first backup of anything", () => {
    // Crying wolf on day one is the fastest way to make this signal worthless.
    expect(
      detectBackupAnomalies({
        content: { transactions: 5000, accounts: 12 },
        sizeBytes: 2_000_000,
        previous: null,
        previousContent: null,
      })
    ).toEqual([]);
  });

  it("ignores ordinary growth and ordinary noise", () => {
    const previous = previousArtifact();
    expect(
      detectBackupAnomalies({
        content: { transactions: 5120, accounts: 12 },
        sizeBytes: 2_050_000,
        previous,
        previousContent: contentOf(previous),
      })
    ).toEqual([]);

    // A handful of deleted transactions is not an anomaly.
    expect(
      detectBackupAnomalies({
        content: { transactions: 4900, accounts: 12 },
        sizeBytes: 1_990_000,
        previous,
        previousContent: contentOf(previous),
      })
    ).toEqual([]);
  });

  it("flags a sharp drop in transactions with both numbers", () => {
    const previous = previousArtifact();
    const findings = detectBackupAnomalies({
      content: { transactions: 2500, accounts: 12 },
      sizeBytes: 1_900_000,
      previous,
      previousContent: contentOf(previous),
    });

    expect(findings[0]).toMatch(/50% fewer transactions/);
    expect(findings[0]).toMatch(/5,000 → 2,500/);
    // It states the change and leaves the judgement with the person who knows
    // whether they deleted anything.
    expect(findings[0]).toMatch(/If you deleted them, this is expected/);
  });

  it("flags an account that has gone missing", () => {
    const previous = previousArtifact();
    const findings = detectBackupAnomalies({
      content: { transactions: 5000, accounts: 11 },
      sizeBytes: 2_000_000,
      previous,
      previousContent: contentOf(previous),
    });

    expect(findings[0]).toMatch(/1 fewer account/);
  });

  it("catches a truncated export by size, even with no counts to compare", () => {
    // The only signal available for a copy of Bench's own database, and the
    // backstop when an export is too broken to count anything.
    const previous = previousArtifact({ kind: "app-db", verification: null });
    const findings = detectBackupAnomalies({
      content: {},
      sizeBytes: 400_000,
      previous,
      previousContent: contentOf(previous),
    });

    expect(findings[0]).toMatch(/less than half the size/);
    expect(findings[0]).toMatch(/cut short/);
  });

  it("reads a content summary off an artifact, and copes when there is none", () => {
    expect(contentOf(previousArtifact())?.transactions).toBe(5000);
    expect(contentOf(previousArtifact({ verification: null }))).toBeNull();
    expect(contentOf(null)).toBeNull();
  });
});
