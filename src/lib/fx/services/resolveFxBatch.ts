import type { SqliteDatabase } from "@/lib/app-db/types";
import { FxError, isFxPending, type FxRateErrorCode } from "../errors";
import { resolveFxRate, type ResolveFxRateDeps } from "./resolveFxRate";
import type { FxRateResult } from "../types";

/**
 * Resolve many (base, quote, date) needs in one pass (RD-056 / PR-025b). The
 * preview collects every distinct pair+date it needs and resolves them together.
 * "Pending" outcomes (no usable/future rate, provider down) are returned
 * per-need rather than thrown, so one unresolved rate routes a single item to
 * review instead of failing the whole preview.
 */

export type FxNeed = { baseCurrency: string; quoteCurrency: string; date: string };
export type FxPending = { code: FxRateErrorCode; message: string };

export type FxBatchResult = {
  resolved: Record<string, FxRateResult>;
  pending: Record<string, FxPending>;
};

/** Stable key for a need, used by callers to look up its resolved rate. */
export function fxNeedKey(need: FxNeed): string {
  return `${need.baseCurrency.toUpperCase()}:${need.quoteCurrency.toUpperCase()}:${need.date}`;
}

function distinct(needs: readonly FxNeed[]): FxNeed[] {
  const seen = new Map<string, FxNeed>();
  for (const n of needs) if (!seen.has(fxNeedKey(n))) seen.set(fxNeedKey(n), n);
  return [...seen.values()];
}

export async function resolveFxBatch(
  db: SqliteDatabase,
  needs: readonly FxNeed[],
  deps: ResolveFxRateDeps = {}
): Promise<FxBatchResult> {
  const out: FxBatchResult = { resolved: {}, pending: {} };
  for (const need of distinct(needs)) {
    const key = fxNeedKey(need);
    try {
      out.resolved[key] = await resolveFxRate(db, need, deps);
    } catch (err) {
      if (isFxPending(err) || err instanceof FxError) {
        out.pending[key] = { code: (err as FxError).code, message: (err as FxError).message };
      } else {
        out.pending[key] = { code: "DATABASE_ERROR", message: err instanceof Error ? err.message : "FX resolution failed." };
      }
    }
  }
  return out;
}
