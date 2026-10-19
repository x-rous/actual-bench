/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { EMPTY_CHANGES } from "@/lib/credit-cards/changes";
import { cardSchema, NEW_CARD_DEFAULTS, type Workspace } from "@/lib/credit-cards/schema";
import { GET, POST } from "./route";

const saved = process.env.ACTUAL_BENCH_DB_PATH;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "actual-bench-credit-card-routes-"));
  process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
});
afterEach(() => {
  resetAppDbForTests();
  rmSync(root, { recursive: true, force: true });
  if (saved === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
  else process.env.ACTUAL_BENCH_DB_PATH = saved;
});

const card = (revision = 1, extra = {}) => cardSchema.parse({
  ...NEW_CARD_DEFAULTS, budgetSyncId: "budget", accountId: "account", bankTimeZone: "UTC", id: "card", revision, ...extra,
});
const post = (body: unknown) => POST(new Request("http://bench/api/credit-cards", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" },
}));
const putCard = (value: ReturnType<typeof card>) => post({ budgetSyncId: "budget", changes: { ...EMPTY_CHANGES, cards: { put: [value], remove: [] } } });

describe("/api/credit-cards", () => {
  it("returns an empty workspace, then what a change set committed", async () => {
    const empty = await GET(new Request("http://bench/api/credit-cards?budgetSyncId=budget"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ workspace: expect.objectContaining({ cards: [], statements: [] }), unsupported: 0 });

    const created = await putCard(card());
    expect(created.status).toBe(200);
    const { workspace } = (await created.json()) as { workspace: Workspace };
    expect(workspace.cards).toEqual([card()]);
    const read = (await (await GET(new Request("http://bench/api/credit-cards?budgetSyncId=budget"))).json()) as { workspace: Workspace };
    expect(read.workspace).toEqual(workspace);
    const other = (await (await GET(new Request("http://bench/api/credit-cards?budgetSyncId=other"))).json()) as { workspace: Workspace };
    expect(other.workspace.cards).toEqual([]);
  });

  it("answers 409 for a stale revision and 400 for invalid input", async () => {
    await putCard(card());
    const stale = await putCard(card(5, { creditLimitMinor: 1 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "APP_DB_CONFLICT" });
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ budgetSyncId: "budget" })).status).toBe(400);
    expect((await putCard({ ...card(2), creditLimitMinor: -1 })).status).toBe(400);
    expect((await GET(new Request("http://bench/api/credit-cards"))).status).toBe(400);
  });

  it("answers 503 when the app database is unavailable", async () => {
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "missing", "metadata.sqlite");
    expect((await GET(new Request("http://bench/api/credit-cards?budgetSyncId=budget"))).status).toBe(503);
    expect((await putCard(card())).status).toBe(503);
  });
});
