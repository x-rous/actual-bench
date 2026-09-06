/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createBackupDestination, createBackupPolicy } from "@/lib/app-db/backupRepository";
import { buildBudgetArchive } from "@/lib/backup/testFixtures";
import { ARCHIVE_LIMITS } from "@/lib/backup/verify";
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

  function scheduledPolicy() {
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: volume } },
    });
    return createBackupPolicy(db, {
      name: "Nightly",
      contents: "budget",
      scheduleKind: "cron",
      cronExpression: "0 2 * * *",
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
      destinationIds: [destination.id],
      verificationLevel: "data",
    });
  }

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

  it("refuses to run a scheduled rule from an uploaded copy", async () => {
    // A scheduled rule goes through the automation engine, which holds the
    // single-run lock, records the run and updates health. An upload would skip
    // all three, and hand it a budget from whoever sent the request rather than
    // the enrolled source the rule names.
    const policy = scheduledPolicy();
    const form = new FormData();
    form.append("archive", zipBlob(buildBudgetArchive()), "b.zip");

    const response = await POST(upload(form), context(policy.id));
    expect(response.status).toBe(400);

    // Nothing was written.
    expect(readdirSync(volume)).toHaveLength(0);
  });

  it("rejects an oversized upload on its declared size, before parsing", async () => {
    // `formData()` buffers the whole request, so a size check that only runs
    // afterwards has already cost the memory it was meant to protect.
    const policy = manualPolicy();
    const request = new Request("http://localhost/run", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(1024 * 1024 * 1024),
      },
      body: "--x--",
    });

    const response = await POST(request, context(policy.id));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    // Asserted on the reason, not just the status: this body is also a valid
    // empty multipart, so a "no archive" 400 would pass a status-only check
    // even with the size guard removed.
    expect(body.error).toMatch(/larger than/i);
  });

  it("lets a maximum-size archive through the framing around it", async () => {
    // A multipart body is the archive plus boundaries and part headers. Holding
    // the whole request to the archive limit refused an archive of exactly the
    // maximum size - a budget Actual would open, rejected for its envelope.
    //
    // Driven through the declared length rather than by building half a
    // gigabyte: that is where the refusal happened.
    const policy = manualPolicy();
    const request = new Request("http://localhost/run", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(ARCHIVE_LIMITS.maxArchiveBytes + 1024),
      },
      body: "--x--",
    });

    const response = await POST(request, context(policy.id));
    const body = (await response.json()) as { error: string };

    // It gets past the size gate and fails for the reason it should: this body
    // carries no archive. A size refusal here would be the bug.
    expect(body.error).not.toMatch(/larger than/i);
    expect(body.error).toMatch(/no budget archive/i);
  });

  it("still refuses a request beyond the archive limit and its framing", async () => {
    const policy = manualPolicy();
    const request = new Request("http://localhost/run", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(ARCHIVE_LIMITS.maxArchiveBytes + 1024 * 1024),
      },
      body: "--x--",
    });

    const response = await POST(request, context(policy.id));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/larger than/i);
  });

  it("reports malformed JSON rather than treating it as an empty body", async () => {
    const policy = manualPolicy();
    const request = new Request("http://localhost/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const response = await POST(request, context(policy.id));
    expect(response.status).toBe(400);
  });

  it("answers 404 for a rule that does not exist", async () => {
    const form = new FormData();
    form.append("archive", zipBlob(buildBudgetArchive()), "b.zip");

    const response = await POST(upload(form), context("missing"));
    expect(response.status).toBe(404);
  });
});
