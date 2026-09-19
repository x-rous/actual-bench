jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    constructor(_body: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, json: async () => body };
    }
  }
  return { NextResponse: MockNextResponse };
});

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { DEFAULT_PDF_PARSER_GUIDANCE } from "@/lib/reconciliation/statement/pdf/model";
import type { PdfDetectionProfileCatalog } from "@/lib/app-db/pdfDetectionProfileRepository";
import { DELETE, GET, PATCH, POST } from "./route";

function request(body: unknown): Request {
  return { json: async () => body } as Request;
}

const PROFILE = {
  kind: "pdf-layout-v2",
  profile: {
    id: "layout-1",
    name: "Credit card",
    parserVersion: 2,
    profileVersion: 1,
    fingerprint: "privacy-safe-shape",
    guidance: DEFAULT_PDF_PARSER_GUIDANCE,
    createdAt: "2026-09-19T00:00:00.000Z",
    supersedesProfileId: null,
    sourcePage: { width: 600, height: 800 },
  },
};

describe("/api/reconciliation/pdf-detection-profiles", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-pdf-profile-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("saves a global bank profile and returns the account association", async () => {
    const saved = await POST(request({
      budgetSyncId: "budget-1",
      accountId: "card",
      bankName: "HSBC Bank",
      profileName: "Credit card",
      profile: PROFILE,
      assignToAccount: true,
    }));
    expect(saved.status).toBe(201);

    const response = GET({
      url: "http://x/api/reconciliation/pdf-detection-profiles?budgetSyncId=budget-1&accountId=card",
    } as Request);
    const catalog = (await response.json()) as PdfDetectionProfileCatalog;
    expect(catalog.banks[0]).toEqual(expect.objectContaining({ name: "HSBC Bank" }));
    expect(catalog.profiles[0]).toEqual(expect.objectContaining({ name: "Credit card" }));
    expect(catalog.accountProfileId).toBe(catalog.profiles[0]?.id);
  });

  it("rejects arbitrary JSON instead of persisting it as parser guidance", async () => {
    const response = await POST(request({
      budgetSyncId: "budget-1",
      accountId: "card",
      bankName: "HSBC Bank",
      profileName: "Bad",
      profile: { statementText: "sensitive" },
    }));
    expect(response.status).toBe(400);
  });

  it("changes and removes an account assignment through explicit actions", async () => {
    await POST(request({
      budgetSyncId: "budget-1",
      accountId: "card",
      bankName: "HSBC Bank",
      profileName: "Credit card",
      profile: PROFILE,
    }));
    const unassignedResponse = GET({
      url: "http://x/api/reconciliation/pdf-detection-profiles?budgetSyncId=budget-1&accountId=card",
    } as Request);
    const unassigned = (await unassignedResponse.json()) as PdfDetectionProfileCatalog;
    expect(unassigned.accountProfileId).toBeNull();

    expect((await PATCH(request({
      action: "associate-profile",
      budgetSyncId: "budget-1",
      accountId: "card",
      profileId: unassigned.profiles[0]?.id,
    }))).status).toBe(204);
    const assignedResponse = GET({
      url: "http://x/api/reconciliation/pdf-detection-profiles?budgetSyncId=budget-1&accountId=card",
    } as Request);
    expect((await assignedResponse.json()) as PdfDetectionProfileCatalog).toEqual(expect.objectContaining({
      accountProfileId: unassigned.profiles[0]?.id,
    }));

    expect((await PATCH(request({
      action: "remove-account-association",
      budgetSyncId: "budget-1",
      accountId: "card",
    }))).status).toBe(204);
    const removedResponse = GET({
      url: "http://x/api/reconciliation/pdf-detection-profiles?budgetSyncId=budget-1&accountId=card",
    } as Request);
    expect((await removedResponse.json()) as PdfDetectionProfileCatalog).toEqual(expect.objectContaining({
      accountProfileId: null,
    }));

    expect((await DELETE({
      url: `http://x/api/reconciliation/pdf-detection-profiles?profileId=${unassigned.profiles[0]?.id}`,
    } as Request)).status).toBe(204);
  });

  it("requires an account scope when listing", () => {
    const response = GET({
      url: "http://x/api/reconciliation/pdf-detection-profiles?budgetSyncId=budget-1",
    } as Request);
    expect(response.status).toBe(400);
  });

  it("rejects unknown patch actions", async () => {
    const response = await PATCH(request({ action: "delete-everything" }));
    expect(response.status).toBe(400);
  });
});
