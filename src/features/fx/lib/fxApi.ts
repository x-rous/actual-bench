import type { FxRateRecord } from "@/lib/fx/types";
import type { FxImportPreview } from "@/lib/fx/services/importFxRates";
import type { FxRateImportBatch } from "@/lib/fx/types";

/** Client API for the FX rate registry (RD-056 / PR-025e). */

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { headers: { "Content-Type": "application/json" }, cache: "no-store", ...init });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status})`);
  return data;
}

export function listFxRates(base: string, quote: string, from: string, to: string): Promise<{ rates: FxRateRecord[] }> {
  const q = new URLSearchParams({ base, quote, from, to }).toString();
  return jsonFetch(`/api/fx/rates?${q}`);
}

export function addManualFxRate(input: { baseCurrency: string; quoteCurrency: string; date: string; rate: string; notes?: string }): Promise<{ rate: FxRateRecord }> {
  return jsonFetch("/api/fx/rates", { method: "POST", body: JSON.stringify(input) });
}

export function previewFxImport(csv: string, options?: { overrideProvider?: boolean; overrideManual?: boolean }): Promise<FxImportPreview> {
  return jsonFetch("/api/fx/import", { method: "POST", body: JSON.stringify({ csv, mode: "preview", ...options }) });
}

export function commitFxImport(csv: string, filename: string, options?: { overrideProvider?: boolean; overrideManual?: boolean }): Promise<{ batch: FxRateImportBatch }> {
  return jsonFetch("/api/fx/import", { method: "POST", body: JSON.stringify({ csv, filename, mode: "commit", ...options }) });
}

/** Pre-fetch a continuous daily series for a pair from the provider. */
export function fillFxRange(baseCurrency: string, quoteCurrency: string, from: string, to: string): Promise<{ result: { fetched: number; inserted: number; skipped: number } }> {
  return jsonFetch("/api/fx/rates/fill", { method: "POST", body: JSON.stringify({ baseCurrency, quoteCurrency, from, to }) });
}

/** Read-only: synced transactions on a date whose converted amount would change under the current rate. */
export function fxRecalcImpact(base: string, quote: string, date: string): Promise<{ activeRate: string | null; rows: { transactionId: string; sourceAmount: number; appliedRate: string; oldConvertedAmount: number; newConvertedAmount: number }[] }> {
  const q = new URLSearchParams({ base, quote, date }).toString();
  return jsonFetch(`/api/fx/recalc-impact?${q}`);
}
