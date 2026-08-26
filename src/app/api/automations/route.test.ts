jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { GET, POST } from "./route";
import type { AutomationDefinition } from "@/lib/app-db/types";

function request(body: unknown): Request {
  return { json: async () => body } as Request;
}

const validBody = {
  type: "budget-file-sync",
  name: "Nightly sync",
  scheduleKind: "interval",
  intervalMinutes: 30,
  targetRef: { version: 1, data: { flowId: "flow-1" } },
  config: { version: 1, data: { flowId: "flow-1" } },
};

describe("/api/automations", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-automations-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("creates an automation of a registered type", async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(201);

    const body = (await response.json()) as { automation: AutomationDefinition };
    expect(body.automation.type).toBe("budget-file-sync");

    const list = (await GET().json()) as { automations: unknown[]; jobTypes: { type: string }[] };
    expect(list.automations).toHaveLength(1);
    expect(list.jobTypes.map((jobType) => jobType.type)).toContain("budget-file-sync");
  });

  it("refuses a type nothing can run, instead of accepting it and pausing later", async () => {
    const response = await POST(request({ ...validBody, type: "not-a-real-type" }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    // The message names what *is* available, so the caller can correct it.
    expect(body.error).toMatch(/No automation of type "not-a-real-type"/);
    expect(body.error).toMatch(/budget-file-sync/);

    const list = (await GET().json()) as { automations: unknown[] };
    expect(list.automations).toHaveLength(0);
  });

  it("answers 400, not 500, for a null body", async () => {
    // `null` is valid JSON, so the handler must not read properties off it.
    const response = await POST(request(null));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/must be an object/);
  });
});
