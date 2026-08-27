import { createHash } from "node:crypto";

/**
 * The manifest written beside every backup artifact (RD-077 / PR-047a).
 *
 * Its job is to make a bare destination self-describing. Someone who has lost
 * their Bench database entirely — the machine died, the volume was recreated —
 * should be able to point Bench at a directory or a bucket and get their
 * inventory back, because each file is accompanied by everything needed to
 * understand it. That is also why the index in the app DB is a cache of these
 * rather than the only record: an index living inside the database it indexes
 * is not an index you can rely on.
 *
 * Two rules follow from that:
 *
 *   * **It is versioned, and read forgivingly.** A manifest written by a newer
 *     Bench is a normal thing to meet, and the answer is to read what it does
 *     carry rather than to reject the file — refusing to list a real backup
 *     because its manifest has an unfamiliar field would be the exact failure
 *     this feature exists to prevent.
 *   * **It never contains a key.** Encryption parameters (KDF, salt, IV) travel
 *     with the artifact because they are useless without the passphrase; the
 *     passphrase and the derived key do not.
 */

export const MANIFEST_VERSION = 1;

/** Suffix appended to an artifact's object key to locate its manifest. */
export const MANIFEST_SUFFIX = ".manifest.json";

export type BackupArtifactKind = "budget" | "app-db";

export type BackupVerificationLevel = "archive" | "data" | "deep";

export type BackupVerificationStatus = "unverified" | "passed" | "failed";

export type BackupRetentionTier =
  | "manual"
  | "auto"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly";

export type BackupEncryptionInfo = {
  algorithm: "aes-256-gcm";
  kdf: "scrypt";
  /** Base64. Public by design — a salt is not a secret. */
  salt: string;
  iv: string;
  authTag: string;
};

/** What an artifact was found to contain, recorded at verification time. */
export type BackupContentSummary = {
  accounts?: number;
  transactions?: number;
  payees?: number;
  categories?: number;
  /** Earliest and latest transaction dates, ISO `YYYY-MM-DD`. */
  earliestTransaction?: string | null;
  latestTransaction?: string | null;
  integrityCheck?: string;
};

export type BackupManifest = {
  manifestVersion: number;
  artifactId: string;
  kind: BackupArtifactKind;
  createdAt: string;
  /** Bytes as stored — encrypted size when the artifact is encrypted. */
  sizeBytes: number;
  checksumSha256: string;
  /** Of the archive before encryption, so a restore is checkable end to end. */
  plaintextChecksumSha256?: string | null;
  encryption?: BackupEncryptionInfo | null;
  source?: {
    budgetId?: string | null;
    budgetName?: string | null;
    serverUrl?: string | null;
  };
  content?: BackupContentSummary;
  verification?: {
    level: BackupVerificationLevel;
    status: BackupVerificationStatus;
    verifiedAt?: string | null;
    findings?: string[];
  };
  policy?: {
    id?: string | null;
    name?: string | null;
  };
  tier: BackupRetentionTier;
  pinned: boolean;
  protectedUntil?: string | null;
  takenBefore?: string | null;
  benchVersion?: string | null;
  appDbSchemaVersion?: number | null;
};

export function sha256(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function manifestKeyFor(objectKey: string): string {
  return `${objectKey}${MANIFEST_SUFFIX}`;
}

export function serializeManifest(manifest: BackupManifest): Uint8Array {
  // Buffer rather than TextEncoder: this module already imports node:crypto, so
  // it is server-only by construction, and Buffer is what the rest of the
  // server-side code here speaks.
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEncryption(value: unknown): BackupEncryptionInfo | null {
  if (!isRecord(value)) return null;
  const salt = str(value.salt);
  const iv = str(value.iv);
  const authTag = str(value.authTag);
  if (!salt || !iv || !authTag) return null;
  return { algorithm: "aes-256-gcm", kdf: "scrypt", salt, iv, authTag };
}

function readContent(value: unknown): BackupContentSummary | undefined {
  if (!isRecord(value)) return undefined;
  const summary: BackupContentSummary = {};
  for (const key of ["accounts", "transactions", "payees", "categories"] as const) {
    const parsed = num(value[key]);
    if (parsed !== undefined) summary[key] = parsed;
  }
  summary.earliestTransaction = str(value.earliestTransaction) ?? null;
  summary.latestTransaction = str(value.latestTransaction) ?? null;
  const integrity = str(value.integrityCheck);
  if (integrity) summary.integrityCheck = integrity;
  return summary;
}

const LEVELS: BackupVerificationLevel[] = ["archive", "data", "deep"];
const STATUSES: BackupVerificationStatus[] = ["unverified", "passed", "failed"];
const TIERS: BackupRetentionTier[] = ["manual", "auto", "daily", "weekly", "monthly", "yearly"];

/**
 * Read a manifest, keeping whatever is legible.
 *
 * Returns null only when the file cannot identify an artifact at all — no id,
 * no checksum, no kind — because at that point there is nothing to list. Every
 * other unfamiliar or missing field is tolerated: a manifest from a future
 * version must still yield a usable inventory row today.
 */
export function parseManifest(input: string | Uint8Array): BackupManifest | null {
  let raw: unknown;
  try {
    const text = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  const artifactId = str(raw.artifactId);
  const checksum = str(raw.checksumSha256);
  const kind = raw.kind === "app-db" ? "app-db" : raw.kind === "budget" ? "budget" : undefined;
  if (!artifactId || !checksum || !kind) return null;

  const verificationRaw = isRecord(raw.verification) ? raw.verification : undefined;
  const level = LEVELS.find((entry) => entry === verificationRaw?.level);
  const status = STATUSES.find((entry) => entry === verificationRaw?.status);

  return {
    manifestVersion: num(raw.manifestVersion) ?? MANIFEST_VERSION,
    artifactId,
    kind,
    createdAt: str(raw.createdAt) ?? new Date(0).toISOString(),
    sizeBytes: num(raw.sizeBytes) ?? 0,
    checksumSha256: checksum,
    plaintextChecksumSha256: str(raw.plaintextChecksumSha256) ?? null,
    encryption: readEncryption(raw.encryption),
    source: isRecord(raw.source)
      ? {
          budgetId: str(raw.source.budgetId) ?? null,
          budgetName: str(raw.source.budgetName) ?? null,
          serverUrl: str(raw.source.serverUrl) ?? null,
        }
      : undefined,
    content: readContent(raw.content),
    verification: level
      ? {
          level,
          status: status ?? "unverified",
          verifiedAt: str(verificationRaw?.verifiedAt) ?? null,
          findings: Array.isArray(verificationRaw?.findings)
            ? verificationRaw.findings.filter((entry): entry is string => typeof entry === "string")
            : undefined,
        }
      : undefined,
    policy: isRecord(raw.policy)
      ? { id: str(raw.policy.id) ?? null, name: str(raw.policy.name) ?? null }
      : undefined,
    // An unfamiliar tier from a newer version is treated as manual: keeping a
    // backup Bench does not understand is always safer than pruning it.
    tier: TIERS.find((entry) => entry === raw.tier) ?? "manual",
    pinned: raw.pinned === true,
    protectedUntil: str(raw.protectedUntil) ?? null,
    takenBefore: str(raw.takenBefore) ?? null,
    benchVersion: str(raw.benchVersion) ?? null,
    appDbSchemaVersion: num(raw.appDbSchemaVersion) ?? null,
  };
}
