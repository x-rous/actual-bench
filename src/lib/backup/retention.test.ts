import type { BackupArtifact, BackupRetention } from "@/lib/app-db/backupRepository";
import { DEFAULT_RETENTION } from "@/lib/app-db/backupRepository";
import { planRetention } from "./retention";

const NOW = new Date("2026-08-27T12:00:00.000Z");

let counter = 0;
function artifact(overrides: Partial<BackupArtifact> = {}): BackupArtifact {
  counter += 1;
  return {
    id: `art-${counter}`,
    policyId: "pol-1",
    kind: "budget",
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceBudgetId: "budget-1",
    sourceBudgetName: "Household",
    sizeBytes: 1024,
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
    verifiedAt: "2026-08-01T00:00:00.000Z",
    verification: null,
    manifestVersion: 1,
    benchVersion: null,
    notes: null,
    ...overrides,
  };
}

function daily(day: string, overrides: Partial<BackupArtifact> = {}): BackupArtifact {
  return artifact({ createdAt: `${day}T02:00:00.000Z`, ...overrides });
}

function pruneIds(artifacts: BackupArtifact[], retention: BackupRetention = DEFAULT_RETENTION) {
  return planRetention(artifacts, retention, NOW).prune.map((decision) => decision.artifactId);
}

describe("what retention refuses to delete", () => {
  it("never prunes a pin, whatever the rules say", () => {
    const pinned = daily("2020-01-01", { pinned: true });
    const plan = planRetention([daily("2026-08-26"), pinned], { ...DEFAULT_RETENTION, daily: 1 }, NOW);

    expect(plan.prune.map((entry) => entry.artifactId)).not.toContain(pinned.id);
    expect(plan.keep.find((entry) => entry.artifactId === pinned.id)?.reason).toMatch(/Pinned/);
  });

  it("never prunes the newest verified copy, even with every tier set to zero", () => {
    // The rule that makes everything else safe: no combination of settings can
    // empty a destination.
    const artifacts = [daily("2026-08-26"), daily("2026-08-20"), daily("2026-08-10")];
    const empty: BackupRetention = {
      daily: 0,
      weekly: 0,
      monthly: 0,
      yearly: 0,
      minimumAgeHours: 0,
      autoProtectionDays: 0,
      autoProtectionCount: 0,
    };

    const plan = planRetention(artifacts, empty, NOW);
    expect(plan.keep).toHaveLength(1);
    expect(plan.keep[0].artifactId).toBe(artifacts[0].id);
    expect(plan.keep[0].reason).toMatch(/last good one/);
  });

  it("keeps the newest verified copy in preference to a newer unverified one", () => {
    // A backup Bench could not read is not the copy to bet the last-good-copy
    // guarantee on.
    const broken = daily("2026-08-26", { verificationStatus: "failed" });
    const good = daily("2026-08-25");
    const plan = planRetention([broken, good], { ...DEFAULT_RETENTION, daily: 1, minimumAgeHours: 0 }, NOW);

    expect(plan.keep.map((entry) => entry.artifactId)).toContain(good.id);
    expect(plan.keep.find((entry) => entry.artifactId === good.id)?.reason).toMatch(/last good one/);
  });

  it("falls back to the newest copy when nothing has verified", () => {
    const artifacts = [
      daily("2026-08-26", { verificationStatus: "failed" }),
      daily("2026-08-25", { verificationStatus: "failed" }),
    ];
    const plan = planRetention(
      artifacts,
      { ...DEFAULT_RETENTION, daily: 0, weekly: 0, monthly: 0, yearly: 0, minimumAgeHours: 0 },
      NOW
    );

    expect(plan.keep).toHaveLength(1);
    expect(plan.keep[0].reason).toMatch(/nothing verified/);
  });

  it("keeps anything younger than the minimum age", () => {
    // A misconfigured schedule must not be able to cycle a day's worth of
    // backups out of existence in an afternoon. The newest copy here failed
    // verification, so it is not being kept by the last-good-copy rule.
    const fresh = artifact({ createdAt: "2026-08-27T09:00:00.000Z", verificationStatus: "failed" });
    const plan = planRetention(
      [daily("2026-08-26"), fresh, daily("2026-08-20")],
      { ...DEFAULT_RETENTION, daily: 1, weekly: 0, monthly: 0, yearly: 0 },
      NOW
    );

    expect(plan.keep.find((entry) => entry.artifactId === fresh.id)?.reason).toMatch(/24h/);
  });

  it("never expires a backup somebody took by hand", () => {
    const manual = daily("2024-01-01", { tier: "manual" });
    expect(pruneIds([daily("2026-08-26"), manual])).not.toContain(manual.id);
  });
});

describe("grandfather-father-son", () => {
  it("keeps one copy per day, week, month and year", () => {
    const artifacts = [
      daily("2026-08-26"),
      daily("2026-08-25"),
      daily("2026-08-24"),
      daily("2026-08-18"), // previous week
      daily("2026-07-15"), // previous month
      daily("2025-06-10"), // previous year
    ];

    const plan = planRetention(
      artifacts,
      { ...DEFAULT_RETENTION, daily: 3, weekly: 2, monthly: 2, yearly: 2, minimumAgeHours: 0 },
      NOW
    );

    // Newest is the last-good-copy survivor; the rest fill the tiers, and
    // nothing here is redundant enough to lose.
    expect(plan.prune).toHaveLength(0);
  });

  it("prunes the extra copies once a day already has one", () => {
    const kept = daily("2026-08-26");
    const same = artifact({ createdAt: "2026-08-26T22:00:00.000Z" });
    const older = artifact({ createdAt: "2026-08-26T06:00:00.000Z" });

    const plan = planRetention(
      [kept, same, older],
      { ...DEFAULT_RETENTION, daily: 1, weekly: 0, monthly: 0, yearly: 0, minimumAgeHours: 0 },
      NOW
    );

    // The newest survives as the last good copy and occupies the day's slot,
    // so with daily:1 the other two are redundant.
    expect(plan.prune).toHaveLength(2);
    expect(plan.prune[0].reason).toMatch(/Superseded/);
  });

  it("counts budgets and Bench's own database separately", () => {
    // Seven daily budget copies must not use up the allowance for the metadata
    // database, or one of them would silently stop being kept.
    const artifacts = [
      daily("2026-08-26"),
      daily("2026-08-25"),
      daily("2026-08-26", { kind: "app-db" }),
      daily("2026-08-25", { kind: "app-db" }),
    ];

    const plan = planRetention(
      artifacts,
      { ...DEFAULT_RETENTION, daily: 2, weekly: 0, monthly: 0, yearly: 0, minimumAgeHours: 0 },
      NOW
    );

    expect(plan.prune).toHaveLength(0);
    expect(plan.keep).toHaveLength(4);
  });

  it("keeps policies apart, so deleting one cannot thin another", () => {
    const plan = planRetention(
      [daily("2026-08-26"), daily("2026-08-26", { policyId: "pol-2" })],
      { ...DEFAULT_RETENTION, daily: 1, minimumAgeHours: 0 },
      NOW
    );

    expect(plan.prune).toHaveLength(0);
  });
});

describe("automatic recovery points", () => {
  it("protects them for the configured window rather than pinning them forever", () => {
    const recent = artifact({ createdAt: "2026-08-20T10:00:00.000Z", tier: "auto" });
    const old = artifact({ createdAt: "2026-06-01T10:00:00.000Z", tier: "auto" });

    const plan = planRetention(
      [daily("2026-08-26"), recent, old],
      { ...DEFAULT_RETENTION, autoProtectionCount: 1 },
      NOW
    );

    expect(plan.keep.find((entry) => entry.artifactId === recent.id)?.reason).toMatch(
      /protection window/
    );
    expect(plan.prune.map((entry) => entry.artifactId)).toContain(old.id);
  });

  it("keeps the newest few even after the window closes", () => {
    // Whichever protects more: the window or the count. Someone who does one
    // risky operation a year should still find the recovery point from it.
    const old = artifact({ createdAt: "2020-01-01T00:00:00.000Z", tier: "auto" });
    const plan = planRetention(
      [daily("2026-08-26"), old],
      { ...DEFAULT_RETENTION, autoProtectionDays: 1, autoProtectionCount: 5 },
      NOW
    );

    expect(plan.keep.map((entry) => entry.artifactId)).toContain(old.id);
  });

  it("lets them go once they are past both the window and the count", () => {
    const points = Array.from({ length: 4 }, (_, index) =>
      artifact({ createdAt: `2020-01-0${index + 1}T00:00:00.000Z`, tier: "auto" })
    );

    const plan = planRetention(
      [daily("2026-08-26"), ...points],
      { ...DEFAULT_RETENTION, autoProtectionDays: 1, autoProtectionCount: 2 },
      NOW
    );

    // Newest two protected by count; the rest expire.
    expect(plan.prune).toHaveLength(2);
  });
});

describe("explaining itself", () => {
  it("gives every artifact a reason, because a prune preview has to be readable", () => {
    const artifacts = [
      daily("2026-08-26"),
      daily("2026-08-25"),
      daily("2020-01-01"),
      daily("2020-01-02", { pinned: true }),
    ];

    const plan = planRetention(artifacts, DEFAULT_RETENTION, NOW);

    expect([...plan.keep, ...plan.prune]).toHaveLength(artifacts.length);
    for (const decision of [...plan.keep, ...plan.prune]) {
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it("decides nothing when there is nothing to decide", () => {
    expect(planRetention([], DEFAULT_RETENTION, NOW)).toEqual({ keep: [], prune: [] });
  });
});
