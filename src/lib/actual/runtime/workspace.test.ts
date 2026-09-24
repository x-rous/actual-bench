import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  createWorkspace,
  removeThreadWorkspaces,
  runtimeRoot,
  sweepStaleWorkspaces,
  touchWorkspace,
  workspaceOwner,
} from "./workspace";

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
    // Thread 7 of another server process sharing the same root.
    const otherProcess = join(root, "w-someoneelse-7-abc");
    mkdirSync(otherProcess);

    expect(removeThreadWorkspaces(7, root)).toBe(2);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(otherProcess)).toBe(true);
  });

  it("names every workspace with this process's owner token", () => {
    expect(basename(createWorkspace(3, root))).toMatch(new RegExp(`^w-${workspaceOwner()}-3-`));
  });

  it("never sweeps a workspace that is touched while in use, however long the run", () => {
    const busy = createWorkspace(1, root);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    utimesSync(busy, twoHoursAgo, twoHoursAgo);
    touchWorkspace(busy); // The heartbeat.

    expect(sweepStaleWorkspaces(15 * 60_000, root)).toBe(0);
    expect(existsSync(busy)).toBe(true);
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
