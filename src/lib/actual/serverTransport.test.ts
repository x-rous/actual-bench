import { connectionFromEnrolment, openServerTransport } from "./serverTransport";
import type { SyncCredentialMeta } from "@/lib/app-db/types";

const meta = (mode: string): SyncCredentialMeta => ({
  connectionFingerprint: "fp-1",
  mode,
  baseUrl: "https://actual.example.com",
  budgetSyncId: "budget-1",
  label: "",
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
});

describe("connections on the server", () => {
  it("rebuilds an HTTP API connection from its enrolment", () => {
    expect(connectionFromEnrolment(meta("http-api"), { apiKey: "key", encryptionPassword: "enc" })).toEqual({
      id: "fp-1",
      label: "https://actual.example.com",
      mode: "http-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-1",
      apiKey: "key",
      encryptionPassword: "enc",
    });
  });

  it("rebuilds a Direct connection from its enrolment", () => {
    expect(connectionFromEnrolment(meta("browser-api"), { serverPassword: "pw" })).toEqual({
      id: "fp-1",
      label: "https://actual.example.com",
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-1",
      serverPassword: "pw",
    });
  });

  it("refuses secrets that do not fit the mode", () => {
    expect(() => connectionFromEnrolment(meta("browser-api"), { apiKey: "key" })).toThrow(/does not match/);
    expect(() => connectionFromEnrolment(meta("http-api"), { serverPassword: "pw" })).toThrow(/does not match/);
  });

  it("gives each mode its transport, and the Direct one is still the Direct transport", () => {
    const http = openServerTransport(connectionFromEnrolment(meta("http-api"), { apiKey: "key" }));
    const direct = openServerTransport(connectionFromEnrolment(meta("browser-api"), { serverPassword: "pw" }));
    expect(http.mode).toBe("http-api");
    expect(direct.mode).toBe("browser-api");
    expect(typeof direct.exportBudget).toBe("function");
    expect(typeof http.exportBudget).toBe("function");
  });
});
