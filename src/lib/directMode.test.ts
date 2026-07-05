import {
  DIRECT_MODE_HEADERS,
  isDirectBrowserApiDisabled,
  isDirectBrowserApiEnabled,
} from "./directMode";

describe("direct mode config", () => {
  it("treats 0, false, and off as disabled values", () => {
    expect(isDirectBrowserApiDisabled("0")).toBe(true);
    expect(isDirectBrowserApiDisabled(" false ")).toBe(true);
    expect(isDirectBrowserApiDisabled("OFF")).toBe(true);
    expect(isDirectBrowserApiDisabled("1")).toBe(false);
    expect(isDirectBrowserApiDisabled(undefined)).toBe(false);
  });

  it("enables Direct mode by default and honors either disable env", () => {
    expect(isDirectBrowserApiEnabled({})).toBe(true);
    expect(isDirectBrowserApiEnabled({ DIRECT_BROWSER_API: "0" })).toBe(false);
    expect(isDirectBrowserApiEnabled({ NEXT_PUBLIC_DIRECT_BROWSER_API: "off" })).toBe(false);
  });

  it("defines the isolation headers required by the browser API", () => {
    expect(DIRECT_MODE_HEADERS).toEqual({
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
  });
});
