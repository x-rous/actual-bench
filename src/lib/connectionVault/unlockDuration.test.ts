import { isVaultUnlockDuration, keepsSignedIn } from "./unlockDuration";

describe("vault unlock durations", () => {
  it("accepts supported duration keys only", () => {
    expect(isVaultUnlockDuration("8h")).toBe(true);
    expect(isVaultUnlockDuration("30d")).toBe(true);
    expect(isVaultUnlockDuration("toString")).toBe(false);
    expect(isVaultUnlockDuration("forever")).toBe(false);
  });

  it("keeps you signed in across browser restarts for the day-long choices only", () => {
    expect(keepsSignedIn("30d")).toBe(true);
    expect(keepsSignedIn("7d")).toBe(true);
    expect(keepsSignedIn("24h")).toBe(false);
    expect(keepsSignedIn("8h")).toBe(false);
  });
});
