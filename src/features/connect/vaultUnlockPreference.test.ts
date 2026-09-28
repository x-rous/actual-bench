/** @jest-environment jsdom */

import {
  readVaultUnlockDuration,
  saveVaultUnlockDuration,
} from "./vaultUnlockPreference";

describe("vault unlock duration preference", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  it("falls back safely when reading browser storage fails", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    expect(readVaultUnlockDuration()).toBe("8h");
  });

  it("maps choices saved before the checkbox onto it", () => {
    for (const [saved, read] of [["30d", "30d"], ["7d", "30d"], ["24h", "8h"], ["8h", "8h"], ["forever", "8h"]]) {
      window.localStorage.setItem("vault-unlock-duration", saved);
      expect(readVaultUnlockDuration()).toBe(read);
    }
  });

  it("reports a failed browser-storage write", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    expect(saveVaultUnlockDuration("30d")).toBe(false);
  });
});
