import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { setPassphrase, verifyPassphrase } from "@/lib/connectionVault/passphrase";
import { listServerCredentialMeta, upsertServerCredential } from "@/lib/credentials/rememberedCredentials";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { applyEnvPassword } from "./envPassword";

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

// scrypt at the OWASP floor is intentionally slow; give derive-heavy tests room.
jest.setTimeout(30000);

describe("applyEnvPassword (RD-096)", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-env-password-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("does nothing when the variable is unset", () => {
    expect(applyEnvPassword(db, env({}))).toBe("unset");
  });

  it("sets the password on a fresh install", () => {
    expect(applyEnvPassword(db, env({ ACTUAL_BENCH_PASSWORD: "from-the-env" }))).toBe("set");
    expect(verifyPassphrase(db, "from-the-env")).not.toBeNull();
  });

  it("leaves a matching password and its saved connections alone", () => {
    setPassphrase(db, "same-password");
    const key = verifyPassphrase(db, "same-password")!;
    upsertServerCredential(db, { mode: "http-api", baseUrl: "https://api.example.com", secret: { apiKey: "k" } }, key);

    expect(applyEnvPassword(db, env({ ACTUAL_BENCH_PASSWORD: "same-password" }))).toBe("unchanged");
    expect(listServerCredentialMeta(db)).toHaveLength(1);
  });

  it("recovers a forgotten password, clearing what the old one sealed", () => {
    setPassphrase(db, "forgotten-password");
    const key = verifyPassphrase(db, "forgotten-password")!;
    upsertServerCredential(db, { mode: "http-api", baseUrl: "https://api.example.com", secret: { apiKey: "k" } }, key);

    expect(applyEnvPassword(db, env({ ACTUAL_BENCH_PASSWORD: "new-password" }))).toBe("replaced");
    expect(verifyPassphrase(db, "new-password")).not.toBeNull();
    expect(verifyPassphrase(db, "forgotten-password")).toBeNull();
    expect(listServerCredentialMeta(db)).toHaveLength(0);
  });
});
