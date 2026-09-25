/**
 * @jest-environment node
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { logger } from "@/lib/logger";
import { VaultLockedError } from "@/lib/sync/vault";
import { getSecret, putSecret } from "./store";
import { createVaultKeyFile, vaultKeyPath } from "./vaultKey";
import { getVaultState, logVaultState, resetVault, VaultResetRefusedError } from "./vaultState";

/**
 * The vault always exists (F-197). What these tests pin down is the one rule
 * that keeps that safe: a key is generated only when nothing is stored, and
 * with secrets stored the only acceptable key is one that opens them.
 */
describe("vault state", () => {
  const saved = {
    key: process.env.ACTUAL_BENCH_VAULT_KEY,
    legacy: process.env.SYNC_VAULT_KEY,
    db: process.env.ACTUAL_BENCH_DB_PATH,
  };
  let root: string;
  let db: SqliteDatabase;
  let keyPath: string;
  const operator = { domain: "operator" as const };

  function storeOperatorSecret(ref = "server:srv-1", plaintext = "api-key-1"): void {
    putSecret(db, operator, { ref, kind: "server-login", plaintext });
  }

  beforeEach(() => {
    delete process.env.ACTUAL_BENCH_VAULT_KEY;
    delete process.env.SYNC_VAULT_KEY;
    root = mkdtempSync(join(tmpdir(), "actual-bench-vault-state-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "actual-bench.sqlite");
    db = getAppDb(process.env.ACTUAL_BENCH_DB_PATH);
    keyPath = vaultKeyPath();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    for (const [name, value] of Object.entries({
      ACTUAL_BENCH_VAULT_KEY: saved.key,
      SYNC_VAULT_KEY: saved.legacy,
      ACTUAL_BENCH_DB_PATH: saved.db,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe("a fresh install", () => {
    it("generates a key file beside the database, readable only by Bench, and is ready", () => {
      expect(keyPath).toBe(join(root, "secrets", "vault.key"));

      const state = getVaultState(db);

      expect(state).toMatchObject({ status: "ready", source: "file", generated: true, storedSecrets: 0 });
      const key = readFileSync(keyPath, "utf8").trim();
      expect(Buffer.from(key, "base64url")).toHaveLength(32);
      if (process.platform !== "win32") {
        expect(statSync(keyPath).mode & 0o777).toBe(0o600);
        expect(statSync(join(root, "secrets")).mode & 0o777).toBe(0o700);
      }
      // Nothing left behind from the write.
      expect(readdirSync(join(root, "secrets"))).toEqual(["vault.key"]);
    });

    it("keeps the same key on every later check", () => {
      getVaultState(db);
      const first = readFileSync(keyPath, "utf8");

      const again = getVaultState(db);

      expect(again).toMatchObject({ status: "ready", source: "file" });
      expect(again.generated).toBeUndefined();
      expect(readFileSync(keyPath, "utf8")).toBe(first);
    });

    it("gets its key on the first secret stored, and that secret opens", () => {
      storeOperatorSecret();

      expect(existsSync(keyPath)).toBe(true);
      expect(getSecret(db, operator, "server:srv-1")?.plaintext).toBe("api-key-1");
    });

    it("never writes a second key: a racing writer reads the first one's", () => {
      const first = createVaultKeyFile();
      // A temp file from a writer that died mid-way is harmless.
      writeFileSync(`${keyPath}.deadbeef0000.tmp`, "half-written");

      const second = createVaultKeyFile();

      expect(second).toBe(first);
      expect(readFileSync(keyPath, "utf8").trim()).toBe(first);
    });

    it("is locked, not crashed, when the key cannot be written", () => {
      // A file where the secrets folder should be: mkdir fails whoever runs this.
      writeFileSync(join(root, "secrets"), "not a folder");

      const state = getVaultState(db);

      expect(state).toMatchObject({ status: "locked", reason: "cannot-create" });
      expect(state.detail).toBeTruthy();
    });
  });

  describe("where the key comes from", () => {
    it("prefers ACTUAL_BENCH_VAULT_KEY and creates no file", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";

      expect(getVaultState(db)).toMatchObject({ status: "ready", source: "environment" });
      expect(existsSync(keyPath)).toBe(false);
    });

    it("still accepts the old SYNC_VAULT_KEY name, with a warning", () => {
      process.env.SYNC_VAULT_KEY = "operator-key";

      expect(getVaultState(db)).toMatchObject({
        status: "ready",
        source: "legacy-environment",
        warning: "legacy-name",
      });
    });

    it("uses the new name when both are set and differ, and says so", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "new-key";
      process.env.SYNC_VAULT_KEY = "old-key";
      storeOperatorSecret();

      delete process.env.SYNC_VAULT_KEY;
      expect(getSecret(db, operator, "server:srv-1")?.plaintext).toBe("api-key-1");
      process.env.SYNC_VAULT_KEY = "old-key";
      expect(getVaultState(db)).toMatchObject({ status: "ready", source: "environment", warning: "both-names" });
    });

    it("ignores the key file while an environment key is set", () => {
      getVaultState(db); // generates a file key
      process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";

      expect(getVaultState(db)).toMatchObject({ status: "ready", source: "environment" });
    });

    it("accepts a key file the operator mounted, whatever its format", () => {
      mkdirSync(join(root, "secrets"));
      writeFileSync(keyPath, "  my-docker-secret\n");

      storeOperatorSecret();

      process.env.ACTUAL_BENCH_VAULT_KEY = "my-docker-secret";
      expect(getSecret(db, operator, "server:srv-1")?.plaintext).toBe("api-key-1");
    });
  });

  describe("with secrets stored", () => {
    it("adopts the key that sealed them after an upgrade", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";
      storeOperatorSecret();

      expect(getVaultState(db)).toMatchObject({ status: "ready", storedSecrets: 1 });
    });

    it("is locked, and generates nothing, when the key is missing", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";
      storeOperatorSecret();
      delete process.env.ACTUAL_BENCH_VAULT_KEY;

      expect(getVaultState(db)).toMatchObject({ status: "locked", reason: "missing", storedSecrets: 1 });
      expect(existsSync(keyPath)).toBe(false);
    });

    it("is locked by a key that does not open them, and refuses to seal more under it", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "key-one";
      storeOperatorSecret();
      process.env.ACTUAL_BENCH_VAULT_KEY = "key-two";

      expect(getVaultState(db)).toMatchObject({ status: "locked", reason: "wrong-key" });
      expect(() => storeOperatorSecret("server:srv-2", "other")).toThrow(VaultLockedError);
    });

    it("is ready while any stored secret opens, so one damaged row does not lock the vault", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";
      storeOperatorSecret("server:srv-1");
      storeOperatorSecret("server:srv-2");
      db.prepare("UPDATE credentials SET ciphertext = ? WHERE ref = 'server:srv-1'").run(
        randomBytes(16).toString("base64")
      );

      expect(getVaultState(db).status).toBe("ready");
    });

    it("accepts a new key once nothing is stored", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "key-one";
      storeOperatorSecret();
      db.prepare("DELETE FROM credentials WHERE domain = 'operator'").run();
      process.env.ACTUAL_BENCH_VAULT_KEY = "key-two";

      expect(getVaultState(db).status).toBe("ready");
    });

    it("ignores remembered (passphrase-domain) secrets entirely", () => {
      putSecret(db, { domain: "passphrase", key: randomBytes(32) }, {
        ref: "server:srv-1",
        kind: "server-login",
        plaintext: "remembered",
      });

      expect(getVaultState(db)).toMatchObject({ status: "ready", storedSecrets: 0, generated: true });
    });
  });

  it("is locked by an empty key file, and leaves the file alone", () => {
    mkdirSync(join(root, "secrets"));
    writeFileSync(keyPath, "\n");

    expect(getVaultState(db)).toMatchObject({ status: "locked", reason: "unreadable" });
    expect(readFileSync(keyPath, "utf8")).toBe("\n");
  });

  describe("reset", () => {
    function enrol(): void {
      storeOperatorSecret();
      db.prepare(
        `INSERT INTO unattended_connections
           (connection_fingerprint, server_fingerprint, mode, base_url, budget_sync_id, created_at, updated_at)
         VALUES ('conn-1', 'srv-1', 'http-api', 'http://actual', 'budget-1', 'now', 'now')`
      ).run();
    }

    it("is refused while the vault works", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";
      enrol();

      expect(() => resetVault(db)).toThrow(VaultResetRefusedError);
      expect(getSecret(db, operator, "server:srv-1")?.plaintext).toBe("api-key-1");
    });

    it("is refused when the only problem is an unwritable folder", () => {
      writeFileSync(join(root, "secrets"), "not a folder");

      expect(() => resetVault(db)).toThrow(VaultResetRefusedError);
    });

    it("clears a vault whose key is gone, keeps remembered secrets, and starts again with a new key", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";
      enrol();
      const userKey = randomBytes(32);
      putSecret(db, { domain: "passphrase", key: userKey }, { ref: "server:srv-1", kind: "server-login", plaintext: "remembered" });
      delete process.env.ACTUAL_BENCH_VAULT_KEY;

      const state = resetVault(db);

      expect(state).toMatchObject({ status: "ready", source: "file", generated: true, storedSecrets: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM unattended_connections").get<{ n: number }>()?.n).toBe(0);
      expect(getSecret(db, { domain: "passphrase", key: userKey }, "server:srv-1")?.plaintext).toBe("remembered");
    });

    it("adopts the key it has after clearing secrets another key sealed", () => {
      process.env.ACTUAL_BENCH_VAULT_KEY = "key-one";
      enrol();
      process.env.ACTUAL_BENCH_VAULT_KEY = "key-two";

      expect(resetVault(db)).toMatchObject({ status: "ready", source: "environment" });
      expect(existsSync(keyPath)).toBe(false);
    });

    it("moves an unreadable key file aside rather than deleting it", () => {
      mkdirSync(join(root, "secrets"));
      writeFileSync(keyPath, "");

      expect(resetVault(db)).toMatchObject({ status: "ready", generated: true });
      const names = readdirSync(join(root, "secrets"));
      expect(names).toContain("vault.key");
      expect(names.some((name) => name.startsWith("vault.key.unreadable-"))).toBe(true);
    });
  });

  it("never puts key material in its state or its log lines", () => {
    const lines: string[] = [];
    const capture = (message: string, meta?: unknown) => {
      lines.push(meta === undefined ? message : `${message} ${JSON.stringify(meta)}`);
    };
    for (const level of ["info", "warn", "error", "debug"] as const) {
      jest.spyOn(logger, level).mockImplementation(capture);
    }
    process.env.SYNC_VAULT_KEY = "legacy-secret-value";
    process.env.ACTUAL_BENCH_VAULT_KEY = "env-secret-value";
    logVaultState(getVaultState(db));
    delete process.env.ACTUAL_BENCH_VAULT_KEY;
    delete process.env.SYNC_VAULT_KEY;
    const generated = getVaultState(db);
    logVaultState(generated);
    const fileKey = readFileSync(keyPath, "utf8").trim();

    const everything = JSON.stringify(generated) + lines.join("\n");
    for (const secret of ["legacy-secret-value", "env-secret-value", fileKey]) {
      expect(everything).not.toContain(secret);
    }
    expect(lines.length).toBeGreaterThan(0);
  });
});
