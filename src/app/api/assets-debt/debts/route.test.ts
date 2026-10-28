/**
 * @jest-environment node
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { directory, saveInput } from "@/lib/assets-debt/testing/debtFixtures";
import { DELETE, GET as getOne, PATCH } from "./[id]/route";
import { PUT as putAssumptions } from "./[id]/assumptions/route";
import { GET as getTracking } from "./[id]/tracking/route";
import { PATCH as patchLedger } from "./[id]/tracking/ledger/route";
import { PUT as putRule } from "./[id]/tracking/rules/route";
import { POST as startWrite } from "./[id]/tracking/writes/route";
import { PATCH as finishWrite } from "./[id]/tracking/writes/[writeId]/route";
import { GET as getObservations, POST as postObservation } from "./[id]/observations/route";
import { GET as getAnchors, POST as postAnchor } from "./[id]/anchors/route";
import { POST as diagnose } from "./[id]/diagnostics/conventions/route";
import { GET, POST } from "./route";

const saved = process.env.ACTUAL_BENCH_DB_PATH;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "actual-bench-debt-routes-"));
  process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
});
afterEach(() => {
  resetAppDbForTests();
  rmSync(root, { recursive: true, force: true });
  if (saved === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
  else process.env.ACTUAL_BENCH_DB_PATH = saved;
});

const json = (body: unknown, method = "POST") => new Request("http://bench/api", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function create(patch = {}) {
  const response = await POST(json({ debt: saveInput(patch), accountDirectory: directory() }));
  expect(response.status).toBe(201);
  return ((await response.json()) as { debt: { debt: { id: string; currentRevision: number } } }).debt.debt;
}

describe("/api/assets-debt/debts", () => {
  it("creates, lists, reads, edits and archives a debt", async () => {
    const debt = await create();
    const list = (await (await GET(new Request("http://bench/api?budgetSyncId=budget-1"))).json()) as { debts: { id: string; blocked: unknown }[] };
    expect(list.debts).toEqual([expect.objectContaining({ id: debt.id, blocked: null })]);

    const read = await getOne(new Request("http://bench/api"), ctx(debt.id));
    expect(((await read.json()) as { debt: { rates: unknown[] } }).debt.rates).toHaveLength(1);

    const edited = await PATCH(json({ debt: saveInput({ name: "Renamed" }), accountDirectory: directory() }, "PATCH"), ctx(debt.id));
    expect(((await edited.json()) as { debt: { debt: { name: string; currentRevision: number } } }).debt.debt).toMatchObject({ name: "Renamed", currentRevision: 1 });

    const archived = await DELETE(new Request("http://bench/api", { method: "DELETE" }), ctx(debt.id));
    expect(((await archived.json()) as { debt: { debt: { status: string } } }).debt.debt.status).toBe("archived");
    expect(((await (await GET(new Request("http://bench/api?budgetSyncId=budget-1"))).json()) as { debts: unknown[] }).debts).toHaveLength(0);
  });

  it("discards a draft instead of archiving it", async () => {
    const draft = await create({ status: "draft", liabilityAccountId: null, loanPaymentCategoryId: null });
    expect((await DELETE(new Request("http://bench/api", { method: "DELETE" }), ctx(draft.id))).status).toBe(204);
    expect((await getOne(new Request("http://bench/api"), ctx(draft.id))).status).toBe(404);
  });

  it("returns validation issues field by field, and refuses numbers for decimals", async () => {
    const bad = await POST(json({ debt: saveInput({ offsets: [{ actualAccountId: "acc-elsewhere", effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 10000, balanceBasis: "total", capMinor: null }] }), accountDirectory: directory() }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "DEBT_CONFIG_INVALID", issues: [expect.objectContaining({ field: "offsets.0.actualAccountId" })] });

    const numeric = saveInput();
    (numeric.rates[0] as unknown as Record<string, unknown>).annualRateDecimal = 0.0612;
    const refused = await POST(json({ debt: numeric, accountDirectory: directory() }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ issues: [expect.objectContaining({ field: "debt.rates.0.annualRateDecimal" })] });
    expect((await GET(new Request("http://bench/api"))).status).toBe(400);
  });

  it("saves baseline assumptions with a new revision", async () => {
    const debt = await create();
    const applied = await putAssumptions(
      json({ assumptions: [{ kind: "extra-repayment", effectiveFrom: "2024-06-01", recurrence: null, amountMinor: 100000, feeTreatment: null, offsetAccountId: null, note: null }], changeSummary: "Calculator: lump sum" }, "PUT"),
      ctx(debt.id)
    );
    expect(((await applied.json()) as { debt: { debt: { currentRevision: number } } }).debt.debt.currentRevision).toBe(2);
  });

  it("round-trips one-off and recurring offset deltas through the API without relabelling them", async () => {
    const offset = { actualAccountId: "acc-offset", effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 10_000, balanceBasis: "total" as const, capMinor: null };
    const debt = await create({
      offsets: [offset],
      assumptions: [
        { kind: "offset-balance", effectiveFrom: "2024-01-01", recurrence: null, amountMinor: 50_000, feeTreatment: null, offsetAccountId: "acc-offset", note: "Opening snapshot" },
        { kind: "offset-deposit", effectiveFrom: "2024-02-01", recurrence: { frequency: "monthly", until: "2024-04-01" }, amountMinor: 10_000, feeTreatment: null, offsetAccountId: "acc-offset", note: "Salary" },
        { kind: "offset-withdrawal", effectiveFrom: "2024-03-15", recurrence: null, amountMinor: 5_000, feeTreatment: null, offsetAccountId: "acc-offset", note: "Expense" },
      ],
    });
    const read = await getOne(new Request("http://bench/api"), ctx(debt.id));
    const assumptions = ((await read.json()) as { debt: { assumptions: Array<{ assumptionKind: string; recurrence: unknown; offsetAccountId: string | null }> } }).debt.assumptions;
    expect(assumptions.map((assumption) => assumption.assumptionKind)).toEqual([
      "offset-balance",
      "offset-deposit",
      "offset-withdrawal",
    ]);
    expect(assumptions[1]).toMatchObject({
      recurrence: { frequency: "monthly", until: "2024-04-01" },
      offsetAccountId: "acc-offset",
    });
  });

  it("keeps a loan's payment rules, Loan Ledger types and write journal, and returns them in one read", async () => {
    const debt = await create();
    const rule = { name: "Mortgage", match: "all", conditions: [{ field: "account", operator: "equals", value: "acc-checking" }] };
    const rules = (await (await putRule(json({ kind: "save", rule }, "PUT"), ctx(debt.id))).json()) as { rules: Array<{ id: string }> };
    expect(rules.rules).toHaveLength(1);
    expect((await patchLedger(json({ changes: [{ actualTransactionId: "t1", actualAccountId: "acc-mortgage", entryType: "draw", revision: 0 }] }, "PATCH"), ctx(debt.id))).status).toBe(200);
    const stale = await patchLedger(json({ changes: [{ actualTransactionId: "t1", actualAccountId: "acc-mortgage", entryType: "fee", revision: 0 }] }, "PATCH"), ctx(debt.id));
    expect(stale.status).toBe(400);

    const started = (await (await startWrite(json({ kind: "split", installmentDueDate: "2024-02-01", targetIds: ["p1"], before: {}, after: {} }), ctx(debt.id))).json()) as { write: { id: string } };
    const second = await startWrite(json({ kind: "split", targetIds: ["p2"], before: {}, after: {} }), ctx(debt.id));
    expect(second.status).toBe(400);
    const finished = await finishWrite(json({ status: "applied", actualIds: ["p1"] }, "PATCH"), { params: Promise.resolve({ id: debt.id, writeId: started.write.id }) });
    expect(((await finished.json()) as { write: { status: string } }).write.status).toBe("applied");

    const bundle = (await (await getTracking(new Request("http://bench/api"), ctx(debt.id))).json()) as { entries: unknown[]; rules: unknown[]; writes: unknown[]; openingStatement: unknown };
    expect({ entries: bundle.entries.length, rules: bundle.rules.length, writes: bundle.writes.length, openingStatement: bundle.openingStatement }).toEqual({ entries: 1, rules: 1, writes: 1, openingStatement: null });
    expect((await getTracking(new Request("http://bench/api"), ctx("missing"))).status).toBe(404);
    expect((await putRule(json({ kind: "save", rule }, "PUT"), ctx("missing"))).status).toBe(404);
  });

  it("records immutable observations, diagnoses without changing config and appends an anchor", async () => {
    const debt = await create();
    const before = (await (await getOne(new Request("http://bench/api"), ctx(debt.id))).json()) as { debt: { revision: { hash: string } } };
    const observed = await postObservation(json({ observedOn: "2024-06-01", recordedAt: "2024-06-02T00:00:00Z", principalMinor: 39_000_000, accruedInterestMinor: 12_345, supersedesObservationId: null, note: "Statement" }), ctx(debt.id));
    expect(observed.status).toBe(201);
    const observation = ((await observed.json()) as { observation: { id: string } }).observation;
    expect(((await (await getObservations(new Request("http://bench/api"), ctx(debt.id))).json()) as { observations: unknown[] }).observations).toHaveLength(1);

    const diagnostic = await diagnose(json({ observationId: observation.id }), ctx(debt.id));
    expect(diagnostic.status).toBe(200);
    expect(((await diagnostic.json()) as { candidates: unknown[] }).candidates.length).toBeGreaterThan(0);
    const after = (await (await getOne(new Request("http://bench/api"), ctx(debt.id))).json()) as { debt: { revision: { hash: string } } };
    expect(after.debt.revision.hash).toBe(before.debt.revision.hash);

    expect((await postAnchor(json({ observationId: observation.id, carriedRemainderDecimal: null }), ctx(debt.id))).status).toBe(201);
    expect(((await (await getAnchors(new Request("http://bench/api"), ctx(debt.id))).json()) as { anchors: unknown[] }).anchors).toHaveLength(1);
  });

  it("handlers hold no SQL and no calculation", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "route.ts") files.push(path);
      }
    };
    walk(__dirname);
    // Keep the architecture assertion independent of how many read endpoints are added.
    expect(files).toContain(join(__dirname, "[id]", "summary", "route.ts"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect({ file, sql: /prepare\(|SELECT |INSERT |UPDATE |DELETE FROM/.test(source) }).toEqual({ file, sql: false });
      expect({ file, math: /financial-models|@\/lib\/actual/.test(source) }).toEqual({ file, math: false });
    }
  });
});
