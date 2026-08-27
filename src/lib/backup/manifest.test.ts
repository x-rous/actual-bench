import {
  MANIFEST_VERSION,
  manifestKeyFor,
  parseManifest,
  serializeManifest,
  sha256,
  type BackupManifest,
} from "./manifest";

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    artifactId: "art-1",
    kind: "budget",
    createdAt: "2026-08-27T06:00:00.000Z",
    sizeBytes: 4096,
    checksumSha256: "a".repeat(64),
    plaintextChecksumSha256: "b".repeat(64),
    encryption: null,
    source: { budgetId: "budget-1", budgetName: "Household", serverUrl: "https://budget.example.com" },
    content: {
      accounts: 14,
      transactions: 8431,
      earliestTransaction: "2021-01-04",
      latestTransaction: "2026-08-26",
      integrityCheck: "ok",
    },
    verification: { level: "data", status: "passed", verifiedAt: "2026-08-27T06:00:05.000Z" },
    policy: { id: "pol-1", name: "Nightly" },
    tier: "daily",
    pinned: false,
    protectedUntil: null,
    takenBefore: null,
    benchVersion: "1.3.0",
    appDbSchemaVersion: 20,
    ...overrides,
  };
}

describe("checksums", () => {
  it("matches a known vector, so a stored checksum means the same thing next year", () => {
    expect(sha256(Buffer.from("abc", "utf8"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("changes when a single byte changes", () => {
    const a = sha256(Buffer.from("backup", "utf8"));
    const b = sha256(Buffer.from("backuq", "utf8"));
    expect(a).not.toBe(b);
  });
});

describe("manifest round trip", () => {
  it("survives serialization unchanged", () => {
    const original = manifest();
    const parsed = parseManifest(serializeManifest(original));
    expect(parsed).toEqual(original);
  });

  it("sits beside its artifact", () => {
    expect(manifestKeyFor("backups/household-2026-08-27.zip")).toBe(
      "backups/household-2026-08-27.zip.manifest.json"
    );
  });

  it("carries encryption parameters but never a key", () => {
    const parsed = parseManifest(
      serializeManifest(
        manifest({
          encryption: { algorithm: "aes-256-gcm", kdf: "scrypt", salt: "c2FsdA==", iv: "aXY=", authTag: "dGFn" },
        })
      )
    );

    expect(parsed?.encryption?.salt).toBe("c2FsdA==");
    // Nothing in the serialized form may resemble key material.
    const text = Buffer.from(serializeManifest(manifest())).toString("utf8");
    expect(text).not.toMatch(/passphrase|"key"|secret/i);
  });
});

describe("reading a manifest Bench did not write", () => {
  it("keeps what a future version does carry rather than rejecting the file", () => {
    // The case this exists for: someone points Bench at a directory written by
    // a newer release. Refusing to list a real backup because of an unfamiliar
    // field would be the exact failure the manifest is meant to prevent.
    const parsed = parseManifest(
      JSON.stringify({
        manifestVersion: 99,
        artifactId: "art-future",
        kind: "budget",
        createdAt: "2027-01-01T00:00:00.000Z",
        sizeBytes: 10,
        checksumSha256: "f".repeat(64),
        tier: "fortnightly",
        somethingNew: { nested: true },
        verification: { level: "quantum", status: "passed" },
      })
    );

    expect(parsed?.artifactId).toBe("art-future");
    expect(parsed?.manifestVersion).toBe(99);
    // An unknown tier is treated as manual: keeping a backup Bench does not
    // understand is always safer than pruning it.
    expect(parsed?.tier).toBe("manual");
    // An unreadable verification level is not reported as a verified backup.
    expect(parsed?.verification).toBeUndefined();
  });

  it("returns null only when there is no artifact to describe", () => {
    expect(parseManifest("not json at all")).toBeNull();
    expect(parseManifest(JSON.stringify({ artifactId: "x" }))).toBeNull();
    expect(parseManifest(JSON.stringify({ checksumSha256: "y", kind: "budget" }))).toBeNull();
    expect(parseManifest(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it("does not inherit a claim of verification from a malformed block", () => {
    const parsed = parseManifest(
      JSON.stringify({
        artifactId: "art-2",
        kind: "app-db",
        checksumSha256: "d".repeat(64),
        verification: "totally fine, trust me",
      })
    );

    expect(parsed?.verification).toBeUndefined();
  });
});
