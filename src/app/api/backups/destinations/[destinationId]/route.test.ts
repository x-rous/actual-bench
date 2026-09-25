/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createBackupDestination } from "@/lib/app-db/backupRepository";
import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import { secretRefs } from "@/lib/credentials/store";
import { getSyncCredential, upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { PATCH } from "./route";

/**
 * A destination's S3 keys are stored under the destination's id, which comes
 * from the URL. Since backup secrets and unattended server keys share one ref
 * space, nothing may be stored before the destination is known to exist.
 */
describe("PATCH /api/backups/destinations/[destinationId]", () => {
  let root: string;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  const previousVaultKey = process.env.ACTUAL_BENCH_VAULT_KEY;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-destination-patch-"));
    mkdirSync(join(root, "volume"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-operator-key";
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
    if (previousVaultKey === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = previousVaultKey;
  });

  const patch = (destinationId: string, body: unknown) =>
    PATCH(
      new Request("http://bench.test", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ destinationId }) }
    );
  const s3Keys = { credentials: { accessKeyId: "AKIA", secretAccessKey: "s3-secret" } };

  it("stores nothing for a destination that does not exist", async () => {
    const response = await patch("missing", s3Keys);

    expect(response.status).toBe(404);
    expect(getBackupCredential(getAppDb(), "missing")).toBeNull();
    expect(getAppDb().prepare("SELECT COUNT(*) AS n FROM credentials").get<{ n: number }>()?.n).toBe(0);
  });

  it("cannot overwrite a server's unattended key by naming its ref as the destination id", async () => {
    const db = getAppDb();
    upsertSyncCredential(db, {
      connectionFingerprint: "conn-1",
      mode: "http-api",
      baseUrl: "https://api.example.com",
      budgetSyncId: "budget-1",
      secret: { apiKey: "unattended-key" },
    });
    const serverRef = secretRefs.server(serverFingerprint({ mode: "http-api", baseUrl: "https://api.example.com" }));

    const response = await patch(serverRef, s3Keys);

    expect(response.status).toBe(404);
    expect(getSyncCredential(db, "conn-1")?.secret.apiKey).toBe("unattended-key");
  });

  it("stores new keys for a destination that exists", async () => {
    const destination = createBackupDestination(getAppDb(), {
      name: "Bucket",
      kind: "s3",
      config: { version: 1, data: { endpoint: "https://s3.example.com", bucket: "b", region: "us-east-1" } },
    });

    const response = await patch(destination.id, s3Keys);

    expect(response.status).toBe(200);
    expect(getBackupCredential(getAppDb(), destination.id)).toEqual({ accessKeyId: "AKIA", secretAccessKey: "s3-secret" });
  });
});
