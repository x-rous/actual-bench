import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveAppDbPath } from "@/lib/app-db/connection";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import {
  DestinationError,
  type DestinationAdapter,
  type DestinationCheck,
  type DestinationFacts,
  type DestinationTestResult,
  type StoredObject,
} from "./types";

/**
 * A local path destination (RD-077 / PR-047b).
 *
 * This is the destination most self-hosters will actually use: a directory
 * inside a mounted volume. It is the simplest adapter and the one with the most
 * ways to be quietly wrong, so most of the code here is about refusing to be
 * quietly wrong — a backup written into a container's ephemeral layer, or into
 * the same directory as the database it is meant to protect, is worse than no
 * backup, because it looks like one.
 *
 * The rules are graded on purpose:
 *
 *   * **Refuse** what cannot work or would corrupt something: a relative path,
 *     a path that is a file, a path Bench cannot write to, and the directory
 *     holding Bench's own database.
 *   * **Warn** about what is legal but weak: a backup sitting on the same
 *     device as Bench's data, or a volume with very little room left. A warning
 *     teaches; a refusal here would block the legitimate `/data/backups` mount
 *     that most people want.
 */

export type LocalDestinationConfig = {
  path: string;
};

/**
 * The file that says "this folder is that destination".
 *
 * A bind mount that has gone away leaves an empty directory at the same path,
 * and an empty directory is writable: backups landed in the container's own
 * layer and looked fine, while the weekly check marked every real copy
 * missing. The marker turns that into a refusal that names the likely cause.
 */
export const DESTINATION_MARKER = ".bench-destination.json";

/** Leftover temp files older than this are swept; a live write never takes a day. */
const PARTIAL_MAX_AGE_MS = 24 * 3_600_000;

/** Refuse traversal: a key must stay inside the destination root. */
function resolveKey(root: string, key: string): string {
  const target = resolve(root, key);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new DestinationError(`Refusing to use a path outside the destination: ${key}`);
  }
  return target;
}

export function readLocalConfig(destination: BackupDestination): LocalDestinationConfig {
  const path = destination.config.data.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new DestinationError("This destination has no path configured.");
  }
  return { path: resolve(path.trim()) };
}

/**
 * Static validation of a candidate path, usable before a destination exists —
 * the "add destination" form calls this so the user learns about a bad path
 * while they are still typing it rather than at 3am when the backup runs.
 */
export async function inspectLocalPath(rawPath: string): Promise<{
  checks: DestinationCheck[];
  facts: DestinationFacts;
}> {
  const checks: DestinationCheck[] = [];
  const trimmed = rawPath.trim();
  const facts: DestinationFacts = { location: trimmed };

  if (!trimmed) {
    checks.push({ name: "Path", status: "fail", detail: "A path is required." });
    return { checks, facts };
  }
  if (!isAbsolute(trimmed)) {
    checks.push({
      name: "Path",
      status: "fail",
      detail: "Use an absolute path. A relative one depends on where the server happened to start.",
    });
    return { checks, facts };
  }

  const path = resolve(trimmed);
  facts.location = path;

  const appDbPath = resolveAppDbPath();
  const appDbDir = dirname(appDbPath);
  if (path === appDbDir) {
    checks.push({
      name: "Path",
      status: "fail",
      detail:
        "This is the directory holding Bench's own database. Backups must not share it - use a subdirectory such as " +
        `${join(appDbDir, "backups")}.`,
    });
    return { checks, facts };
  }

  // Create it if missing: asking someone to mkdir by hand inside a container is
  // a good way to end up with a destination that is never actually configured.
  let created = false;
  try {
    const info = await stat(path).catch(() => null);
    if (info && !info.isDirectory()) {
      checks.push({ name: "Path", status: "fail", detail: "That path exists and is a file, not a directory." });
      return { checks, facts };
    }
    if (!info) {
      await mkdir(path, { recursive: true });
      created = true;
    }
    checks.push({
      name: "Path",
      status: "pass",
      detail: created ? `Created ${path}.` : `${path} exists.`,
    });
  } catch (error) {
    checks.push({
      name: "Path",
      status: "fail",
      detail: `Cannot create ${path}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { checks, facts };
  }

  try {
    await access(path, constants.W_OK);
    checks.push({ name: "Writable", status: "pass", detail: "Bench can write here." });
  } catch {
    checks.push({
      name: "Writable",
      status: "fail",
      detail: "Bench cannot write here. Check the volume's ownership and permissions.",
    });
    return { checks, facts };
  }

  try {
    const fsStat = await statfs(path);
    const freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
    const totalBytes = Number(fsStat.blocks) * Number(fsStat.bsize);
    facts.freeBytes = freeBytes;
    facts.totalBytes = totalBytes;
    checks.push({
      name: "Free space",
      status: freeBytes < 512 * 1024 * 1024 ? "warn" : "pass",
      detail: `${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)}.`,
    });
  } catch {
    facts.freeBytes = null;
    checks.push({
      name: "Free space",
      status: "warn",
      detail: "Bench could not read free space for this filesystem.",
    });
  }

  try {
    const [here, appDb] = await Promise.all([stat(path), stat(appDbDir).catch(() => null)]);
    const sameDevice = appDb ? here.dev === appDb.dev : null;
    facts.sameDeviceAsAppDb = sameDevice;
    if (sameDevice) {
      checks.push({
        name: "Separation",
        status: "warn",
        detail:
          "This is the same device as Bench's own data. It protects you from mistakes, but not from losing the disk - add a second destination for that.",
      });
    } else if (sameDevice === false) {
      checks.push({ name: "Separation", status: "pass", detail: "A different device from Bench's data." });
    }
  } catch {
    // Separation is advisory; failing to determine it is not a failure.
  }

  return { checks, facts };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export class LocalDestinationAdapter implements DestinationAdapter {
  readonly kind = "local" as const;
  readonly destinationId: string;
  readonly name: string;
  private readonly root: string;
  private readonly signal: AbortSignal | undefined;

  constructor(destination: BackupDestination, options: { signal?: AbortSignal } = {}) {
    this.destinationId = destination.id;
    this.name = destination.name;
    this.root = readLocalConfig(destination).path;
    this.signal = options.signal;
  }

  async put(key: string, bytes: Uint8Array): Promise<StoredObject> {
    this.signal?.throwIfAborted();
    const target = resolveKey(this.root, key);
    // The first folder this created, if any: its parent must be synced too,
    // or a crash can lose the new folder and the copy inside it.
    const created = await mkdir(dirname(target), { recursive: true });
    // Write to a sibling temp file and rename: a half-written backup that looks
    // complete is the one failure mode this whole feature exists to prevent.
    const temp = `${target}.${randomBytes(6).toString("hex")}.partial`;
    try {
      const handle = await open(temp, "w");
      try {
        await handle.writeFile(bytes, { signal: this.signal });
        // Flushed before the rename, not after: without it a power cut can
        // leave the renamed name pointing at an empty or short file, and the
        // manifest beside it would still say the copy verified.
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
      for (const directory of directoriesToSync(dirname(target), created)) await syncDirectory(directory);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw new DestinationError(
        `Could not write ${key}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, retryable: !this.signal?.aborted }
      );
    }
    const info = await stat(target);
    return { key, sizeBytes: info.size, lastModified: info.mtime.toISOString() };
  }

  /** A stream of the object, for handing a copy back without holding it in memory. */
  async getStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number }> {
    const path = resolveKey(this.root, key);
    // Opened here, before returning: a copy that cannot be opened then fails
    // this call, and the caller can try another copy before it has started
    // answering with this one.
    let handle;
    let info;
    try {
      handle = await open(path, "r");
      info = await handle.stat();
    } catch (error) {
      await handle?.close().catch(() => {});
      throw new DestinationError(
        `Could not read ${key}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    // The stream closes the handle when it ends or fails.
    const stream = Readable.toWeb(handle.createReadStream({ autoClose: true })) as ReadableStream<Uint8Array>;
    return { stream, sizeBytes: info.size };
  }

  /**
   * Confirm this folder is the destination Bench has been writing to.
   *
   * The marker names the destination. When it is missing (or names another
   * destination) and Bench expects copies here, one recorded copy is looked
   * for: if it is there the volume is plainly mounted - an install from before
   * the marker existed - and the marker is written; if not, nothing is
   * written and the caller is told the volume looks unmounted. An empty
   * destination simply gets its marker.
   */
  async confirmIdentity(input: { expectCopies: boolean; sampleKey: string | null }): Promise<void> {
    const markerPath = join(this.root, DESTINATION_MARKER);
    const marker = await readFile(markerPath, "utf8")
      .then((text) => JSON.parse(text) as { destinationId?: unknown })
      .catch(() => null);
    if (marker?.destinationId === this.destinationId) return;

    if (input.expectCopies) {
      const sample = input.sampleKey ? await this.head(input.sampleKey) : null;
      if (!sample) {
        throw new DestinationError(
          `${this.root} does not look like the folder Bench has been writing to: its marker file and its copies are missing. If this is a mounted volume, check that it is mounted, then try again.`,
          { retryable: true }
        );
      }
    }

    await mkdir(this.root, { recursive: true });
    await writeFile(
      markerPath,
      JSON.stringify({ destinationId: this.destinationId, name: this.name, writtenAt: new Date().toISOString() }, null, 2)
    );
  }

  /** Remove temp files a stopped write left behind. Best effort. */
  async sweepPartials(now = Date.now()): Promise<number> {
    let removed = 0;
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".partial")) continue;
        const info = await stat(full).catch(() => null);
        if (info && now - info.mtimeMs > PARTIAL_MAX_AGE_MS) {
          await rm(full, { force: true }).catch(() => {});
          removed += 1;
        }
      }
    };
    await walk(this.root);
    return removed;
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(resolveKey(this.root, key));
    } catch (error) {
      throw new DestinationError(
        `Could not read ${key}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const info = await stat(resolveKey(this.root, key));
      if (!info.isFile()) return null;
      return { key, sizeBytes: info.size, lastModified: info.mtime.toISOString() };
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const results: StoredObject[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (entry.name === DESTINATION_MARKER || entry.name.endsWith(".partial")) continue;
        const key = relative(this.root, full).split(sep).join("/");
        if (prefix && !key.startsWith(prefix)) continue;
        const info = await stat(full).catch(() => null);
        if (!info) continue;
        results.push({ key, sizeBytes: info.size, lastModified: info.mtime.toISOString() });
      }
    };
    await walk(this.root);
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  async remove(key: string): Promise<void> {
    await rm(resolveKey(this.root, key), { force: true });
  }

  async facts(): Promise<DestinationFacts> {
    const { facts } = await inspectLocalPath(this.root);
    return facts;
  }

  async test(): Promise<DestinationTestResult> {
    const { checks, facts } = await inspectLocalPath(this.root);
    if (checks.some((check) => check.status === "fail")) {
      return { ok: false, checks, facts };
    }

    // The only test that means anything: write real bytes, read them back and
    // compare the checksum. Permissions can pass while the volume is read-only
    // underneath, and a destination that cannot round-trip is not a destination.
    const probeKey = `.bench-destination-test-${randomBytes(6).toString("hex")}`;
    const payload = randomBytes(64);
    try {
      await this.put(probeKey, payload);
      const readBack = await this.get(probeKey);
      const same =
        createHash("sha256").update(payload).digest("hex") ===
        createHash("sha256").update(readBack).digest("hex");
      checks.push({
        name: "Round trip",
        status: same ? "pass" : "fail",
        detail: same
          ? "Wrote a test file, read it back and the checksums matched."
          : "The test file read back with different contents.",
      });
    } catch (error) {
      checks.push({
        name: "Round trip",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await this.remove(probeKey).catch(() => {});
    }

    return { ok: !checks.some((check) => check.status === "fail"), checks, facts };
  }
}

/**
 * The folders whose entries a write changed: the file's own folder, and the
 * parent of every folder `mkdir` created on the way to it.
 */
function directoriesToSync(fileDirectory: string, firstCreated: string | undefined): string[] {
  const directories = [fileDirectory];
  if (!firstCreated) return directories;
  const stop = dirname(firstCreated);
  let current = fileDirectory;
  while (current !== stop && dirname(current) !== current) {
    current = dirname(current);
    directories.push(current);
  }
  return directories;
}

/** What a platform answers when it does not support fsync on a directory. */
const DIRECTORY_SYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EPERM", "EISDIR", "EBADF"]);

/**
 * fsync a directory so a rename into it survives a crash. A platform that
 * does not support it is tolerated; a real I/O error is not, because the
 * write could not be confirmed durable.
 */
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    // Windows cannot open a folder for reading.
    if (error.code && (DIRECTORY_SYNC_UNSUPPORTED.has(error.code) || error.code === "EACCES")) return null;
    throw error;
  });
  if (!handle) return;
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !DIRECTORY_SYNC_UNSUPPORTED.has(code)) throw error;
  } finally {
    await handle.close();
  }
}
