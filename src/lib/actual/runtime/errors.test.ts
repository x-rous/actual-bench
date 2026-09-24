import { ActualRuntimeError, classifyActualError, toActualRuntimeError } from "./errors";

/**
 * Pins what `@actual-app/api` actually says (26.9.0, and the M0 runs against a
 * real server). An upstream wording or code change fails here first - this
 * file is on the Actual release-review checklist.
 */

function tagged(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

describe("classifyActualError", () => {
  it.each([
    ["File Envelope is encrypted. Please provide a password.", "missing-key", "ENCRYPTION_KEY_REQUIRED"],
    ["Unable to decrypt file with this password. Please try again.", "decrypt-failure", "ENCRYPTION_KEY_WRONG"],
    ["Authentication failed: invalid-password", "invalid-password", "AUTH_FAILED"],
    ["Authentication failed: invalid or expired session token", "token-expired", "AUTH_FAILED"],
    ["Authentication failed: network-failure", "network-failure", "SERVER_UNREACHABLE"],
    ["Authentication failed: server offline or unreachable", "network-failure", "SERVER_UNREACHABLE"],
    ["Could not get remote files", "network-failure", "SERVER_UNREACHABLE"],
    [
      'Budget "abc" not found. Check the sync id of your budget in the Advanced section of the settings page.',
      "budget-not-found",
      "BUDGET_NOT_FOUND",
    ],
  ])("reads %j (code %s) as %s", (message, code, expected) => {
    expect(classifyActualError(tagged(message, code))).toBe(expected);
    // The same text with no code - an older build, or a path that does not
    // tag its errors - classifies the same way.
    expect(classifyActualError(tagged(message))).toBe(expected);
  });

  it("recognises a network failure underneath a failed fetch", () => {
    const error = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(classifyActualError(error)).toBe("SERVER_UNREACHABLE");
  });

  it("leaves anything else unclassified", () => {
    expect(classifyActualError(new Error("We had an unknown problem opening \"abc\"."))).toBeNull();
    expect(classifyActualError("boom")).toBeNull();
    expect(classifyActualError(null)).toBeNull();
  });
});

describe("toActualRuntimeError", () => {
  it("rewrites a known failure into plain language and attaches the code", () => {
    const error = toActualRuntimeError(tagged("Unable to decrypt file with this password. Please try again."));
    expect(error).toBeInstanceOf(ActualRuntimeError);
    expect(error).toMatchObject({
      code: "ENCRYPTION_KEY_WRONG",
      message: "The budget's encryption password is wrong. Update it on the connection.",
    });
  });

  it("passes anything else through untouched", () => {
    const original = new Error("something else");
    expect(toActualRuntimeError(original)).toBe(original);
  });
});
