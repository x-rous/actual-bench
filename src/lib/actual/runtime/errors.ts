/**
 * What went wrong opening a Direct budget, in words a person can act on
 * (RD-095 M3).
 *
 * `@actual-app/api` 26.9 tags most of these failures with a machine-readable
 * `code` (`withErrorCode`), which is read first. Older builds - and a few
 * paths still - report them with message text only (M0, Appendix B.4), so the
 * text is the fallback. This is the one place that reads either, and it is on
 * the Actual release-review checklist: its tests pin the exact codes and
 * wording, because an upstream change breaks it silently.
 */

export type ActualErrorCode =
  | "ENCRYPTION_KEY_REQUIRED"
  | "ENCRYPTION_KEY_WRONG"
  | "AUTH_FAILED"
  | "SERVER_UNREACHABLE"
  | "BUDGET_NOT_FOUND";

type Rule = { code: ActualErrorCode; codes: string[]; text: RegExp; message: string };

// Order matters for the text fallback: "Authentication failed: network-failure"
// is an unreachable server, not a wrong password.
const RULES: Rule[] = [
  {
    code: "ENCRYPTION_KEY_REQUIRED",
    codes: ["missing-key"],
    // "File <name> is encrypted. Please provide a password."
    text: /is encrypted\. Please provide a password/i,
    message: "This budget is end-to-end encrypted. Add its encryption password to the connection.",
  },
  {
    code: "ENCRYPTION_KEY_WRONG",
    codes: ["decrypt-failure"],
    // "Unable to decrypt file with this password. Please try again."
    text: /Unable to decrypt file with this password/i,
    message: "The budget's encryption password is wrong. Update it on the connection.",
  },
  {
    code: "SERVER_UNREACHABLE",
    codes: ["network-failure", "network"],
    text: /network-failure|offline or unreachable|Could not get remote files|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|getaddrinfo|socket hang up/i,
    message: "Could not reach the Actual server. Check the address and that it is running.",
  },
  {
    code: "AUTH_FAILED",
    codes: ["invalid-password", "token-expired", "unauthorized", "not-logged-in"],
    // "Authentication failed: <reason>"
    text: /Authentication failed|invalid-password/i,
    message: "The Actual server refused the password. Update it on the connection.",
  },
  {
    code: "BUDGET_NOT_FOUND",
    codes: ["budget-not-found", "file-not-found"],
    // 'Budget "<id>" not found. Check the sync id of your budget ...'
    text: /Budget ".*" not found|budget-not-found|file-not-found/i,
    message: "The Actual server has no budget with this sync ID. It may have been deleted or reset.",
  },
];

export class ActualRuntimeError extends Error {
  readonly code: ActualErrorCode;

  constructor(code: ActualErrorCode, message: string) {
    super(message);
    this.name = "ActualRuntimeError";
    this.code = code;
  }
}

function textOf(error: unknown): string {
  if (error instanceof Error) {
    // Actual sometimes wraps the useful part: `reason` on a PostError, and
    // `cause` on a failed fetch.
    const extra = [
      (error as { reason?: unknown }).reason,
      (error as { cause?: { code?: unknown; message?: unknown } }).cause?.code,
      (error as { cause?: { code?: unknown; message?: unknown } }).cause?.message,
    ].filter((part): part is string => typeof part === "string");
    return [error.message, ...extra].join(" ");
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; reason?: unknown; error?: unknown };
    return [record.message, record.reason, record.error].filter((part) => typeof part === "string").join(" ");
  }
  return String(error);
}

function ruleFor(error: unknown): Rule | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    const byCode = RULES.find((rule) => rule.codes.includes(code));
    if (byCode) return byCode;
  }
  const text = textOf(error);
  return RULES.find((rule) => rule.text.test(text));
}

/** The plain-language message for a known failure. */
export function actualErrorMessage(code: ActualErrorCode): string {
  return RULES.find((rule) => rule.code === code)!.message;
}

/** The code for a failure, or `null` when it is none of the known ones. */
export function classifyActualError(error: unknown): ActualErrorCode | null {
  // Already classified - by the Node host, on its way up.
  if (error instanceof ActualRuntimeError) return error.code;
  return ruleFor(error)?.code ?? null;
}

/**
 * The failure as an `ActualRuntimeError` in plain language when it is a known
 * one; otherwise the original error, untouched.
 */
export function toActualRuntimeError(error: unknown): unknown {
  if (error instanceof ActualRuntimeError) return error;
  const rule = ruleFor(error);
  return rule ? new ActualRuntimeError(rule.code, rule.message) : error;
}
