/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import type { SqliteDatabase } from "@/lib/app-db/types";
import * as store from "./store";
import {
  deleteAllSecrets,
  deleteSecretsWithPrefix,
  getSecret,
  hasSecret,
  listSecretMeta,
  putSecret,
  resealPassphraseDomain,
  secretRefs,
} from "./store";

/**
 * The credential store keeps two key domains apart (F-195). Remembered
 * credentials are sealed with the user's passphrase so that a server with no
 * login cannot open them on its own (RD-061); unattended and backup secrets are
 * sealed with the operator key so that it can. Nothing here may blur that line.
 */
describe("credential store", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousVaultKey = process.env.SYNC_VAULT_KEY;
  const userKey = randomBytes(32);

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-operator-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-credential-store-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousVaultKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousVaultKey;
  });

  const passphrase = (key: Buffer = userKey) => ({ domain: "passphrase" as const, key });
  const operator = { domain: "operator" as const };

  it("keeps the same ref in the two domains as two separate secrets", () => {
    const ref = secretRefs.server("srv-1");
    putSecret(db, passphrase(), { ref, kind: "server-login", plaintext: "remembered" });
    putSecret(db, operator, { ref, kind: "server-login", plaintext: "unattended" });

    expect(getSecret(db, passphrase(), ref)?.plaintext).toBe("remembered");
    expect(getSecret(db, operator, ref)?.plaintext).toBe("unattended");
  });

  it("cannot read a remembered secret through the operator path", () => {
    const ref = secretRefs.server("srv-1");
    putSecret(db, passphrase(), { ref, kind: "server-login", plaintext: "remembered" });

    // Not there at all in the operator domain - not merely undecryptable.
    expect(getSecret(db, operator, ref)).toBeNull();
    expect(hasSecret(db, "operator", ref)).toBe(false);
  });

  it("fails closed on a wrong key, leaving the ciphertext exactly as it was", () => {
    const ref = secretRefs.server("srv-1");
    putSecret(db, passphrase(), { ref, kind: "server-login", plaintext: "remembered" });
    const before = db.prepare("SELECT ciphertext, iv, auth_tag FROM credentials WHERE ref = ?").get(ref);

    expect(() => getSecret(db, passphrase(randomBytes(32)), ref)).toThrow();
    expect(db.prepare("SELECT ciphertext, iv, auth_tag FROM credentials WHERE ref = ?").get(ref)).toEqual(before);
  });

  it("refuses the operator domain when the vault key is not set", () => {
    delete process.env.SYNC_VAULT_KEY;
    expect(() =>
      putSecret(db, operator, { ref: "dest-1", kind: "s3", plaintext: "{}" })
    ).toThrow(/SYNC_VAULT_KEY/);
  });

  it("clears one domain without touching the other", () => {
    putSecret(db, passphrase(), { ref: secretRefs.server("srv-1"), kind: "server-login", plaintext: "a" });
    putSecret(db, operator, { ref: secretRefs.server("srv-1"), kind: "server-login", plaintext: "b" });
    putSecret(db, operator, { ref: "dest-1", kind: "s3", plaintext: "{}" });

    deleteAllSecrets(db, "passphrase");

    expect(hasSecret(db, "passphrase", secretRefs.server("srv-1"))).toBe(false);
    expect(getSecret(db, operator, secretRefs.server("srv-1"))?.plaintext).toBe("b");
    expect(hasSecret(db, "operator", "dest-1")).toBe(true);
  });

  it("deletes by prefix literally, so a ref cannot widen the match", () => {
    putSecret(db, operator, { ref: secretRefs.budget("srv_1", "b1"), kind: "budget-encryption-password", plaintext: "x" });
    putSecret(db, operator, { ref: secretRefs.budget("srvA1", "b1"), kind: "budget-encryption-password", plaintext: "y" });

    // `_` is a LIKE wildcard; unescaped it would also match "srvA1".
    deleteSecretsWithPrefix(db, "operator", secretRefs.budgetsOfServer("srv_1"));

    expect(hasSecret(db, "operator", secretRefs.budget("srv_1", "b1"))).toBe(false);
    expect(hasSecret(db, "operator", secretRefs.budget("srvA1", "b1"))).toBe(true);
  });

  it("re-seals the passphrase domain under a new key and leaves the operator domain alone", () => {
    const newKey = randomBytes(32);
    putSecret(db, passphrase(), { ref: secretRefs.server("srv-1"), kind: "server-login", plaintext: "remembered" });
    putSecret(db, operator, { ref: "dest-1", kind: "s3", plaintext: "operator-secret" });

    expect(resealPassphraseDomain(db, userKey, newKey)).toBe(1);

    expect(getSecret(db, passphrase(newKey), secretRefs.server("srv-1"))?.plaintext).toBe("remembered");
    expect(() => getSecret(db, passphrase(userKey), secretRefs.server("srv-1"))).toThrow();
    expect(getSecret(db, operator, "dest-1")?.plaintext).toBe("operator-secret");
  });

  it("rolls a re-seal back completely when one secret will not open", () => {
    putSecret(db, passphrase(), { ref: secretRefs.server("srv-1"), kind: "server-login", plaintext: "one" });
    putSecret(db, passphrase(randomBytes(32)), { ref: secretRefs.server("srv-2"), kind: "server-login", plaintext: "two" });
    const before = db.prepare("SELECT * FROM credentials ORDER BY ref").all();

    expect(() => resealPassphraseDomain(db, userKey, randomBytes(32))).toThrow();
    expect(db.prepare("SELECT * FROM credentials ORDER BY ref").all()).toEqual(before);
  });

  it("lists only the kinds asked for", () => {
    putSecret(db, operator, { ref: "dest-1", kind: "s3", plaintext: "{}" });
    putSecret(db, operator, { ref: secretRefs.server("srv-1"), kind: "server-login", plaintext: "{}" });

    expect(listSecretMeta(db, "operator", ["s3"]).map((meta) => meta.ref)).toEqual(["dest-1"]);
  });

  it("offers no way to move a secret from one domain to the other", () => {
    // Every export is listed here on purpose. A new one that reads in one
    // domain and writes in the other would have to be added to this list,
    // which is the moment to stop and ask whether it should exist at all.
    expect(Object.keys(store).sort()).toEqual(
      [
        "CURRENT_KEY_ID",
        "deleteAllSecrets",
        "deleteSecret",
        "deleteSecretsWithPrefix",
        "getSecret",
        "getSecretMeta",
        "hasSecret",
        "listSecretMeta",
        "putSecret",
        "resealPassphraseDomain",
        "secretRefs",
      ].sort()
    );
  });
});
