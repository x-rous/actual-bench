/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  recordArtifactLocation,
} from "@/lib/app-db/backupRepository";
import { buildBudgetArchive } from "@/lib/backup/testFixtures";
import { sha256 } from "@/lib/backup/manifest";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { POST } from "./route";

/**
 * "Look inside" through its route (RD-077 / PR-047e).
 *
 * Route-level rather than library-level because the failure this covers was at
 * the boundary: the handler has to find the artifact, resolve the destination
 * holding it, and answer with something the browser can act on. A library test
 * would have passed throughout.
 */
describe("POST /api/backups/artifacts/[artifactId]/inspect", () => {
  let root: string;
  let volume: string;
  let db: SqliteDatabase;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-inspect-route-"));
    volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    db = getAppDb();
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
  });

  function storedArtifact() {
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: volume } },
    });
    const policy = createBackupPolicy(db, { name: "Nightly", destinationIds: [destination.id] });
    const bytes = buildBudgetArchive({ transactions: 3 });
    const artifact = createBackupArtifact(db, {
      policyId: policy.id,
      kind: "budget",
      sourceBudgetName: "Household",
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256(bytes),
    });

    const key = `budget/household/${artifact.id.slice(0, 8)}.zip`;
    mkdirSync(dirname(join(volume, key)), { recursive: true });
    writeFileSync(join(volume, key), bytes);
    recordArtifactLocation(db, {
      artifactId: artifact.id,
      destinationId: destination.id,
      objectKey: key,
      status: "stored",
    });
    return artifact;
  }

  function request(body: unknown = {}) {
    return new Request("http://localhost/api/backups/artifacts/x/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("opens the copy and reports what is inside it", async () => {
    const artifact = storedArtifact();

    const response = await POST(request(), {
      params: Promise.resolve({ artifactId: artifact.id }),
    });
    const body = (await response.json()) as { result: { opened: boolean; message: string } };

    expect(response.status).toBe(200);
    expect(body.result.opened).toBe(true);
    expect(body.result.message).toMatch(/3 transactions/);
  });

  it("answers with a readable reason, not a bare status, when the artifact is unknown", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ artifactId: "does-not-exist" }),
    });
    const body = (await response.json()) as { error?: string };

    expect(body.error).toMatch(/not in the inventory/);
  });

  it("says the copy is gone rather than blaming the request", async () => {
    const artifact = storedArtifact();
    rmSync(join(volume, `budget/household/${artifact.id.slice(0, 8)}.zip`));

    const response = await POST(request(), {
      params: Promise.resolve({ artifactId: artifact.id }),
    });
    const body = (await response.json()) as { error?: string; result?: unknown };

    expect(body.error ?? "").toMatch(/Could not read|no stored copy/i);
  });
});
