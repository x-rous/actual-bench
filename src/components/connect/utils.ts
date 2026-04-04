// ─── URL helpers ──────────────────────────────────────────────────────────────

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function deriveLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

// ─── Error parsing ────────────────────────────────────────────────────────────

/**
 * Converts any thrown API error into a human-readable message.
 * Single source of truth for all error paths in ConnectForm.
 */
export function parseApiError(err: unknown): string {
  const status =
    err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : -1;
  const raw =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : "";
  // Suppress the browser's opaque "fetch failed" / "Failed to fetch" strings —
  // they add no information beyond what the status-based messages already say.
  const detail =
    raw && !["fetch failed", "failed to fetch"].includes(raw.toLowerCase())
      ? ` — ${raw}`
      : "";

  if (status === -1)                    return `Cannot reach the server. Check the URL and that it is running.${detail}`;
  if (status === 401 || status === 403) return "Invalid API Key.";
  if (status === 404)                   return `Not found (HTTP 404)${detail}.`;
  if (status === 502 || status === 503 || status === 504)
                                        return `Server unavailable (HTTP ${status})${detail}.`;
  if (status >= 500)                    return `Server error (HTTP ${status})${detail}.`;
  if (status >= 400)                    return `Request error (HTTP ${status})${detail}.`;
  return detail ? detail.slice(4) : "Unexpected error."; // strip leading " — "
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidateStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

export type ConnectStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string }
  | { kind: "success" };
