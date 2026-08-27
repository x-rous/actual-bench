import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import { inspectLocalPath, LocalDestinationAdapter } from "./local";
import { DestinationError } from "./types";

function destination(path: string): BackupDestination {
  return {
    id: "dest-1",
    name: "Volume",
    kind: "local",
    enabled: true,
    config: { version: 1, data: { path } },
    credentialRef: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

describe("local destination", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bench-backup-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("round-trips bytes exactly", async () => {
    const adapter = new LocalDestinationAdapter(destination(root));
    const payload = Buffer.from("budget archive bytes");

    const stored = await adapter.put("2026/august.zip", payload);
    expect(stored.sizeBytes).toBe(payload.byteLength);
    expect(await adapter.get("2026/august.zip")).toEqual(payload);
  });

  it("leaves no partial file behind when a write fails", async () => {
    const adapter = new LocalDestinationAdapter(destination(root));
    // A directory where the file should go makes the rename fail.
    await adapter.put("blocked/keep.txt", Buffer.from("x"));

    await expect(adapter.put("blocked", Buffer.from("y"))).rejects.toThrow(DestinationError);

    // The failed write must not leave a `.partial` masquerading as a backup.
    const listed = await adapter.list("");
    expect(listed.map((entry) => entry.key)).toEqual(["blocked/keep.txt"]);
  });

  it("refuses to escape the destination root", async () => {
    const adapter = new LocalDestinationAdapter(destination(join(root, "inner")));
    await expect(adapter.put("../escaped.zip", Buffer.from("x"))).rejects.toThrow(
      /outside the destination/
    );
  });

  it("reports a missing object as missing rather than throwing", async () => {
    const adapter = new LocalDestinationAdapter(destination(root));
    expect(await adapter.head("nope.zip")).toBeNull();
    await expect(adapter.get("nope.zip")).rejects.toThrow(DestinationError);
  });

  it("lists keys relative to the root, recursively", async () => {
    const adapter = new LocalDestinationAdapter(destination(root));
    await adapter.put("a/one.zip", Buffer.from("1"));
    await adapter.put("a/two.zip", Buffer.from("2"));
    await adapter.put("b/three.zip", Buffer.from("3"));

    expect((await adapter.list("a/")).map((entry) => entry.key)).toEqual(["a/one.zip", "a/two.zip"]);
    expect((await adapter.list("")).length).toBe(3);
  });

  it("passes a real write-read-delete test and cleans up after itself", async () => {
    const adapter = new LocalDestinationAdapter(destination(root));
    const result = await adapter.test();

    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.name === "Round trip")?.status).toBe("pass");
    expect(await adapter.list("")).toEqual([]);
  });
});

describe("inspecting a candidate path", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bench-backup-inspect-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a relative path, which would depend on where the server started", async () => {
    const { checks } = await inspectLocalPath("backups");
    expect(checks[0].status).toBe("fail");
    expect(checks[0].detail).toMatch(/absolute/i);
  });

  it("rejects a path that is a file", async () => {
    const file = join(root, "not-a-dir");
    writeFileSync(file, "x");
    const { checks } = await inspectLocalPath(file);
    expect(checks.some((check) => check.status === "fail")).toBe(true);
  });

  it("refuses the directory holding Bench's own database", async () => {
    const previous = process.env.ACTUAL_BENCH_DB_PATH;
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "actual-bench.sqlite");
    try {
      const { checks } = await inspectLocalPath(root);
      expect(checks[0].status).toBe("fail");
      expect(checks[0].detail).toMatch(/Bench's own database/);
    } finally {
      if (previous === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
      else process.env.ACTUAL_BENCH_DB_PATH = previous;
    }
  });

  it("creates a missing directory rather than making the user do it by hand", async () => {
    const target = join(root, "nested", "backups");
    const { checks } = await inspectLocalPath(target);
    expect(checks[0].status).toBe("pass");
    expect(checks[0].detail).toMatch(/Created/);
  });

  it("warns rather than refuses when the path shares a device with Bench's data", async () => {
    const previous = process.env.ACTUAL_BENCH_DB_PATH;
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "actual-bench.sqlite");
    try {
      // A `/data/backups`-shaped setup: legitimate, but not off-site.
      const { checks } = await inspectLocalPath(join(root, "backups"));
      expect(checks.some((check) => check.status === "fail")).toBe(false);
      expect(checks.find((check) => check.name === "Separation")?.status).toBe("warn");
    } finally {
      if (previous === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
      else process.env.ACTUAL_BENCH_DB_PATH = previous;
    }
  });
});
