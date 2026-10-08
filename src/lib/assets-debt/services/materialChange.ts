import { canonicalJson } from "@/lib/app-db/canonicalJson";
import type { DebtAssumptionRecord, DebtOffsetLinkRecord, DebtRatePeriodRecord, DebtRecord } from "@/lib/app-db/types";
import type { DebtConfig } from "@/lib/financial-models/loan/configSchema";

/**
 * What a debt's model revision contains (RD-084 P1.3; FR-023, G1 D-10/D-13).
 *
 * A revision snapshot, `rd084.debt-revision` v2, wraps every material input.
 * v2 adds each offset link's Actual-history source flag; v1 remains readable
 * and an absent flag means false.
 * the debt's own columns, its `rd084.debt-config` document, and its rate
 * periods, offset links and baseline assumptions. A save creates a revision
 * exactly when the snapshot's hash changes.
 *
 * Everything persisted is **material by default**. Only these are left out:
 *
 * - Bench's own row ids, timestamps, revision numbers and the subject id;
 * - the explicit cosmetic whitelist below.
 *
 * So a column added later is material until someone deliberately whitelists
 * it, and a missed classification can only create an extra revision, never
 * hide a financial change. Semantic external ids (Actual accounts and
 * categories) and component labels are material: they can reach posting
 * lines and audit output.
 *
 * The snapshot never holds Actual transactions, Actual balances or projection
 * rows. Engine versions belong to each calculation, not to a revision.
 */

export const DEBT_REVISION_FORMAT = "rd084.debt-revision";
export const DEBT_REVISION_VERSION = 2;

/** Bench bookkeeping: ids, timestamps, revision pointers, derived flags. Never hashed. */
const BOOKKEEPING = {
  debt: ["id", "createdAt", "updatedAt", "archivedAt", "currentRevision", "driftAcceptedRevision", "driftAcceptedFingerprint", "currentConfigJson", "unknownValues"],
  child: ["id", "debtId", "createdAt", "updatedAt"],
} as const;

/** The cosmetic whitelist (G1 D-13). Changing only these never creates a revision. */
export const COSMETIC_FIELDS = {
  debt: ["name"],
  rate: ["source", "note"],
  offset: [],
  assumption: ["note"],
  /** Inside `rd084.debt-config`: the note on a dated recast. */
  paymentRecast: ["note"],
} as const;

export type DebtRevisionSnapshot = {
  format: typeof DEBT_REVISION_FORMAT;
  version: typeof DEBT_REVISION_VERSION;
  debt: Record<string, unknown>;
  config: Record<string, unknown>;
  rates: Record<string, unknown>[];
  offsets: Record<string, unknown>[];
  assumptions: Record<string, unknown>[];
};

export type DebtRevisionInput = {
  debt: DebtRecord;
  config: DebtConfig;
  rates: readonly DebtRatePeriodRecord[];
  offsets: readonly DebtOffsetLinkRecord[];
  assumptions: readonly DebtAssumptionRecord[];
};

function without(value: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (!keys.includes(k)) out[k] = v === undefined ? null : v;
  return out;
}

/** Deterministic order for child rows: the given keys, then the canonical text of the whole row. */
function sortRows(rows: Record<string, unknown>[], keys: string[]): Record<string, unknown>[] {
  const key = (r: Record<string, unknown>) => [...keys.map((k) => String(r[k] ?? "")), canonicalJson(r)];
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
}

export function buildDebtRevisionSnapshot(input: DebtRevisionInput): DebtRevisionSnapshot {
  const config = structuredClone(input.config) as DebtConfig;
  const paymentRecasts = config.paymentRecasts.map((r) => without(r, COSMETIC_FIELDS.paymentRecast));
  return {
    format: DEBT_REVISION_FORMAT,
    version: DEBT_REVISION_VERSION,
    debt: without(input.debt, [...BOOKKEEPING.debt, ...COSMETIC_FIELDS.debt]),
    config: { ...(config as unknown as Record<string, unknown>), paymentRecasts },
    rates: sortRows(input.rates.map((r) => without(r, [...BOOKKEEPING.child, ...COSMETIC_FIELDS.rate])), ["accrualEffectiveFrom"]),
    offsets: sortRows(input.offsets.map((r) => without(r, [...BOOKKEEPING.child, ...COSMETIC_FIELDS.offset])), ["effectiveFrom", "actualAccountId"]),
    assumptions: sortRows(input.assumptions.map((r) => without(r, [...BOOKKEEPING.child, ...COSMETIC_FIELDS.assumption])), ["effectiveFrom", "assumptionKind"]),
  };
}
