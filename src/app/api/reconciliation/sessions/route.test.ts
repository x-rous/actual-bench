jest.mock("next/server", () => {
  // 204 responses are built with `new NextResponse(null, ...)`, so the mock
  // needs the constructor as well as the `json` helper.
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
import type { ReconciliationSessionRecord } from "@/lib/app-db/reconciliationRepository";
import { GET, POST } from "./route";
import { DELETE, GET as GET_ONE, PATCH } from "./[id]/route";
import { PUT as PUT_ROWS } from "./[id]/rows/route";
import { PUT as PUT_ITEMS } from "./[id]/items/route";

function jsonRequest(body: unknown): Request {
  return { json: async () => body } as Request;
}

function urlRequest(url: string): Request {
  return { url } as Request;
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createSession(): Promise<ReconciliationSessionRecord> {
  const response = await POST(
    jsonRequest({
      budgetSyncId: "budget-1",
      accountId: "acct-1",
      accountName: "Global Money Credit Card",
      statementName: "GMCC_JUL_2026.csv",
    })
  );
  const body = (await response.json()) as { session: ReconciliationSessionRecord };
  return body.session;
}

describe("/api/reconciliation/sessions", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-reconciliation-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("creates a session and lists it for its budget", async () => {
    const session = await createSession();
    expect(session.status).toBe("draft");

    const listed = await GET(urlRequest("http://x/api/reconciliation/sessions?budgetSyncId=budget-1"));
    const body = (await listed.json()) as { sessions: ReconciliationSessionRecord[] };
    expect(body.sessions.map((s) => s.id)).toEqual([session.id]);
  });

  it("requires the budget scope when listing", async () => {
    const response = await GET(urlRequest("http://x/api/reconciliation/sessions"));
    expect(response.status).toBe(400);
  });

  it("does not list another budget's sessions", async () => {
    await createSession();
    const listed = await GET(urlRequest("http://x/api/reconciliation/sessions?budgetSyncId=other"));
    const body = (await listed.json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual([]);
  });

  it("rejects a create with no account", async () => {
    const response = await POST(jsonRequest({ budgetSyncId: "budget-1" }));
    expect(response.status).toBe(400);
  });

  it("returns the session with its rows and items in one read", async () => {
    const session = await createSession();

    await PUT_ROWS(
      jsonRequest({
        statementRows: [
          {
            id: "srow-1",
            sourceRowNumber: 2,
            postedDate: "2026-07-01",
            amount: -34285,
            description: "CARREFOUR MARKET",
            fingerprint: "abc12345",
            raw: { Amount: "-342.85" },
          },
        ],
      }),
      context(session.id)
    );

    await PUT_ITEMS(
      jsonRequest({
        items: [{ id: "item-1", statementRowIds: ["srow-1"], disposition: "unresolved" }],
      }),
      context(session.id)
    );

    const response = await GET_ONE(urlRequest("http://x/s"), context(session.id));
    const body = (await response.json()) as {
      session: ReconciliationSessionRecord;
      statementRows: { id: string; amount: number }[];
      items: { id: string }[];
    };

    expect(body.session.id).toBe(session.id);
    expect(body.statementRows).toEqual([expect.objectContaining({ id: "srow-1", amount: -34285 })]);
    expect(body.items).toEqual([expect.objectContaining({ id: "item-1" })]);
  });

  it("supports a shallow read for the session list", async () => {
    const session = await createSession();
    const response = await GET_ONE(urlRequest("http://x/s?shallow=1"), context(session.id));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.session).toBeDefined();
    expect(body.statementRows).toBeUndefined();
  });

  it("404s for an unknown session", async () => {
    const response = await GET_ONE(urlRequest("http://x/s"), context("missing"));
    expect(response.status).toBe(404);
  });

  it("patches only the supplied fields", async () => {
    const session = await createSession();
    const response = await PATCH(
      jsonRequest({ status: "needs_review", statementStart: "2026-07-01" }),
      context(session.id)
    );
    const body = (await response.json()) as { session: ReconciliationSessionRecord };

    expect(body.session.status).toBe("needs_review");
    expect(body.session.statementStart).toBe("2026-07-01");
    expect(body.session.accountName).toBe("Global Money Credit Card");
  });

  it("rejects an unknown status", async () => {
    const session = await createSession();
    const response = await PATCH(jsonRequest({ status: "nonsense" }), context(session.id));
    expect(response.status).toBe(400);
  });

  it("ignores unknown keys rather than persisting them", async () => {
    const session = await createSession();
    const response = await PATCH(
      jsonRequest({ somethingElse: "x", status: "parsed" }),
      context(session.id)
    );
    const body = (await response.json()) as { session: Record<string, unknown> };

    expect(body.session.status).toBe("parsed");
    expect(body.session.somethingElse).toBeUndefined();
  });

  it("replaces statement rows rather than appending on re-import", async () => {
    const session = await createSession();
    const row = {
      id: "srow-1",
      sourceRowNumber: 2,
      postedDate: "2026-07-01",
      amount: -1000,
      description: "A",
      fingerprint: "f1",
      raw: null,
    };

    await PUT_ROWS(jsonRequest({ statementRows: [row, { ...row, id: "srow-2" }] }), context(session.id));
    const second = await PUT_ROWS(jsonRequest({ statementRows: [row] }), context(session.id));
    const body = (await second.json()) as { count: number };

    expect(body.count).toBe(1);

    const read = await GET_ONE(urlRequest("http://x/s"), context(session.id));
    const readBody = (await read.json()) as { statementRows: { id: string }[] };
    expect(readBody.statementRows.map((r) => r.id)).toEqual(["srow-1"]);
  });

  it("rejects statement rows with a non-integer amount", async () => {
    const session = await createSession();
    const response = await PUT_ROWS(
      jsonRequest({
        statementRows: [
          {
            id: "srow-1",
            sourceRowNumber: 1,
            postedDate: "2026-07-01",
            amount: -342.85,
            description: "A",
            fingerprint: "f1",
            raw: null,
          },
        ],
      }),
      context(session.id)
    );

    expect(response.status).toBe(400);
  });

  it("404s when writing rows to an unknown session", async () => {
    const response = await PUT_ROWS(jsonRequest({ statementRows: [] }), context("missing"));
    expect(response.status).toBe(404);
  });

  it("requires an array body when writing rows", async () => {
    const session = await createSession();
    const response = await PUT_ROWS(jsonRequest({}), context(session.id));
    expect(response.status).toBe(400);
  });

  it("deletes a session and cascades its rows", async () => {
    const session = await createSession();
    await PUT_ROWS(
      jsonRequest({
        statementRows: [
          {
            id: "srow-1",
            sourceRowNumber: 1,
            postedDate: "2026-07-01",
            amount: -1000,
            description: "A",
            fingerprint: "f1",
            raw: null,
          },
        ],
      }),
      context(session.id)
    );

    const deleted = await DELETE(urlRequest("http://x/s"), context(session.id));
    expect(deleted.status).toBe(204);

    const read = await GET_ONE(urlRequest("http://x/s"), context(session.id));
    expect(read.status).toBe(404);
  });

  it("404s when deleting an unknown session", async () => {
    const response = await DELETE(urlRequest("http://x/s"), context("missing"));
    expect(response.status).toBe(404);
  });
});
