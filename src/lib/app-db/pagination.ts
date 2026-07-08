/**
 * Coerce a caller-supplied limit into a safe positive integer within [1, max].
 *
 * Guards against `NaN`/`Infinity`/negative/fractional values (e.g. from an
 * unvalidated `?limit=` query string) reaching a SQL `LIMIT ?` bind, which
 * would otherwise throw at the driver. Non-finite input falls back to `def`.
 */
export function clampLimit(value: number | undefined, def: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return def;
  return Math.min(Math.max(Math.floor(value), 1), max);
}
