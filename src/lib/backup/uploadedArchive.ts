import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDbValidationError } from "@/lib/app-db/errors";
import {
  BodyTooLargeError,
  MissingBodyError,
  declaredLengthExceeds,
  readBoundedBody,
} from "@/lib/http/boundedBody";
import { ARCHIVE_LIMITS } from "./verify";

/**
 * A budget archive the browser posted (RD-077), read safely.
 *
 * A Direct budget lives in the operator's browser, so the browser exports it
 * and posts the archive as multipart; everything else posts plain JSON. Used
 * by "Back up now" and by recovery points, which need the same bounds.
 */

/**
 * How big an uploaded budget archive may be.
 *
 * Actual's own limit, taken from the verifier rather than restated, so the two
 * cannot drift: an archive this endpoint accepts is one verification will open,
 * and one Actual itself would.
 */
export const MAX_ARCHIVE_BYTES = ARCHIVE_LIMITS.maxArchiveBytes;

/**
 * What multipart framing adds on top of the archive.
 *
 * A multipart body is not just the file: each part carries a boundary line and
 * its own headers, and the request ends with a closing boundary. Holding the
 * whole request to the archive limit therefore refused an archive of exactly
 * the maximum size - a budget Actual would open, rejected at the door for the
 * few hundred bytes of envelope around it.
 */
const MULTIPART_FRAMING_BYTES = 64 * 1024;

/** The transport bound, which is the archive plus the envelope carrying it. */
const MAX_REQUEST_BYTES = MAX_ARCHIVE_BYTES + MULTIPART_FRAMING_BYTES;

async function boundedBody(request: Request): Promise<ArrayBuffer> {
  try {
    return await readBoundedBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError || error instanceof MissingBodyError) {
      throw new AppDbValidationError(error.message);
    }
    throw error;
  }
}

export type UploadedArchive = { bytes: Buffer; budgetId: string | null; budgetName: string | null };

/**
 * Reads the request either way: the archive and its text fields from
 * multipart, or the JSON object a request without an archive sends.
 */
export async function readArchiveRequest(request: Request): Promise<{
  archive: UploadedArchive | null;
  fields: Record<string, unknown>;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    // An absent body means "no options". Malformed JSON is the caller's
    // mistake and is reported rather than treated as empty.
    if (!request.body) return { archive: null, fields: {} };
    const raw = new TextDecoder().decode(await boundedBody(request));
    if (!raw.trim()) return { archive: null, fields: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppDbValidationError("Invalid JSON body");
    }
    const fields = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return { archive: null, fields };
  }

  // Bounded before the body is parsed, not only after: `formData()` buffers
  // the whole request first. A declared length is only a claim, so the body is
  // also read through a counter that stops at the same limit.
  if (declaredLengthExceeds(request, MAX_REQUEST_BYTES)) {
    throw new AppDbValidationError(new BodyTooLargeError(MAX_REQUEST_BYTES).message);
  }

  const form = await new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: await boundedBody(request),
  }).formData();
  const file = form.get("archive");
  if (!(file instanceof File)) {
    throw new AppDbValidationError("The upload carried no budget archive.");
  }
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new AppDbValidationError(
      `The exported budget is larger than the ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024)}MB this endpoint accepts.`
    );
  }
  if (file.size === 0) {
    throw new AppDbValidationError("The exported budget was empty, so there is nothing to store.");
  }

  const fields: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key !== "archive" && typeof value === "string" && value.trim()) fields[key] = value.trim();
  }

  return {
    archive: {
      bytes: Buffer.from(await file.arrayBuffer()),
      budgetId: typeof fields.budgetId === "string" ? fields.budgetId : null,
      budgetName: typeof fields.budgetName === "string" ? fields.budgetName : null,
    },
    fields,
  };
}

/**
 * An archive parked on disk for a worker to read.
 *
 * A worker gets work by reference, and a budget is too big to post between
 * threads twice, so it is written to a private temp folder and the worker is
 * given the path. The caller removes it once the work is done.
 */
export type ParkedArchive = { path: string; budgetId: string | null; budgetName: string | null };

export async function parkArchive(archive: UploadedArchive): Promise<{ parked: ParkedArchive; release: () => Promise<void> }> {
  const folder = await mkdtemp(join(tmpdir(), "bench-upload-"));
  const path = join(folder, "budget.zip");
  try {
    await writeFile(path, archive.bytes);
  } catch (error) {
    // A half-written budget left in the temp folder would never be removed.
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    parked: { path, budgetId: archive.budgetId, budgetName: archive.budgetName },
    release: () => rm(folder, { recursive: true, force: true }),
  };
}

export async function readParkedArchive(parked: ParkedArchive): Promise<UploadedArchive> {
  return { bytes: await readFile(parked.path), budgetId: parked.budgetId, budgetName: parked.budgetName };
}
