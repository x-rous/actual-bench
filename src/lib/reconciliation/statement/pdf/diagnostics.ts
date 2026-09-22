import type { PdfDiagnosticEvent } from "./model";

const SENSITIVE_KEY = /(text|name|account|customer|description|reference|raw|value)/i;

/** Diagnostics are shape/count only and never contain statement text. */
export function diagnostic(
  event: Omit<PdfDiagnosticEvent, "metrics"> & {
    metrics?: Record<string, number | string | boolean | null>;
  }
): PdfDiagnosticEvent {
  const metrics = Object.fromEntries(
    Object.entries(event.metrics ?? {})
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 40) : value])
  );
  return { ...event, metrics };
}

export function diagnosticsArePrivacySafe(events: PdfDiagnosticEvent[]): boolean {
  return events.every((event) =>
    Object.keys(event.metrics ?? {}).every((key) => !SENSITIVE_KEY.test(key))
  );
}
