import { randomBytes } from "node:crypto";
import {
  clearAllSessions,
  clearSession,
  createSession,
  getSessionDuration,
  getSessionKey,
  hasSession,
} from "./session";

describe("connection vault session cache (RD-061 / PR-026b)", () => {
  afterEach(() => {
    clearAllSessions();
    jest.restoreAllMocks();
  });

  it("stores a key and returns it by token", () => {
    const key = randomBytes(32);
    const token = createSession(key);
    expect(getSessionKey(token)?.equals(key)).toBe(true);
    expect(hasSession(token)).toBe(true);
  });

  it("returns null for unknown, undefined, or null tokens", () => {
    expect(getSessionKey("nope")).toBeNull();
    expect(getSessionKey(undefined)).toBeNull();
    expect(hasSession(null)).toBe(false);
  });

  it("expires an entry once past its TTL", () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const token = createSession(randomBytes(32));
    now += 8 * 60 * 60 * 1000;
    expect(getSessionKey(token)).toBeNull();
  });

  it("slides the idle window on access and expires only when idle", () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const token = createSession(randomBytes(32));
    const ttl = 8 * 60 * 60 * 1000;
    now += ttl - 1;
    expect(getSessionKey(token)).not.toBeNull(); // alive → refresh to now+1000
    now += ttl - 1;
    expect(getSessionKey(token)).not.toBeNull();
    now += ttl + 1;
    expect(getSessionKey(token)).toBeNull();
  });

  it("keeps the selected duration with the session", () => {
    const token = createSession(randomBytes(32), "30d");
    expect(getSessionDuration(token)).toBe("30d");
  });

  it("clears a single session and all sessions", () => {
    const a = createSession(randomBytes(32));
    const b = createSession(randomBytes(32));
    clearSession(a);
    expect(hasSession(a)).toBe(false);
    expect(hasSession(b)).toBe(true);
    clearAllSessions();
    expect(hasSession(b)).toBe(false);
  });

  it("never exposes the key except via getSessionKey", () => {
    const token = createSession(randomBytes(32));
    // hasSession must not leak the key material
    expect(typeof hasSession(token)).toBe("boolean");
  });
});
