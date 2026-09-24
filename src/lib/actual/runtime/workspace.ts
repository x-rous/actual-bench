import { chmodSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAppDbPath } from "@/lib/app-db/connection";
import { generateId } from "@/lib/uuid";

/**
 * Where a worker keeps the budgets it downloads (RD-095 M3).
 *
 * Each worker gets a directory of its own, `w-<owner>-<threadId>-<id>`, under one root:
 * `ACTUAL_BENCH_RUNTIME_DIR`, or `actual-runtime` next to the app database. It
 * holds this run's downloaded copies and nothing else, and is deleted when the
 * task ends. A copy is never reused: a worker killed mid-write leaves a copy
 * that will not reopen (M0, Appendix B.2), and a fresh download from a
 * refreshed snapshot takes about two seconds.
 *
 * Two things clean up after a worker that could not clean up itself: the
 * supervisor removes a thread's directories when it exits, and the engine
 * sweeps directories nobody has touched for a while. Neither assumes it is
 * the only process using the root:
 *
 *   * `<owner>` is a token per server process, so removing thread 7's
 *     directories never touches thread 7 of another process;
 *   * a directory in use is touched every minute (`touchWorkspace`), so a long
 *     run - a backup may take an hour - never looks abandoned.
 *
 * Server-only.
 */

const WORKSPACE_PREFIX = "w-";
/** How often a workspace in use is touched; a sweep leaves anything touched within its grace. */
export const WORKSPACE_HEARTBEAT_MS = 60_000;
/** Untouched this long, a workspace belongs to a worker that is gone. */
export const WORKSPACE_STALE_MS = 15 * 60_000;

// Worker threads start with a copy of the parent's environment, so a token set
// here, in the server process, before any worker starts is the same in all of
// its workers - and a worker that loads this module reads it, not a new one.
const OWNER_ENV = "ACTUAL_BENCH_WORKSPACE_OWNER";

export function workspaceOwner(): string {
  process.env[OWNER_ENV] ??= generateId().replace(/-/g, "").slice(0, 12);
  return process.env[OWNER_ENV];
}

// Set at load, so the supervisor has it before it starts a worker.
workspaceOwner();

export function runtimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ACTUAL_BENCH_RUNTIME_DIR?.trim();
  return configured || join(dirname(resolveAppDbPath(env)), "actual-runtime");
}

/** Create a fresh, private workspace for this thread. */
export function createWorkspace(threadId: number, root = runtimeRoot()): string {
  // The root may hold another user's budget copies; only this process reads it.
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = join(root, `${WORKSPACE_PREFIX}${workspaceOwner()}-${threadId}-${generateId()}`);
  mkdirSync(dir, { mode: 0o700 });
  // `mode` is filtered through the umask; say it again, exactly.
  chmodSync(dir, 0o700);
  return dir;
}

/** Mark a workspace as in use, so a sweep leaves it alone. */
export function touchWorkspace(dir: string): void {
  const now = new Date();
  utimesSync(dir, now, now);
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

/** Remove every workspace a thread of this process left behind. Called when a worker exits. */
export function removeThreadWorkspaces(threadId: number, root = runtimeRoot()): number {
  const prefix = `${WORKSPACE_PREFIX}${workspaceOwner()}-${threadId}-`;
  let removed = 0;
  for (const name of workspaces(root)) {
    if (!name.startsWith(prefix)) continue;
    removeWorkspace(join(root, name));
    removed += 1;
  }
  return removed;
}

/**
 * Remove workspaces left by workers that are gone - of this process or one
 * that died. Only those untouched for `graceMs`: a workspace in use is touched
 * every minute, whichever process owns it.
 */
export function sweepStaleWorkspaces(graceMs = WORKSPACE_STALE_MS, root = runtimeRoot(), now = Date.now()): number {
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
