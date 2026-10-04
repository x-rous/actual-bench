/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { debtConfig, directory, saveInput } from "@/lib/assets-debt/testing/debtFixtures";
import { POST as createDebt } from "../debts/route";
import { POST as preview } from "../debts/[id]/preview/route";
import { GET as listPostings } from "../debts/[id]/postings/route";
import { POST as apply } from "./[id]/apply/route";
import { POST as outcome } from "./[id]/outcome/route";
import { POST as decline } from "./[id]/decline/route";
import { POST as reverse } from "./[id]/reverse/route";
import { POST as reproduce } from "./[id]/reproduce/route";

/** T136: the posting routes. Only `apply` can lead to an Actual write, and only with the user's recorded decision. */

const saved = process.env.ACTUAL_BENCH_DB_PATH;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "actual-bench-posting-routes-"));
  process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
});
afterEach(() => {
  resetAppDbForTests();
  rmSync(root, { recursive: true, force: true });
  if (saved === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
  else process.env.ACTUAL_BENCH_DB_PATH = saved;
});

const json = (body: unknown) => new Request("http://bench/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function setup(to = "2024-02-29") {
  const base = debtConfig();
  const config = { ...base, profile: { ...(base.profile as Record<string, unknown>), accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 28 } };
  const created = await createDebt(json({ debt: saveInput({ executionStrategy: "bench-daily", config }), accountDirectory: directory() }));
  const debtId = ((await created.json()) as { debt: { debt: { id: string } } }).debt.debt.id;
  const body = {
    from: "2024-02-01", to, snapshots: [], accountDirectory: directory(), transferPayees: { "acc-mortgage": "tp-mortgage" },
    capabilities: { canRestructure: true, canVerifyTransferLinks: true },
  };
  const response = await preview(json(body), ctx(debtId));
  expect(response.status).toBe(200);
  const result = (await response.json()) as { postings: Array<{ id: string; postingKind: string; classification: string; status: string; output: { kind: string } }> };
  return { debtId, postings: result.postings };
}

describe("posting routes", () => {
  it("preview records proposals and writes nothing else; apply records the decision and returns an applying ticket", async () => {
    const { debtId, postings } = await setup();
    const charge = postings.find((p) => p.postingKind === "interest-charge")!;
    expect(charge).toMatchObject({ classification: "safe", status: "proposed" });
    const response = await apply(json({ fresh: [] }), ctx(charge.id));
    expect(response.status).toBe(200);
    const { ticket } = (await response.json()) as { ticket: { posting: { status: string; decidedAt: string | null }; mode: string } };
    expect(ticket).toMatchObject({ mode: "apply", posting: { status: "applying", decidedAt: expect.any(String) } });
    const recorded = await outcome(json({ status: "applied", actualIds: ["txn-1"], appliedAt: "2024-06-02T00:00:00.000Z" }), ctx(charge.id));
    expect(((await recorded.json()) as { posting: { status: string } }).posting.status).toBe("applied");
    const listed = (await (await listPostings(new Request("http://bench"), ctx(debtId))).json()) as { postings: Array<{ id: string; status: string }> };
    expect(listed.postings.find((p) => p.id === charge.id)?.status).toBe("applied");
  });

  it("apply refuses a posting that is not proposed, and outcome cannot start a write", async () => {
    const { postings } = await setup();
    const charge = postings.find((p) => p.postingKind === "interest-charge")!;
    const early = await outcome(json({ status: "applied", actualIds: ["x"], appliedAt: "t" }), ctx(charge.id));
    expect(early.status).toBe(400);
    await apply(json({ fresh: [] }), ctx(charge.id));
    const twice = await apply(json({ fresh: [] }), ctx(charge.id));
    expect(twice.status).toBe(400);
  });

  it("decline records Not now; reverse creates only a reversal proposal; reproduce runs without Actual", async () => {
    const { postings } = await setup("2024-03-31");
    const [first, second] = postings.filter((p) => p.postingKind === "interest-charge");
    const declined = await decline(new Request("http://bench", { method: "POST" }), ctx(second.id));
    expect(((await declined.json()) as { posting: { status: string; decidedAt: string } }).posting).toMatchObject({ status: "declined", decidedAt: expect.any(String) });
    await apply(json({ fresh: [] }), ctx(first.id));
    await outcome(json({ status: "applied", actualIds: ["txn-1"], appliedAt: "2024-06-02T00:00:00.000Z" }), ctx(first.id));
    const reversed = await reverse(json({ accountDirectory: directory(), transferPayees: {} }), ctx(first.id));
    const reversal = ((await reversed.json()) as { posting: { status: string; classification: string; reversalOf: string } }).posting;
    expect(reversal).toMatchObject({ status: "proposed", classification: "review", reversalOf: first.id });
    const reproduced = await reproduce(new Request("http://bench", { method: "POST" }), ctx(first.id));
    expect(((await reproduced.json()) as { reproduction: { status: string } }).reproduction.status).toBe("exact-match");
  });

  it("a missing posting is 404; complete-link refuses anything but an approved, interrupted link", async () => {
    const { postings } = await setup();
    expect((await reproduce(new Request("http://bench", { method: "POST" }), ctx("nope"))).status).toBe(404);
    const charge = postings.find((p) => p.postingKind === "interest-charge")!;
    const response = await apply(json({ action: "complete-link" }), ctx(charge.id));
    expect(response.status).toBe(409);
  });
});
