import { logger } from "@/lib/logger";
import type { AutomationLogger } from "./registry";

/**
 * The logger handed to a running job (RD-079 / PR-043b).
 *
 * Run output is written by job types we control today and by ones we don't yet,
 * against servers whose error text we don't author. So redaction happens here,
 * at the one place every line passes through, rather than trusting each call
 * site to remember. Two mechanisms, because they fail differently:
 *
 *   * **Known secrets** registered for the run are replaced wherever they
 *     appear, including inside a provider's error message that echoed a URL.
 *   * **Secret-shaped patterns** (`apiKey=…`, `Bearer …`, `password: …`) are
 *     redacted even when the value was never registered — the case that matters
 *     when a dependency logs something we didn't hand it.
 *
 * A short secret (under 8 characters) is *not* pattern-registered: replacing
 * every occurrence of a 3-character string would corrupt ordinary text without
 * protecting anything meaningful.
 */

export const REDACTED = "[redacted]";

const SECRET_PATTERNS: RegExp[] = [
  // key=value / key: value, quoted or bare, for credential-ish key names.
  /((?:api[_-]?key|password|passphrase|secret|token|credential)["']?\s*[:=]\s*["']?)([^\s"',;}]+)/gi,
  // Authorization headers.
  /(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
  // Credentials embedded in a URL.
  /(\/\/[^\s/:@]+:)([^\s@]+)(@)/g,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(message: string, knownSecrets: readonly string[] = []): string {
  let output = message;

  for (const secret of knownSecrets) {
    if (secret.length < 8) continue;
    output = output.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (_match, prefix: string, _value: string, suffix = "") =>
      `${prefix}${REDACTED}${suffix}`
    );
  }

  return output;
}

export type RunLogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  at: string;
};

export type AutomationRunLogger = AutomationLogger & {
  /** Register a value that must never appear in output. */
  protect(secret: string | undefined | null): void;
  /** The redacted lines this run produced, for the run detail view. */
  entries(): RunLogEntry[];
};

export function createRunLogger(context: { automationId: string; type: string; runId: string }): AutomationRunLogger {
  const secrets: string[] = [];
  const entries: RunLogEntry[] = [];
  const child = logger.child({ automation: context.automationId, type: context.type, run: context.runId });

  const record = (level: RunLogEntry["level"], message: string): void => {
    const safe = redactSecrets(message, secrets);
    // Run history is bounded: a job that logs in a loop must not grow the row
    // without limit. Older lines are dropped, and the drop is visible.
    if (entries.length === 500) {
      entries.push({ level: "warn", message: "Log truncated: further lines were not recorded.", at: new Date().toISOString() });
    }
    if (entries.length <= 500) {
      entries.push({ level, message: safe, at: new Date().toISOString() });
    }
    child[level](safe);
  };

  return {
    info: (message: string) => record("info", message),
    warn: (message: string) => record("warn", message),
    error: (message: string) => record("error", message),
    protect(secret) {
      if (secret) secrets.push(secret);
    },
    entries: () => [...entries],
  };
}
