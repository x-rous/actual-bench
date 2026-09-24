import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, removeThreadWorkspaces, runtimeRoot, sweepStaleWorkspaces } from "./workspace";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "actual-bench-workspace-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("budget workspaces", () => {
  it("lives next to the app database unless ACTUAL_BENCH_RUNTIME_DIR says otherwise", () => {
    expect(runtimeRoot({ ACTUAL_BENCH_DB_PATH: "/srv/bench/db.sqlite" } as unknown as NodeJS.ProcessEnv)).toBe(
      "/srv/bench/actual-runtime"
    );
    expect(
      runtimeRoot({ ACTUAL_BENCH_DB_PATH: "/srv/bench/db.sqlite", ACTUAL_BENCH_RUNTIME_DIR: "/scratch" } as unknown as NodeJS.ProcessEnv)
    ).toBe("/scratch");
  });

  it("gives each worker a private directory of its own", () => {
    const a = createWorkspace(7, root);
    const b = createWorkspace(7, root);
    expect(a).not.toBe(b);
    expect(statSync(a).mode & 0o777).toBe(0o700);
  });

  it("removes every directory of a thread that stopped, and only that thread's", () => {
    createWorkspace(7, root);
    createWorkspace(7, root);
    const other = createWorkspace(71, root);

    expect(removeThreadWorkspaces(7, root)).toBe(2);
    expect(readdirSync(root)).toHaveLength(1);
    expect(existsSync(other)).toBe(true);
  });

  it("sweeps leftovers at boot, but not a workspace in use within the grace", () => {
    const old = createWorkspace(1, root);
    const recent = createWorkspace(2, root);
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(old, hourAgo, hourAgo);

    expect(sweepStaleWorkspaces(15 * 60_000, root)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });

  it("treats a missing root as nothing to clean", () => {
    expect(sweepStaleWorkspaces(0, join(root, "missing"))).toBe(0);
    expect(removeThreadWorkspaces(1, join(root, "missing"))).toBe(0);
  });
});
