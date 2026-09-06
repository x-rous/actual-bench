/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createBackupDestination, createBackupPolicy } from "@/lib/app-db/backupRepository";
import { buildBudgetArchive } from "@/lib/backup/testFixtures";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { POST } from "./route";

/**
 * "Back up now" for a budget the server cannot reach (RD-092).
 *
 * Route-level because the whole point is the boundary: a direct connection's
 * budget lives in the operator's browser, so the archive arrives *with* the
 * request rather than being fetched by this process. A library test would never
 * see the multipart form, the size guard, or the choice between the uploaded
 * path and the automation one.
 */
describe("POST /api/backups/policies/[policyId]/run", () => {
  let root: string;
  let volume: string;
  let db: SqliteDatabase;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-run-route-"));
    volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    // The route resolves its own database, so the path has to be set where the
    // route will find it rather than handed to `getAppDb` here.
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    db = getAppDb();
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
  });

  function manualPolicy() {
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: volume } },
    });
    return createBackupPolicy(db, {
      name: "On request",
      contents: "budget",
      scheduleKind: "manual",
      sourceRef: { version: 1, data: { connectionFingerprint: "direct-1", sourceKind: "direct" } },
      destinationIds: [destination.id],
      verificationLevel: "data",
    });
  }

  function context(policyId: string) {
    return { params: Promise.resolve({ policyId }) };
  }

  /** A Blob from the fixture's bytes, with a buffer the DOM types accept. */
  function zipBlob(bytes: Uint8Array): Blob {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer], { type: "application/zip" });
  }

  function upload(form: FormData): Request {
    return new Request("http://localhost/run", { method: "POST", body: form });
  }

  it("stores an archive the browser exported", async () => {
    const policy = manualPolicy();
    const form = new FormData();
    form.append("archive", zipBlob(buildBudgetArchive()), "b.zip");
    form.append("budgetId", "budget-1");
    form.append("budgetName", "Household");

    const response = await POST(upload(form), context(policy.id));
    const body = (await response.json()) as { result: { stored: boolean; verified: boolean } };

    expect(response.status).toBe(200);
    expect(body.result.stored).toBe(true);
    expect(body.result.verified).toBe(true);

    // The copy really landed, rather than the run merely claiming it did.
    // The copy really landed, rather than the run merely claiming it did - and
    // under the budget name the upload carried, which is the metadata the server
    // could not have known on its own.
    const stored = readdirSync(volume, { recursive: true }).map(String);
    expect(stored.some((name) => name.endsWith(".zip"))).toBe(true);
    expect(stored.some((name) => name.includes("household"))).toBe(true);
  });

  it("refuses an upload carrying no archive", async () => {
    const policy = manualPolicy();
    const form = new FormData();
    form.append("budgetName", "Household");

    const response = await POST(upload(form), context(policy.id));
    expect(response.status).toBe(400);
  });

  it("refuses an empty archive rather than storing nothing", async () => {
    const policy = manualPolicy();
    const form = new FormData();
    form.append("archive", zipBlob(new Uint8Array()), "b.zip");

    const response = await POST(upload(form), context(policy.id));
    expect(response.status).toBe(400);
  });

  it("answers 404 for a rule that does not exist", async () => {
    const form = new FormData();
    form.append("archive", zipBlob(buildBudgetArchive()), "b.zip");

    const response = await POST(upload(form), context("missing"));
    expect(response.status).toBe(404);
  });
});
