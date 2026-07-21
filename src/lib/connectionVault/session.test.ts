import { randomBytes } from "node:crypto";
import {
  clearAllSessions,
  clearSession,
  createSession,
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
    const token = createSession(randomBytes(32), 0);
    expect(getSessionKey(token)).toBeNull();
  });

  it("slides the idle window on access and expires only when idle", () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const token = createSession(randomBytes(32), 1000); // expires at now+1000
    now += 800;
    expect(getSessionKey(token)).not.toBeNull(); // alive → refresh to now+1000
    now += 800; // 800 < 1000 since the refresh → still alive
    expect(getSessionKey(token)).not.toBeNull();
    now += 1001; // idle beyond the TTL
    expect(getSessionKey(token)).toBeNull();
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
