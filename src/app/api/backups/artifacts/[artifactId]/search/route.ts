import { NextResponse } from "next/server";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getAppDb } from "@/lib/app-db/connection";
import {
  BACKUP_SEARCH_KINDS,
  searchArtifact,
  type BackupSearchInput,
  type BackupSearchKind,
  type BackupSearchResult,
} from "@/lib/backup/search";
import { runBackupTask } from "@/lib/backup/tasks";
import { prepareTypedPassphrase, typedPassphraseFrom } from "@/lib/backup/typedPassphrase";

type RouteContext = { params: Promise<{ artifactId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** A real calendar date in ISO form, or null: "2026-02-30" has the right shape and is not a date. */
function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

/**
 * Search inside one budget backup: transactions, payees, categories or
 * accounts as they were in that copy. Read-only, nothing is recorded, and the
 * copy is opened in a worker like "Look inside".
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const body = ((await readJsonBody(request).catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const kind = BACKUP_SEARCH_KINDS.includes(body.kind as BackupSearchKind) ? (body.kind as BackupSearchKind) : "transactions";
    const query: BackupSearchInput = {
      kind,
      text: typeof body.text === "string" ? body.text.slice(0, 200) : "",
      from: isoDate(body.from),
      to: isoDate(body.to),
      page: typeof body.page === "number" && Number.isFinite(body.page) ? Math.min(100_000, Math.max(0, Math.floor(body.page))) : 0,
    };

    const passphrase = typedPassphraseFrom(body);
    const { sealed, runHere } = prepareTypedPassphrase(passphrase);
    if (runHere) {
      return NextResponse.json({ result: await searchArtifact(getAppDb(), artifactId, query, { passphrase }) });
    }

    const outcome = await runBackupTask<BackupSearchResult>({
      kind: "backup.search",
      taskInput: { artifactId, passphrase: sealed, query },
      deadlineMs: 110_000,
      inThread: (signal) => searchArtifact(getAppDb(), artifactId, query, { passphrase, signal }),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
    return NextResponse.json({ result: outcome.value });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
