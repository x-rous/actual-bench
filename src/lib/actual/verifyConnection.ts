import { z } from "zod";
import { openSecret, sealSecret, type SealedSecret } from "@/lib/sync/vault";
import { redactSecrets } from "@/lib/automation/runLogger";
import type { SyncCredentialSecret } from "@/lib/app-db/types";
import { classifyActualError, type ActualErrorCode } from "./runtime/errors";
import { closeNodeRuntime, getNodeRuntime } from "./runtime/nodeHost";
import { connectionFromEnrolment, openServerTransport } from "./serverTransport";

/**
 * Check an enrolment against the Actual server before it is stored (RD-095 M4).
 *
 * Unattended secrets are one per server, so storing a wrong one would break
 * every enrolled budget on that server, and nobody would find out until the
 * next scheduled run. The check does what a run does: Direct opens the budget
 * through the Node host (sign in, download, sync), HTTP reads through the HTTP
 * transport. A connection that passes here is one a run can open.
 *
 * The secret arrives **sealed** with `SYNC_VAULT_KEY`: the check runs in a
 * worker, and a secret never crosses into one in plaintext. It is opened here,
 * inside the worker, and never leaves it.
 *
 * Server-only.
 */

export const verifyConnectionInput = z.object({
  connectionFingerprint: z.string().min(1),
  mode: z.enum(["http-api", "browser-api"]),
  baseUrl: z.string().min(1),
  budgetSyncId: z.string().min(1),
  label: z.string(),
  sealed: z.object({ ciphertext: z.string(), iv: z.string(), authTag: z.string() }),
});

export type VerifyConnectionInput = z.infer<typeof verifyConnectionInput>;

export type VerifyConnectionResult =
  | { ok: true }
  | { ok: false; code: ActualErrorCode | null; message: string };

/** The secret in the shape the check carries it: one JSON document, sealed with the operator key. */
export function sealEnrolmentSecret(secret: SyncCredentialSecret): SealedSecret {
  return sealSecret(JSON.stringify(secret));
}

const MESSAGES: Record<Exclude<ActualErrorCode, "AUTH_FAILED">, string> = {
  ENCRYPTION_KEY_REQUIRED: "This budget is encrypted. Connect again with its encryption password, then enrol.",
  ENCRYPTION_KEY_WRONG: "The encryption password is not correct. Connect again with the correct one, then enrol.",
  BUDGET_NOT_FOUND: "The server has no budget with this sync ID.",
  SERVER_UNREACHABLE: "Bench cannot reach the server. Check the server address and that the server is running.",
};

function failure(
  mode: VerifyConnectionInput["mode"],
  code: ActualErrorCode | null,
  fallback: string
): VerifyConnectionResult {
  if (code === "AUTH_FAILED") {
    return {
      ok: false,
      code,
      message: `The server did not accept the ${mode === "http-api" ? "API key" : "password"}.`,
    };
  }
  return { ok: false, code, message: code ? MESSAGES[code] : fallback };
}

/** What an HTTP transport failure means, from actual-http-api's status and text. */
function classifyHttpFailure(error: unknown): ActualErrorCode | null {
  const status = (error as { status?: unknown } | null)?.status;
  // The text first: actual-http-api passes Actual's own errors through, and
  // "Unable to decrypt" arrives as a 500, not as anything more specific.
  const fromText = classifyActualError(error);
  if (fromText) return fromText;
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 404) return "BUDGET_NOT_FOUND";
  if (status === 0 || status === 502 || status === 504) return "SERVER_UNREACHABLE";
  return null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "The check failed.";
}

export async function verifyConnection(input: VerifyConnectionInput): Promise<VerifyConnectionResult> {
  let secret: SyncCredentialSecret;
  try {
    secret = JSON.parse(openSecret(input.sealed as SealedSecret)) as SyncCredentialSecret;
  } catch {
    return failure(input.mode, null, "Bench could not read the password to check it. Try again.");
  }

  // Anything that passes through from upstream is redacted before it leaves:
  // a provider error that echoes the password back must not reach the page.
  const known = [secret.apiKey, secret.serverPassword, secret.encryptionPassword].filter(
    (value): value is string => !!value
  );
  const fail = (code: ActualErrorCode | null, error: unknown) =>
    failure(input.mode, code, redactSecrets(describe(error), known));

  const now = new Date().toISOString();
  let connection;
  try {
    connection = connectionFromEnrolment(
      {
        connectionFingerprint: input.connectionFingerprint,
        mode: input.mode,
        baseUrl: input.baseUrl,
        budgetSyncId: input.budgetSyncId,
        label: input.label,
        createdAt: now,
        updatedAt: now,
      },
      secret
    );
  } catch (error) {
    return fail(null, error);
  }

  if (connection.mode === "browser-api") {
    try {
      await getNodeRuntime(connection);
    } catch (error) {
      await closeNodeRuntime().catch(() => undefined);
      return fail(classifyActualError(error), error);
    }
    // It opened: the password and the encryption password work. No snapshot
    // refresh here: uploading one takes several seconds per budget, which made
    // enrolling a batch slow, and the first scheduled run refreshes it anyway
    // once it finishes cleanly (PR-071c).
    await closeNodeRuntime().catch(() => undefined);
    return { ok: true };
  }

  try {
    // One read that needs the key, the budget and its encryption password.
    await openServerTransport(connection).getAccounts();
    return { ok: true };
  } catch (error) {
    return fail(classifyHttpFailure(error), error);
  }
}
