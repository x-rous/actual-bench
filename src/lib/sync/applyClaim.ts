/**
 * Timing of an apply's claim on its run. The order matters: a writer that cannot
 * renew stops at `APPLY_STOP_AFTER_MS`, well before cleanup may hand its flow to
 * another apply at `ABANDONED_APPLY_MS`, so two writers never overlap.
 */
export const APPLY_HEARTBEAT_MS = 60_000;
export const APPLY_STOP_AFTER_MS = 10 * 60_000;
export const ABANDONED_APPLY_MS = 30 * 60_000;
