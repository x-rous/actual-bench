import { describeSyncError } from "./syncKind";

describe("describeSyncError", () => {
  it("uses a real Error's message", () => {
    expect(describeSyncError(new Error("boom"), "fallback")).toBe("boom");
  });

  it("uses a structured ApiError's message even though it isn't an Error instance", () => {
    // src/lib/api/client.ts's apiRequest throws exactly this shape for every
    // HTTP failure - a plain object, never a real Error - so this is the
    // realistic case a naive `err instanceof Error` check misses entirely.
    const apiError = { kind: "api" as const, status: 404, message: "HTTP 404: account not found" };
    expect(describeSyncError(apiError, "fallback")).toBe("HTTP 404: account not found");
  });

  it("falls back for a thrown value with no usable message", () => {
    expect(describeSyncError("just a string", "fallback")).toBe("fallback");
    expect(describeSyncError(null, "fallback")).toBe("fallback");
    expect(describeSyncError({ message: 42 }, "fallback")).toBe("fallback");
    expect(describeSyncError(new Error(""), "fallback")).toBe("fallback");
  });
});
