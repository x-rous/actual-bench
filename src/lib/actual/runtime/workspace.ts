import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAppDbPath } from "@/lib/app-db/connection";
import { generateId } from "@/lib/uuid";

/**
 * Where a worker keeps the budgets it downloads (RD-095 M3).
 *
 * Each worker gets a directory of its own, `w-<threadId>-<id>`, under one root:
 * `ACTUAL_BENCH_RUNTIME_DIR`, or `actual-runtime` next to the app database. It
 * holds this run's downloaded copies and nothing else, and is deleted when the
 * task ends. A copy is never reused: a worker killed mid-write leaves a copy
 * that will not reopen (M0, Appendix B.2), and a fresh download from a
 * refreshed snapshot takes about two seconds.
 *
 * Two things clean up after a worker that could not clean up itself: the
 * supervisor removes a thread's directories when it exits, and the engine
 * sweeps leftovers from a previous process at boot.
 *
 * Server-only.
 */

const WORKSPACE_PREFIX = "w-";

export function runtimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ACTUAL_BENCH_RUNTIME_DIR?.trim();
  return configured || join(dirname(resolveAppDbPath(env)), "actual-runtime");
}

/** Create a fresh, private workspace for this thread. */
export function createWorkspace(threadId: number, root = runtimeRoot()): string {
  // The root may hold another user's budget copies; only this process reads it.
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = join(root, `${WORKSPACE_PREFIX}${threadId}-${generateId()}`);
  mkdirSync(dir, { mode: 0o700 });
  // `mode` is filtered through the umask; say it again, exactly.
  chmodSync(dir, 0o700);
  return dir;
}

export function removeWorkspace(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function workspaces(root: string): string[] {
  try {
    return readdirSync(root).filter((name) => name.startsWith(WORKSPACE_PREFIX));
  } catch {
    return [];
  }
}

/** Remove every workspace a thread left behind. Called when a worker exits. */
export function removeThreadWorkspaces(threadId: number, root = runtimeRoot()): number {
  const prefix = `${WORKSPACE_PREFIX}${threadId}-`;
  let removed = 0;
  for (const name of workspaces(root)) {
    if (!name.startsWith(prefix)) continue;
    removeWorkspace(join(root, name));
    removed += 1;
  }
  return removed;
}

/**
 * Remove workspaces left by workers of a process that died, at boot.
 *
 * Only those untouched for `graceMs`: as with run claims, this does not assume
 * it is the only process using the directory, and a workspace another live
 * process is using right now is not its to delete.
 */
export function sweepStaleWorkspaces(graceMs: number, root = runtimeRoot(), now = Date.now()): number {
  let removed = 0;
  for (const name of workspaces(root)) {
    const dir = join(root, name);
    try {
      if (now - statSync(dir).mtimeMs < graceMs) continue;
    } catch {
      continue;
    }
    removeWorkspace(dir);
    removed += 1;
  }
  return removed;
}
