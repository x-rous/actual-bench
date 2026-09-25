import {
  recordUnlockFailure,
  recordUnlockSuccess,
  resetUnlockThrottle,
  throttleClientKey,
  unlockRetryAfterMs,
} from "./throttle";

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

describe("sign-in throttle (RD-096)", () => {
  afterEach(() => resetUnlockThrottle());

  it("locks a client out after five failures, and only that client", () => {
    for (let i = 0; i < 4; i++) recordUnlockFailure("203.0.113.9");
    expect(unlockRetryAfterMs("203.0.113.9")).toBe(0);

    recordUnlockFailure("203.0.113.9");
    expect(unlockRetryAfterMs("203.0.113.9")).toBeGreaterThan(0);
    // The owner, elsewhere, can still sign in.
    expect(unlockRetryAfterMs("198.51.100.4")).toBe(0);
  });

  it("starts a client over after a correct password", () => {
    for (let i = 0; i < 5; i++) recordUnlockFailure("203.0.113.9");
    recordUnlockSuccess("203.0.113.9");
    expect(unlockRetryAfterMs("203.0.113.9")).toBe(0);
  });

  it("holds everyone back when failures come from many addresses", () => {
    for (let i = 0; i < 50; i++) recordUnlockFailure(`203.0.113.${i}`);
    expect(unlockRetryAfterMs("198.51.100.4")).toBeGreaterThan(0);
  });

  it("identifies a client by the address the nearest proxy added", () => {
    expect(throttleClientKey(headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(throttleClientKey(headers({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(throttleClientKey(headers({}))).toBe("direct");
  });
});
