/**
 * Manual split overrides (RD-084 P1.6b T291; FR-069d). Shared by the server
 * check and the browser editor so both apply the same limit.
 *
 * Up to this many minor currency units from Bench's calculation (for example
 * ±0.01 AED), an edit needs no reason; anything larger needs a short one
 * (owner refinement 2).
 */
export const OVERRIDE_NO_REASON_MINOR = 1;
