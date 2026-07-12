import { sealSecret, openSecret, vaultEnabled, VaultDisabledError } from "./vault";

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
