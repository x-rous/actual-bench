import { withTimeout } from "./timeouts";
import type { ActualApiRuntime } from "./types";

/**
 * Export the open budget as Actual's archive (a zip), after a sync. The same
 * `export-budget` call on both hosts; only the byte container Actual hands
 * back differs between its browser and Node builds.
 */

type ActualExportBudgetResult = {
  data?: unknown;
  error?: string;
};

export function exportedZipToBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }

  if (
    data &&
    typeof data === "object" &&
    "type" in data &&
    (data as { type?: unknown }).type === "Buffer" &&
    "data" in data &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Uint8Array.from((data as { data: number[] }).data);
  }

  throw new Error("Direct budget export returned an unsupported byte payload.");
}

export async function exportRuntimeBudget(
  runtime: ActualApiRuntime,
  /** Per step. A worker allows longer than a tab: its task has a deadline of its own. */
  stepTimeoutMs?: number
): Promise<Uint8Array> {
  await withTimeout(runtime.sync(), "Syncing budget", stepTimeoutMs);
  const result = await withTimeout(
    runtime.send<ActualExportBudgetResult | null>("export-budget"),
    "Exporting budget snapshot",
    stepTimeoutMs
  );

  if (!result) {
    throw new Error("Direct budget export returned no data.");
  }

  if (result.error) {
    throw new Error("Direct budget export failed: " + result.error);
  }

  return exportedZipToBytes(result.data);
}
