import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { logger } from "@/lib/logger";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { deleteAllServerVaultCredentials, getServerCredential, upsertServerCredential } from "./rememberedCredentials";
import { getSecret, hasSecret, putSecret, secretRefs } from "./store";
import {
  deleteSyncCredential,
  enrolBudget,
  enrolledConnectionFor,
  getSyncCredential,
  hasSyncCredential,
  resolveUnattendedSecret,
  upgradeLegacyUnattendedCredentials,
  listSyncCredentialMeta,
  upsertSyncCredential,
} from "./unattendedCredentials";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-vault-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const input = (fp: string) => ({
  connectionFingerprint: fp,
  mode: "http-api",
  baseUrl: "https://api.example.com",
  budgetSyncId: "budget-1",
  label: "Family",
  secret: { apiKey: "key-" + fp, encryptionPassword: "enc" },
});

describe("syncCredentialRepository (RD-058 / PR-024a)", () => {
  let root: string;
  let db: SqliteDatabase;
  const original = process.env.ACTUAL_BENCH_VAULT_KEY;

  beforeEach(() => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-operator-key";
    ({ root, db } = tempDb());
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (original === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = original;
  });

  it("enrolls, reads back the decrypted secret, and lists metadata without secrets", () => {
    upsertSyncCredential(db, input("fp-a"));
    const got = getSyncCredential(db, "fp-a");
    expect(got?.secret).toEqual({ apiKey: "key-fp-a", encryptionPassword: "enc" });
    expect(got?.budgetSyncId).toBe("budget-1");

    const meta = listSyncCredentialMeta(db);
    expect(meta).toHaveLength(1);
    // Metadata must not carry the secret.
    expect(JSON.stringify(meta)).not.toContain("key-fp-a");
    expect(hasSyncCredential(db, "fp-a")).toBe(true);
  });

  it("does not persist the plaintext secret in the row", () => {
    upsertSyncCredential(db, input("fp-b"));
    // Every stored secret is sealed, in the operator domain; nothing readable
    // lands in the enrolment record or the credential rows.
    const rows = db.prepare("SELECT domain, ciphertext FROM credentials").all<{ domain: string; ciphertext: string }>();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.domain === "operator")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("key-fp-b");
    const enrolment = db.prepare("SELECT * FROM unattended_connections WHERE connection_fingerprint = ?").get("fp-b");
    expect(JSON.stringify(enrolment)).not.toContain("key-fp-b");
  });

  it("upsert replaces on the same fingerprint (no duplicate)", () => {
    upsertSyncCredential(db, input("fp-c"));
    upsertSyncCredential(db, { ...input("fp-c"), secret: { apiKey: "rotated" } });
    expect(listSyncCredentialMeta(db)).toHaveLength(1);
    expect(getSyncCredential(db, "fp-c")?.secret.apiKey).toBe("rotated");
  });

  it("returns null for an unknown fingerprint and removes on delete", () => {
    expect(getSyncCredential(db, "missing")).toBeNull();
    upsertSyncCredential(db, input("fp-d"));
    deleteSyncCredential(db, "fp-d");
    expect(hasSyncCredential(db, "fp-d")).toBe(false);
  });

  describe("one enrolment per budget: switching modes (PR-071c)", () => {
    it("moves every automation, flow and backup rule to the new enrolment and withdraws the old one", () => {
      upsertSyncCredential(db, { ...input("fp-http"), budgetSyncId: "shared-budget" });
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO automation_definitions (id, type, name, enabled, execution_mode, schedule_kind, interval_minutes, timezone,
           target_ref_json, credential_ref, config_json, created_at, updated_at)
         VALUES ('auto-1', 'bank-sync', 'Bank sync', 1, 'server', 'interval', 60, 'UTC', ?, 'fp-http', ?, ?, ?)`
      ).run(
        JSON.stringify({ version: 1, data: { connectionFingerprint: "fp-http" } }),
        JSON.stringify({ version: 1, data: { connectionFingerprint: "fp-http", accountIds: [] } }),
        now,
        now
      );
      db.prepare(
        `INSERT INTO sync_flows (id, name, enabled, created_at, updated_at, source_ref_json, target_ref_json, filter_json, transform_json, options_json)
         VALUES ('flow-1', 'Flow', 1, ?, ?, ?, ?, '{"version":1,"data":{}}', '{"version":1,"data":{}}', '{"version":1,"data":{}}')`
      ).run(
        now,
        now,
        JSON.stringify({ version: 1, data: { connectionFingerprint: "fp-http", budgetId: "shared-budget" } }),
        JSON.stringify({ version: 1, data: { connectionFingerprint: "fp-elsewhere", budgetId: "b2" } })
      );

      const { credential, replaced } = enrolBudget(db, {
        connectionFingerprint: "fp-direct",
        mode: "browser-api",
        baseUrl: "https://actual.example.com",
        budgetSyncId: "shared-budget",
        secret: { serverPassword: "pw" },
      });

      expect(credential.connectionFingerprint).toBe("fp-direct");
      expect(replaced.map((old) => old.connectionFingerprint)).toEqual(["fp-http"]);
      // One enrolment for the budget, the new one.
      expect(listSyncCredentialMeta(db).map((meta) => meta.connectionFingerprint)).toEqual(["fp-direct"]);
      expect(hasSyncCredential(db, "fp-http")).toBe(false);

      const automation = db
        .prepare("SELECT credential_ref, config_json, target_ref_json FROM automation_definitions WHERE id = 'auto-1'")
        .get<{ credential_ref: string; config_json: string; target_ref_json: string }>()!;
      expect(automation.credential_ref).toBe("fp-direct");
      expect(JSON.parse(automation.config_json).data).toEqual({ connectionFingerprint: "fp-direct", accountIds: [] });
      expect(JSON.parse(automation.target_ref_json).data.connectionFingerprint).toBe("fp-direct");

      const flow = db
        .prepare("SELECT source_ref_json, target_ref_json FROM sync_flows WHERE id = 'flow-1'")
        .get<{ source_ref_json: string; target_ref_json: string }>()!;
      expect(JSON.parse(flow.source_ref_json).data.connectionFingerprint).toBe("fp-direct");
      // A different connection is left alone.
      expect(JSON.parse(flow.target_ref_json).data.connectionFingerprint).toBe("fp-elsewhere");
    });

    it("re-enrolling the same connection replaces nothing", () => {
      upsertSyncCredential(db, { ...input("fp-http"), budgetSyncId: "shared-budget" });
      const { replaced } = enrolBudget(db, { ...input("fp-http"), budgetSyncId: "shared-budget" });
      expect(replaced).toEqual([]);
      expect(listSyncCredentialMeta(db)).toHaveLength(1);
    });
  });

  describe("the same budget through both modes (PR-071c)", () => {
    it("uses the given enrolment, or another enrolment of the same budget", () => {
      upsertSyncCredential(db, { ...input("fp-http"), budgetSyncId: "shared-budget" });

      expect(enrolledConnectionFor(db, "fp-http", "shared-budget")).toBe("fp-http");
      // The flow was saved on the Direct connection, which is not enrolled.
      expect(enrolledConnectionFor(db, "fp-direct", "shared-budget")).toBe("fp-http");
      expect(enrolledConnectionFor(db, "fp-direct", "another-budget")).toBeNull();
      expect(enrolledConnectionFor(db, "fp-direct", null)).toBeNull();
    });
  });

  describe("Direct connections (RD-095)", () => {
    const direct = (fp: string) => ({
      connectionFingerprint: fp,
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-9",
      label: "Direct",
      secret: { serverPassword: "server-pw-" + fp, encryptionPassword: "enc-9" },
    });

    it("seals the server password and gives it back only to the server", () => {
      upsertSyncCredential(db, direct("fp-direct"));

      expect(resolveUnattendedSecret(db, "fp-direct")).toEqual({
        server: { kind: "direct", serverPassword: "server-pw-fp-direct" },
        encryptionPassword: "enc-9",
      });
      expect(getSyncCredential(db, "fp-direct")?.secret).toEqual({
        serverPassword: "server-pw-fp-direct",
        encryptionPassword: "enc-9",
      });
      const rows = db.prepare("SELECT ciphertext FROM credentials").all<{ ciphertext: string }>();
      expect(JSON.stringify(rows)).not.toContain("server-pw-fp-direct");
      expect(JSON.stringify(listSyncCredentialMeta(db))).not.toContain("server-pw-fp-direct");
    });

    it("refuses a secret that does not match the connection's mode, storing nothing", () => {
      expect(() =>
        upsertSyncCredential(db, { ...direct("fp-wrong"), secret: { apiKey: "not-a-password" } })
      ).toThrow("A Direct connection is enrolled with its server password.");
      expect(() => upsertSyncCredential(db, { ...input("fp-wrong-2"), secret: { serverPassword: "pw" } })).toThrow(
        "An HTTP API connection is enrolled with its API key."
      );
      expect(listSyncCredentialMeta(db)).toEqual([]);
    });
  });

  describe("one server secret per server (F-195)", () => {
    const onServer = (fp: string, budgetSyncId: string, apiKey: string, encryptionPassword?: string) => ({
      connectionFingerprint: fp,
      mode: "http-api",
      baseUrl: "https://api.example.com",
      budgetSyncId,
      label: "Family",
      secret: { apiKey, ...(encryptionPassword ? { encryptionPassword } : {}) },
    });
    const serverFp = serverFingerprint({ mode: "http-api", baseUrl: "https://api.example.com" });

    it("shares one server secret between budgets on the same server, with passwords per budget", () => {
      upsertSyncCredential(db, onServer("fp-1", "budget-1", "key-1", "enc-1"));
      upsertSyncCredential(db, onServer("fp-2", "budget-2", "key-1"));

      const serverSecrets = db
        .prepare("SELECT COUNT(*) AS n FROM credentials WHERE domain = 'operator' AND kind = 'server-login'")
        .get<{ n: number }>();
      expect(serverSecrets?.n).toBe(1);
      expect(resolveUnattendedSecret(db, "fp-1")).toEqual({
        server: { kind: "http-api", apiKey: "key-1" },
        encryptionPassword: "enc-1",
      });
      expect(resolveUnattendedSecret(db, "fp-2")).toEqual({ server: { kind: "http-api", apiKey: "key-1" } });
    });

    it("rotates a server's key for every budget on it at once", () => {
      upsertSyncCredential(db, onServer("fp-1", "budget-1", "old-key"));
      upsertSyncCredential(db, onServer("fp-2", "budget-2", "new-key"));

      expect(getSyncCredential(db, "fp-1")?.secret.apiKey).toBe("new-key");
    });

    it("keeps the server secret until the last budget on that server is withdrawn", () => {
      upsertSyncCredential(db, onServer("fp-1", "budget-1", "key-1", "enc-1"));
      upsertSyncCredential(db, onServer("fp-2", "budget-2", "key-1"));

      deleteSyncCredential(db, "fp-1");
      expect(hasSecret(db, "operator", secretRefs.budget(serverFp, "budget-1"))).toBe(false);
      expect(getSyncCredential(db, "fp-2")?.secret.apiKey).toBe("key-1");

      deleteSyncCredential(db, "fp-2");
      expect(hasSecret(db, "operator", secretRefs.server(serverFp))).toBe(false);
    });

    it("never touches remembered credentials, and a vault reset never touches enrolments", () => {
      const userKey = randomBytes(32);
      upsertServerCredential(
        db,
        { mode: "http-api", baseUrl: "https://api.example.com", secret: { apiKey: "remembered-key" } },
        userKey
      );
      upsertSyncCredential(db, onServer("fp-1", "budget-1", "unattended-key"));

      deleteSyncCredential(db, "fp-1");
      expect(getServerCredential(db, serverFp, userKey)?.secret.apiKey).toBe("remembered-key");

      upsertSyncCredential(db, onServer("fp-1", "budget-1", "unattended-key"));
      deleteAllServerVaultCredentials(db);
      expect(getSyncCredential(db, "fp-1")?.secret.apiKey).toBe("unattended-key");
    });
  });

  describe("secrets enrolled before schema v35", () => {
    const serverFp = serverFingerprint({ mode: "http-api", baseUrl: "https://api.example.com" });

    /** An enrolment as migration v35 leaves it: metadata, plus the old blob kept whole. */
    function legacyEnrolment(
      fp: string,
      budgetSyncId: string,
      secret: { apiKey: string; encryptionPassword?: string },
      updatedAt: string
    ): void {
      db.prepare(
        `INSERT INTO unattended_connections (connection_fingerprint, server_fingerprint, mode, base_url, budget_sync_id, label, created_at, updated_at)
         VALUES (?, ?, 'http-api', 'https://api.example.com', ?, '', ?, ?)`
      ).run(fp, serverFp, budgetSyncId, updatedAt, updatedAt);
      putSecret(db, { domain: "operator" }, {
        ref: secretRefs.legacyConnection(fp),
        kind: "legacy-http-connection",
        plaintext: JSON.stringify(secret),
      });
      db.prepare("UPDATE credentials SET updated_at = ? WHERE ref = ?").run(updatedAt, secretRefs.legacyConnection(fp));
    }

    it("splits them into one server secret and per-budget passwords, keeping the newest key", () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
      legacyEnrolment("fp-old", "budget-1", { apiKey: "rotated-away", encryptionPassword: "enc-1" }, "2026-01-01T00:00:00.000Z");
      legacyEnrolment("fp-new", "budget-2", { apiKey: "current" }, "2026-06-01T00:00:00.000Z");

      expect(upgradeLegacyUnattendedCredentials(db)).toEqual({ upgraded: 2, failed: 0 });

      expect(getSyncCredential(db, "fp-old")?.secret).toEqual({ apiKey: "current", encryptionPassword: "enc-1" });
      expect(getSyncCredential(db, "fp-new")?.secret).toEqual({ apiKey: "current" });
      expect(hasSecret(db, "operator", secretRefs.legacyConnection("fp-old"))).toBe(false);
      expect(warn.mock.calls.some(([message]) => String(message).includes("held different API keys"))).toBe(true);

      // Idempotent: nothing left to split.
      expect(upgradeLegacyUnattendedCredentials(db)).toEqual({ upgraded: 0, failed: 0 });
      warn.mockRestore();
    });

    it("splits a server's legacy secrets together on first use, so the order read cannot decide the key", () => {
      legacyEnrolment("fp-old", "budget-1", { apiKey: "rotated-away" }, "2026-01-01T00:00:00.000Z");
      legacyEnrolment("fp-new", "budget-2", { apiKey: "current" }, "2026-06-01T00:00:00.000Z");

      // The older enrolment is read first.
      expect(getSyncCredential(db, "fp-old")?.secret.apiKey).toBe("current");
      expect(getSyncCredential(db, "fp-new")?.secret.apiKey).toBe("current");
    });

    it("never overwrites a key enrolled after the upgrade with an older one", () => {
      legacyEnrolment("fp-old", "budget-1", { apiKey: "stale" }, "2026-01-01T00:00:00.000Z");
      upsertSyncCredential(db, {
        connectionFingerprint: "fp-fresh",
        mode: "http-api",
        baseUrl: "https://api.example.com",
        budgetSyncId: "budget-9",
        secret: { apiKey: "fresh" },
      });

      upgradeLegacyUnattendedCredentials(db);

      expect(getSyncCredential(db, "fp-old")?.secret.apiKey).toBe("fresh");
    });

    it("leaves them untouched, and fails closed, when the key cannot open them", () => {
      legacyEnrolment("fp-old", "budget-1", { apiKey: "key-1" }, "2026-01-01T00:00:00.000Z");
      const before = getSecret(db, { domain: "operator" }, secretRefs.legacyConnection("fp-old"));
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});

      // A key that opens nothing stored locks the vault, so the upgrade does
      // not even try.
      process.env.ACTUAL_BENCH_VAULT_KEY = "a-different-key";
      expect(upgradeLegacyUnattendedCredentials(db)).toEqual({ upgraded: 0, failed: 0 });
      expect(() => getSyncCredential(db, "fp-old")).toThrow();
      expect(hasSyncCredential(db, "fp-old")).toBe(true);

      process.env.ACTUAL_BENCH_VAULT_KEY = "test-operator-key";
      expect(getSecret(db, { domain: "operator" }, secretRefs.legacyConnection("fp-old"))?.plaintext).toBe(
        before?.plaintext
      );
      warn.mockRestore();
    });

    it("does nothing without the vault key", () => {
      legacyEnrolment("fp-old", "budget-1", { apiKey: "key-1" }, "2026-01-01T00:00:00.000Z");
      delete process.env.ACTUAL_BENCH_VAULT_KEY;
      expect(upgradeLegacyUnattendedCredentials(db)).toEqual({ upgraded: 0, failed: 0 });
      process.env.ACTUAL_BENCH_VAULT_KEY = "test-operator-key";
    });
  });
});

