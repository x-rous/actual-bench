/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { __configureWorkerSupervisorForTests, ensureWorkerPreflight } from "@/lib/workers/supervisor";
import { GET } from "./route";

/**
 * Workers that cannot start stop every automation. The overall status App
 * Health shows as a badge must say so, not read healthy beside it.
 */
describe("GET /api/automations/health", () => {
  let root: string;
  const saved = { dbPath: process.env.ACTUAL_BENCH_DB_PATH, executor: process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-automation-health-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });
  afterEach(() => {
    __configureWorkerSupervisorForTests();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of [
      ["ACTUAL_BENCH_DB_PATH", saved.dbPath],
      ["ACTUAL_BENCH_AUTOMATION_EXECUTOR", saved.executor],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reports failing overall when worker threads cannot start", async () => {
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "worker";
    __configureWorkerSupervisorForTests({
      spawn: () => {
        throw new Error("worker_threads is not supported here");
      },
    });
    await ensureWorkerPreflight();

    const body = (await (await GET()).json()) as { overall: string; workers: { preflight: { status: string } } };

    expect(body.workers.preflight.status).toBe("failed");
    expect(body.overall).toBe("failing");
  });

  it("does not hold a failed check against in-thread execution, which does not use workers", async () => {
    process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = "in-thread";
    __configureWorkerSupervisorForTests({
      spawn: () => {
        throw new Error("worker_threads is not supported here");
      },
    });
    await ensureWorkerPreflight();

    const body = (await (await GET()).json()) as { overall: string; workers: { executor: string } };

    expect(body.workers.executor).toBe("in-thread");
    expect(body.overall).not.toBe("failing");
  });
});
