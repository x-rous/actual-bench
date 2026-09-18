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

  it("reports a failed browser-storage write", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    expect(saveVaultUnlockDuration("30d")).toBe(false);
  });
});
