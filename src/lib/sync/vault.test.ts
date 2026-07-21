import {
  deriveKeyFromPassphrase,
  openSecret,
  openWithKey,
  sealSecret,
  sealWithKey,
  vaultEnabled,
  VaultDisabledError,
} from "./vault";
import { randomBytes } from "node:crypto";

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

describe("credential vault (RD-058 / PR-024a)", () => {
  const original = process.env.SYNC_VAULT_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = original;
  });

  it("is disabled without SYNC_VAULT_KEY, and sealing/opening throws", () => {
    delete process.env.SYNC_VAULT_KEY;
    expect(vaultEnabled()).toBe(false);
    expect(() => sealSecret("x")).toThrow(VaultDisabledError);
    expect(() => openSecret({ ciphertext: "a", iv: "b", authTag: "c" })).toThrow(VaultDisabledError);
  });

  it("round-trips a secret when enabled", () => {
    process.env.SYNC_VAULT_KEY = "operator-secret-123";
    expect(vaultEnabled()).toBe(true);
    const sealed = sealSecret(JSON.stringify({ apiKey: "k-abc", encryptionPassword: "p" }));
    expect(sealed.ciphertext).not.toContain("k-abc"); // actually encrypted
    expect(JSON.parse(openSecret(sealed))).toEqual({ apiKey: "k-abc", encryptionPassword: "p" });
  });

  it("fails to open under a different key (rotation invalidates ciphertext)", () => {
    process.env.SYNC_VAULT_KEY = "key-one";
    const sealed = sealSecret("secret");
    process.env.SYNC_VAULT_KEY = "key-two";
    expect(() => openSecret(sealed)).toThrow();
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    process.env.SYNC_VAULT_KEY = "key-one";
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
