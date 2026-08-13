jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    private body: unknown;

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }

    async json() {
      return this.body;
    }
  }

  return { NextResponse: MockNextResponse };
});

import { GET } from "./route";

const DEMO_ENV_KEYS = [
  "DEMO_MODE",
  "DEMO_BASE_URL",
  "DEMO_API_KEY",
  "DEMO_BUDGET_SYNC_ID",
  "DEMO_TRACKING_BUDGET_SYNC_ID",
] as const;

describe("/api/demo", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "1";
    process.env.DEMO_BASE_URL = "https://demo.example.com";
    process.env.DEMO_API_KEY = "public-demo-key";
    process.env.DEMO_BUDGET_SYNC_ID = "envelope-sync-id";
    process.env.DEMO_TRACKING_BUDGET_SYNC_ID = "tracking-sync-id";
  });

  afterEach(() => {
    for (const key of DEMO_ENV_KEYS) delete process.env[key];
  });

  it("returns both named demo budgets with Envelope first", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      baseUrl: "https://demo.example.com",
      apiKey: "public-demo-key",
      budgets: [
        { label: "Live Demo", budgetSyncId: "envelope-sync-id" },
        {
          label: "Live Demo - Tracking Mode",
          budgetSyncId: "tracking-sync-id",
        },
      ],
    });
  });

  it.each([
    "DEMO_MODE",
    "DEMO_BASE_URL",
    "DEMO_API_KEY",
    "DEMO_BUDGET_SYNC_ID",
    "DEMO_TRACKING_BUDGET_SYNC_ID",
  ] as const)("stays disabled without %s", (missingKey) => {
    delete process.env[missingKey];
    expect(GET().status).toBe(404);
  });

  it("rejects duplicate budget Sync IDs", () => {
    process.env.DEMO_TRACKING_BUDGET_SYNC_ID = "envelope-sync-id";
    expect(GET().status).toBe(404);
  });
});
