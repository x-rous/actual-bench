import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __configureNodeHostForTests, __resetNodeHostForTests } from "./runtime/nodeHost";
import { sealEnrolmentSecret, verifyConnection, type VerifyConnectionInput } from "./verifyConnection";

/**
 * The enrolment check against a real Actual server (RD-095 M4). Skipped
 * unless pointed at one:
 *
 *   ACTUAL_TEST_SERVER_URL, ACTUAL_TEST_SERVER_PASSWORD, ACTUAL_TEST_SERVER_BUDGET
 *   ACTUAL_TEST_SERVER_ENCRYPTED_BUDGET and _ENCRYPTION_PASSWORD (optional)
 *
 * Read-only: it opens budgets and never uploads a snapshot.
 */

const url = process.env.ACTUAL_TEST_SERVER_URL;
const password = process.env.ACTUAL_TEST_SERVER_PASSWORD;
const budget = process.env.ACTUAL_TEST_SERVER_BUDGET;
const encryptedBudget = process.env.ACTUAL_TEST_SERVER_ENCRYPTED_BUDGET;
const encryptionPassword = process.env.ACTUAL_TEST_SERVER_ENCRYPTION_PASSWORD;

const live = url && password && budget ? describe : describe.skip;

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

live("checking a Direct enrolment against a real server", () => {
  jest.setTimeout(180_000);
  let root: string;
  const savedKey = process.env.ACTUAL_BENCH_VAULT_KEY;

  function input(syncId: string, secret: Record<string, string>): VerifyConnectionInput {
    return {
      connectionFingerprint: `live-${syncId}`,
      mode: "browser-api",
      baseUrl: url!,
      budgetSyncId: syncId,
      label: "Live check",
      sealed: sealEnrolmentSecret(secret),
    };
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-verify-live-"));
    process.env.ACTUAL_BENCH_RUNTIME_DIR = root;
    process.env.ACTUAL_BENCH_VAULT_KEY = "live-test-operator-key";
    __configureNodeHostForTests({
      allowMainThread: true,
      // "Uploaded just now": this test never refreshes a snapshot.
      snapshots: { lastSnapshotAt: () => new Date().toISOString(), recordSnapshot: () => {} },
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    __resetNodeHostForTests();
    jest.restoreAllMocks();
    delete process.env.ACTUAL_BENCH_RUNTIME_DIR;
    if (savedKey === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = savedKey;
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a wrong server password", async () => {
    await expect(verifyConnection(input(budget!, { serverPassword: "not-the-password" }))).resolves.toMatchObject({
      ok: false,
      code: "AUTH_FAILED",
    });
  });

  it("refuses a budget the server does not have", async () => {
    await expect(
      verifyConnection(input("00000000-0000-4000-8000-000000000000", { serverPassword: password! }))
    ).resolves.toMatchObject({ ok: false, code: "BUDGET_NOT_FOUND" });
  });

  it("accepts the right password", async () => {
    await expect(verifyConnection(input(budget!, { serverPassword: password! }))).resolves.toEqual({ ok: true });
  });

  (encryptedBudget && encryptionPassword ? describe : describe.skip)("an end-to-end encrypted budget", () => {
    it("asks for the encryption password when none is given", async () => {
      await expect(verifyConnection(input(encryptedBudget!, { serverPassword: password! }))).resolves.toMatchObject({
        ok: false,
        code: "ENCRYPTION_KEY_REQUIRED",
      });
    });

    it("refuses a wrong encryption password", async () => {
      await expect(
        verifyConnection(input(encryptedBudget!, { serverPassword: password!, encryptionPassword: "wrong-e2ee" }))
      ).resolves.toMatchObject({ ok: false, code: "ENCRYPTION_KEY_WRONG" });
    });

    it("accepts the right one", async () => {
      await expect(
        verifyConnection(input(encryptedBudget!, { serverPassword: password!, encryptionPassword: encryptionPassword! }))
      ).resolves.toEqual({ ok: true });
    });
  });
});
