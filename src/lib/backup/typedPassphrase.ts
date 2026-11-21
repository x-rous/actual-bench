import { getAutomationExecutor } from "@/lib/automation/executor";
import { sealSecret, type SealedSecret } from "@/lib/sync/vault";

/**
 * A passphrase typed for one read of an encrypted backup ("Look inside",
 * search, compare), on its way to a worker. Server-only.
 *
 * Tasks carry secrets sealed, never in plaintext, so it is sealed with the
 * vault key and opened only in the worker. With the vault locked there is
 * nothing to seal it with; that one case runs in this thread instead
 * (`runHere`), where the passphrase never leaves the request.
 */
export function prepareTypedPassphrase(passphrase: string | undefined): { sealed: SealedSecret | null; runHere: boolean } {
  if (!passphrase) return { sealed: null, runHere: false };
  try {
    return { sealed: sealSecret(passphrase), runHere: false };
  } catch {
    return { sealed: null, runHere: getAutomationExecutor().name === "worker" };
  }
}

/** The typed passphrase from a request body, if one was sent. */
export function typedPassphraseFrom(body: unknown): string | undefined {
  const value = body && typeof body === "object" ? (body as { passphrase?: unknown }).passphrase : undefined;
  return typeof value === "string" && value ? value : undefined;
}
