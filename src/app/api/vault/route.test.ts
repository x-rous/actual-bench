/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { putSecret } from "@/lib/credentials/store";
import { POST as reset } from "./reset/route";
import { GET } from "./route";

describe("/api/vault", () => {
  const saved = { key: process.env.ACTUAL_BENCH_VAULT_KEY, db: process.env.ACTUAL_BENCH_DB_PATH };
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-vault-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_VAULT_KEY = "operator-key";
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    for (const [name, value] of Object.entries({ ACTUAL_BENCH_VAULT_KEY: saved.key, ACTUAL_BENCH_DB_PATH: saved.db })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function lockVault(): void {
    putSecret(getAppDb(), { domain: "operator" }, { ref: "server:srv-1", kind: "server-login", plaintext: "api-key" });
    process.env.ACTUAL_BENCH_VAULT_KEY = "a-different-key";
  }

  it("reports a ready vault and where its key comes from, never the key", async () => {
    const response = GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({ status: "ready", source: "environment", storedSecrets: 0 });
    expect(JSON.stringify(body)).not.toContain("operator-key");
  });

  it("reports a locked vault with its reason and message", async () => {
    lockVault();

    const body = (await GET().json()) as Record<string, unknown>;

    expect(body).toMatchObject({ status: "locked", reason: "wrong-key", storedSecrets: 1 });
    expect(body.message).toMatch(/doesn't open/);
    expect(JSON.stringify(body)).not.toContain("a-different-key");
  });

  it("refuses to reset a working vault", async () => {
    putSecret(getAppDb(), { domain: "operator" }, { ref: "server:srv-1", kind: "server-login", plaintext: "api-key" });

    const response = reset();

    expect(response.status).toBe(409);
    expect((await GET().json()) as Record<string, unknown>).toMatchObject({ status: "ready", storedSecrets: 1 });
  });

  it("resets a locked vault and answers with the new state", async () => {
    lockVault();

    const response = reset();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vault: { status: "ready" } });
    expect((await GET().json()) as Record<string, unknown>).toMatchObject({ status: "ready", storedSecrets: 0 });
  });
});
