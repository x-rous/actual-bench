import { parseApiError } from "./utils";

describe("parseApiError", () => {
  it("shows the vault's own answer as it is, not as a server that could not be reached", () => {
    const error = Object.assign(new Error("Incorrect passphrase."), { fromVault: true });
    expect(parseApiError(error)).toBe("Incorrect passphrase.");
  });

  it("still explains a server that could not be reached", () => {
    expect(parseApiError(new Error("fetch failed"))).toBe("Cannot reach the server. Check the URL and that it is running.");
  });

  it("still reads a 401 from a server as a wrong API key", () => {
    expect(parseApiError(Object.assign(new Error("nope"), { status: 401 }))).toBe("Invalid API Key.");
  });
});
