/**
 * Next.js server startup hook. Boots the in-process unattended sync scheduler
 * (RD-058 / PR-024c) once, in the Node runtime only (never edge / build).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startUnattendedScheduler } = await import("@/lib/sync/schedulerRuntime");
  startUnattendedScheduler();
}
