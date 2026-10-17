import type { ApplyConfig } from "./plan";

/** Exact decision comparison for Apply; not a stored version or an opaque marker. */
export function decisionSignature(items: {
  id: string; disposition: string; statementRowIds: string[];
  actualTransactionIds: string[]; stagedChanges?: unknown;
}[], config: ApplyConfig): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])
    );
    return value;
  }
  return JSON.stringify(canonical({ config, items: items.map((item) => ({
    id: item.id, disposition: item.disposition, statementRowIds: item.statementRowIds,
    actualTransactionIds: item.actualTransactionIds, stagedChanges: item.stagedChanges ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id)) }));
}
