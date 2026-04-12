/**
 * cURL command generation for the last successfully executed ActualQL request.
 *
 * buildSanitizedCurl — default. Replaces secrets with named placeholders.
 * buildFullCurl      — includes real credentials. Must only be shown on
 *                      explicit opt-in with a warning about sensitive data.
 *
 * Always generated from the last successful request snapshot, not from the
 * current editor state (which may have changed since execution).
 */

import type { LastExecutedRequest } from "../types";

/**
 * Escapes a value for safe interpolation inside a double-quoted shell string.
 * Handles: backslash, double-quote, dollar sign, backtick, and newline.
 */
function shellEscapeDoubleQuote(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/\n/g, "\\n");
}

const ENDPOINT_PATH = (budgetSyncId: string) =>
  `/v1/budgets/${budgetSyncId}/run-query`;

function buildCurl(
  req: LastExecutedRequest,
  sanitize: boolean
): string {
  const url = `${req.baseUrl.replace(/\/$/, "")}${ENDPOINT_PATH(req.budgetSyncId)}`;
  const body = JSON.stringify({ ActualQLquery: req.query }, null, 2);
  const apiKey = sanitize ? "{{API_KEY}}" : shellEscapeDoubleQuote(req.apiKey);

  const lines: string[] = [
    `curl -X POST "${url}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "x-api-key: ${apiKey}" \\`,
  ];

  // The proxy always sends budget-encryption-password (empty string when unset),
  // so the cURL output must always include the header to match actual behaviour.
  const password = sanitize
    ? "{{BUDGET_ENCRYPTION_PASSWORD}}"
    : shellEscapeDoubleQuote(req.encryptionPassword ?? "");
  lines.push(`  -H "budget-encryption-password: ${password}" \\`);

  lines.push(`  -d '${body.replace(/'/g, "'\\''")}'`);

  return lines.join("\n");
}

export function buildSanitizedCurl(req: LastExecutedRequest): string {
  return buildCurl(req, true);
}

export function buildFullCurl(req: LastExecutedRequest): string {
  return buildCurl(req, false);
}
