import {
  CONNECTION_KDF_PARAMS,
  CURRENT_KDF_VERSION,
  deriveKeyFromPassphrase,
  resolveKdfParams,
  openSecret,
  openWithKey,
  sealSecret,
  sealWithKey,
  VaultLockedError,
} from "./vault";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

describe("credential vault (RD-058 / PR-024a)", () => {
  const saved = {
    key: process.env.ACTUAL_BENCH_VAULT_KEY,
    legacy: process.env.SYNC_VAULT_KEY,
    db: process.env.ACTUAL_BENCH_DB_PATH,
  };
  afterEach(() => {
    for (const [name, value] of Object.entries({
      ACTUAL_BENCH_VAULT_KEY: saved.key,
      SYNC_VAULT_KEY: saved.legacy,
      ACTUAL_BENCH_DB_PATH: saved.db,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("is locked with no key anywhere: sealing and opening throw, and nothing is generated here", () => {
    const root = mkdtempSync(join(tmpdir(), "vault-none-"));
    try {
      delete process.env.ACTUAL_BENCH_VAULT_KEY;
      delete process.env.SYNC_VAULT_KEY;
      process.env.ACTUAL_BENCH_DB_PATH = join(root, "actual-bench.sqlite");
      expect(() => sealSecret("x")).toThrow(VaultLockedError);
      expect(() => openSecret({ ciphertext: "a", iv: "b", authTag: "c" })).toThrow(VaultLockedError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("opens under the old SYNC_VAULT_KEY name what the new name sealed, when they hold the same key", () => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "shared-key";
    const sealed = sealSecret("secret");
    delete process.env.ACTUAL_BENCH_VAULT_KEY;
    process.env.SYNC_VAULT_KEY = "shared-key";
    expect(openSecret(sealed)).toBe("secret");
  });

  it("round-trips a secret", () => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "operator-secret-123";
    const sealed = sealSecret(JSON.stringify({ apiKey: "k-abc", encryptionPassword: "p" }));
    expect(sealed.ciphertext).not.toContain("k-abc"); // actually encrypted
    expect(JSON.parse(openSecret(sealed))).toEqual({ apiKey: "k-abc", encryptionPassword: "p" });
  });

  it("fails to open under a different key (rotation invalidates ciphertext)", () => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "key-one";
    const sealed = sealSecret("secret");
    process.env.ACTUAL_BENCH_VAULT_KEY = "key-two";
    expect(() => openSecret(sealed)).toThrow();
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "key-one";
    const sealed = sealSecret("secret");
    const tampered = { ...sealed, ciphertext: Buffer.from("tampered").toString("base64") };
    expect(() => openSecret(tampered)).toThrow();
  });
});

describe("explicit-key vault primitives (RD-061 / PR-026a)", () => {
  it("round-trips with an explicit key, and the ciphertext is not plaintext", () => {
    const key = randomBytes(32);
    const sealed = sealWithKey(JSON.stringify({ serverPassword: "hunter2" }), key);
    expect(sealed.ciphertext).not.toContain("hunter2");
    expect(JSON.parse(openWithKey(sealed, key))).toEqual({ serverPassword: "hunter2" });
  });

  it("fails to open under a different key", () => {
    const sealed = sealWithKey("secret", randomBytes(32));
    expect(() => openWithKey(sealed, randomBytes(32))).toThrow();
  });

  it("derives a stable 32-byte key from a passphrase + salt (scrypt)", () => {
    const salt = randomBytes(16);
    const a = deriveKeyFromPassphrase("correct horse battery staple", salt);
    const b = deriveKeyFromPassphrase("correct horse battery staple", salt);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
    // Different passphrase or salt → different key.
    expect(a.equals(deriveKeyFromPassphrase("wrong", salt))).toBe(false);
    expect(a.equals(deriveKeyFromPassphrase("correct horse battery staple", randomBytes(16)))).toBe(false);
  });

  it("a passphrase-derived key opens what it sealed but a wrong passphrase does not", () => {
    const salt = randomBytes(16);
    const key = deriveKeyFromPassphrase("right-pass", salt);
    const sealed = sealWithKey("api-key-xyz", key);
    expect(openWithKey(sealed, key)).toBe("api-key-xyz");
    expect(() => openWithKey(sealed, deriveKeyFromPassphrase("wrong-pass", salt))).toThrow();
  });
});

/**
 * The rest of the suite runs with a lowered `N` (jest.env.cjs) so the vault
 * suites test vault logic rather than scrypt. This block is the counterweight:
 * it pins the parameters that actually ship and pays their real cost once, so
 * the override can never quietly become the product's KDF.
 */
describe("shipped KDF parameters", () => {
  it("meets the OWASP scrypt floor, with maxmem covering 128 * N * r", () => {
    const params = CONNECTION_KDF_PARAMS[CURRENT_KDF_VERSION];
    expect(params).toEqual({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
    // Node's default 32 MiB cap would reject this N; the table must carry room
    // for the 128 * N * r bytes scrypt actually needs (~134 MiB here).
    expect(params.maxmem).toBeGreaterThan(128 * params.N * params.r);
  });

  it("derives at the shipped cost when the parameters are passed explicitly", () => {
    const salt = randomBytes(16);
    const params = CONNECTION_KDF_PARAMS[CURRENT_KDF_VERSION];
    const key = deriveKeyFromPassphrase("shipped-cost-pass", salt, params);
    expect(key.length).toBe(32);
    // Same passphrase and salt at the *test* cost must not produce the shipped
    // key — proof the override changes the derivation rather than being ignored.
    expect(key.equals(deriveKeyFromPassphrase("shipped-cost-pass", salt))).toBe(false);
  });

  it("only ever lowers the cost, and only under NODE_ENV=test", () => {
    const shipped = CONNECTION_KDF_PARAMS[CURRENT_KDF_VERSION];
    expect(resolveKdfParams().N).toBeLessThanOrEqual(shipped.N);
    // r, p and maxmem are never touched by the override.
    expect(resolveKdfParams()).toMatchObject({ r: shipped.r, p: shipped.p, maxmem: shipped.maxmem });

    const originalEnv = process.env.NODE_ENV;
    try {
      // A non-test runtime ignores the variable entirely, whatever it holds.
      (process.env as Record<string, string>).NODE_ENV = "production";
      expect(resolveKdfParams()).toEqual(shipped);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = originalEnv as string;
    }
  });

  it("refuses an override that is not a power of two, or is above the shipped cost", () => {
    const shipped = CONNECTION_KDF_PARAMS[CURRENT_KDF_VERSION];
    const original = process.env.ACTUAL_BENCH_TEST_KDF_N;
    try {
      for (const bad of ["100000", "0", "-16384", "notanumber", String(shipped.N * 2)]) {
        process.env.ACTUAL_BENCH_TEST_KDF_N = bad;
        expect(resolveKdfParams()).toEqual(shipped);
      }
    } finally {
      if (original === undefined) delete process.env.ACTUAL_BENCH_TEST_KDF_N;
      else process.env.ACTUAL_BENCH_TEST_KDF_N = original;
    }
  });
});
