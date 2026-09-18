import { isVaultUnlockDuration } from "./unlockDuration";

describe("vault unlock durations", () => {
  it("accepts supported duration keys only", () => {
    expect(isVaultUnlockDuration("8h")).toBe(true);
    expect(isVaultUnlockDuration("30d")).toBe(true);
    expect(isVaultUnlockDuration("toString")).toBe(false);
    expect(isVaultUnlockDuration("forever")).toBe(false);
  });
});
