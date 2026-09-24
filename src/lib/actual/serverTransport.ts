// Loaded for its side effect: it installs the per-server request lock that the
// HTTP transport's unattended requests go through (F-189).
import "@/lib/http/serverQueue";
import { getSyncCredential } from "@/lib/credentials/unattendedCredentials";
import type { SqliteDatabase, SyncCredentialMeta, SyncCredentialSecret } from "@/lib/app-db/types";
import type { ConnectionInstance } from "@/store/connection";
import { createHttpApiTransport } from "./httpApiTransport";
import { nodeHost } from "./runtime/nodeHost";
import { createActualRuntimeTransport } from "./runtimeTransport";
import type { ActualBenchTransport } from "./transport";

/**
 * Connections and transports for code that runs with no browser (RD-095 M3).
 *
 * An enrolled connection is turned back into the same `ConnectionInstance` a
 * tab would hold, and gets the same transport a tab would use - HTTP as is,
 * Direct on the Node host instead of the tab's runtime. Jobs then run the
 * shared engines (sync, bank sync, backup) without knowing which mode they
 * were given.
 *
 * Direct opens only inside an automation worker; the Node host refuses the
 * web server's own thread. Server-only.
 */

/** The connection an enrolment describes, with its secrets. Throws when they do not match its mode. */
export function connectionFromEnrolment(meta: SyncCredentialMeta, secret: SyncCredentialSecret): ConnectionInstance {
  const base = {
    id: meta.connectionFingerprint,
    label: meta.label || meta.baseUrl,
    baseUrl: meta.baseUrl,
    budgetSyncId: meta.budgetSyncId,
    ...(secret.encryptionPassword ? { encryptionPassword: secret.encryptionPassword } : {}),
  };

  if (meta.mode === "http-api" && secret.apiKey) {
    return { ...base, mode: "http-api", apiKey: secret.apiKey };
  }
  if (meta.mode === "browser-api" && secret.serverPassword) {
    return { ...base, mode: "browser-api", serverPassword: secret.serverPassword };
  }
  throw new Error("The stored credential does not match this connection's mode. Re-enrol the connection.");
}

/**
 * The enrolled connection for a fingerprint, or `null` when it is not
 * enrolled. Throws when the vault cannot open its secrets - callers pause,
 * never guess.
 */
export function resolveServerConnection(db: SqliteDatabase, connectionFingerprint: string): ConnectionInstance | null {
  const credential = getSyncCredential(db, connectionFingerprint);
  if (!credential) return null;
  const { secret, ...meta } = credential;
  return connectionFromEnrolment(meta, secret);
}

/** The transport for a connection on the server: HTTP directly, Direct on the Node host. */
export function openServerTransport(connection: ConnectionInstance): ActualBenchTransport {
  return connection.mode === "http-api"
    ? createHttpApiTransport(connection)
    : createActualRuntimeTransport(connection, nodeHost);
}
