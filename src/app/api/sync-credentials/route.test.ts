import { POST } from "./route";

describe("POST /api/sync-credentials", () => {
  const original = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-operator-key";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = original;
  });

  // The store accepts a Direct secret (RD-095 M3); enrolling one waits for the
  // enrolment flow that verifies it in a worker first.
  it.each([
    { serverPassword: "pw" },
    { apiKey: "key", serverPassword: "pw" },
  ])("still refuses to enrol a Direct connection (%j)", async (secret) => {
    const response = await POST(
      new Request("http://bench.test/api/sync-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionFingerprint: "fp-1",
          mode: "browser-api",
          baseUrl: "https://actual.example.com",
          budgetSyncId: "budget-1",
          secret,
        }),
      })
    );
    expect(response.status).toBe(400);
  });
});
