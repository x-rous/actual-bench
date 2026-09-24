/**
 * Step limits for opening and using an `@actual-app/api` runtime, shared by the
 * browser host and the Node host (RD-095 M3). A runtime call that hangs - a
 * server that accepts the connection and never answers - must end as an error
 * the user can read, not as a page or worker that waits forever.
 */

export const DEFAULT_STEP_TIMEOUT_MS = 45_000;
export const SHUTDOWN_STEP_TIMEOUT_MS = 15_000;

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function withTimeout<T>(
  promise: Promise<T>,
  stepLabel: string,
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          stepLabel +
            " did not finish within " +
            Math.round(timeoutMs / 1000) +
            " seconds."
        )
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
