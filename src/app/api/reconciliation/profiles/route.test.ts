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
import type {
  ReconciliationItemRecord,
  ReconciliationProfileRecord,
  ReconciliationSessionRecord,
} from "@/lib/app-db/reconciliationRepository";
import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";
import { POST as CREATE_SESSION } from "../sessions/route";
import { PUT as PUT_ITEMS } from "../sessions/[id]/items/route";
import { PATCH as PATCH_ITEM } from "../items/[id]/route";

function jsonRequest(body: unknown): Request {
  return { json: async () => body } as Request;
}

function urlRequest(url: string): Request {
  return { url } as Request;
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

const PROFILE = {
  budgetSyncId: "budget-1",
  accountId: "acct-1",
  name: "Global Money Credit Card Statement",
  mapping: { date: 0, description: 1, amount: 2, dateFormat: "dmy" },
  matchConfig: {
    dateToleranceDays: 7,
    text: { combine: "priority-first", targets: [{ field: "notes", mode: "containment" }] },
  },
};

describe("/api/reconciliation/profiles", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-reconciliation-profile-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("saves a profile carrying the mapping and the match configuration", async () => {
    const response = await POST(jsonRequest(PROFILE));
    const body = (await response.json()) as { profile: ReconciliationProfileRecord };

    expect(response.status).toBe(201);
    // The text-target selection is part of the profile: it describes how this
    // account's transactions are created, not a global preference.
    expect(body.profile.matchConfig).toEqual(PROFILE.matchConfig);
  });

  it("lists profiles for an account", async () => {
    await POST(jsonRequest(PROFILE));
    await POST(jsonRequest({ ...PROFILE, accountId: "acct-2", name: "Other" }));

    const response = await GET(
      urlRequest("http://x/api/reconciliation/profiles?budgetSyncId=budget-1&accountId=acct-1")
    );
    const body = (await response.json()) as { profiles: ReconciliationProfileRecord[] };
    expect(body.profiles).toHaveLength(1);
  });

  it("requires the budget scope when listing", async () => {
    const response = await GET(urlRequest("http://x/api/reconciliation/profiles"));
    expect(response.status).toBe(400);
  });

  it("upserts on re-save instead of failing the unique constraint", async () => {
    const first = (await (await POST(jsonRequest(PROFILE))).json()) as {
      profile: ReconciliationProfileRecord;
    };
    const second = (await (
      await POST(jsonRequest({ ...PROFILE, mapping: { date: 1 } }))
    ).json()) as { profile: ReconciliationProfileRecord };

    expect(second.profile.id).toBe(first.profile.id);
    expect(second.profile.mapping).toEqual({ date: 1 });
  });

  it("rejects a profile with no name", async () => {
    const response = await POST(jsonRequest({ ...PROFILE, name: "" }));
    expect(response.status).toBe(400);
  });

  it("deletes a profile", async () => {
    const created = (await (await POST(jsonRequest(PROFILE))).json()) as {
      profile: ReconciliationProfileRecord;
    };
    const response = await DELETE(urlRequest("http://x/p"), context(created.profile.id));
    expect(response.status).toBe(204);
  });

  it("404s when deleting an unknown profile", async () => {
    const response = await DELETE(urlRequest("http://x/p"), context("missing"));
    expect(response.status).toBe(404);
  });
});

describe("/api/reconciliation/items/[id]", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-reconciliation-item-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  async function seedItem(): Promise<string> {
    const created = (await (
      await CREATE_SESSION(jsonRequest({ budgetSyncId: "budget-1", accountId: "acct-1" }))
    ).json()) as { session: ReconciliationSessionRecord };

    await PUT_ITEMS(
      jsonRequest({
        items: [
          { id: "item-1", actualTransactionIds: ["t1"], disposition: "unresolved" },
          { id: "item-2", actualTransactionIds: ["t2"], disposition: "unresolved" },
        ],
      }),
      context(created.session.id)
    );
    return created.session.id;
  }

  it("patches a single item without disturbing its siblings", async () => {
    await seedItem();

    const response = await PATCH_ITEM(
      jsonRequest({ disposition: "delete", reasonCode: "erroneous-automation" }),
      context("item-1")
    );
    const body = (await response.json()) as { item: ReconciliationItemRecord };

    expect(body.item.disposition).toBe("delete");
    expect(body.item.reasonCode).toBe("erroneous-automation");
  });

  it("stores staged changes with their provenance", async () => {
    await seedItem();

    const response = await PATCH_ITEM(
      jsonRequest({
        stagedChanges: {
          notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" },
        },
      }),
      context("item-1")
    );
    const body = (await response.json()) as { item: ReconciliationItemRecord };

    expect(body.item.stagedChanges).toEqual({
      notes: { original: "Imported #One", staged: "Imported #Two", source: "transform" },
    });
  });

  it("accepts a manual match as an id array", async () => {
    await seedItem();

    const response = await PATCH_ITEM(
      jsonRequest({
        actualTransactionIds: ["t9"],
        disposition: "matched",
        match: { type: "manual", evidenceSource: "manual" },
      }),
      context("item-1")
    );
    const body = (await response.json()) as { item: ReconciliationItemRecord };

    expect(body.item.actualTransactionIds).toEqual(["t9"]);
    expect(body.item.match).toEqual({ type: "manual", evidenceSource: "manual" });
  });

  it("404s for an unknown item", async () => {
    const response = await PATCH_ITEM(jsonRequest({ disposition: "keep" }), context("missing"));
    expect(response.status).toBe(404);
  });
});
