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
import { GET as eligibility } from "./[id]/eligibility/route";
import { POST as schedule } from "./[id]/schedule/route";
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

  it("projects with temporary overrides, reports eligibility, and saves baseline assumptions", async () => {
    const debt = await create();
    const projected = await schedule(json({ from: "2024-01-01", to: "2024-12-31", overrides: { assumptions: [{ kind: "extra-repayment", date: "2024-06-01", amountMinor: 100000 }] } }), ctx(debt.id));
    const body = (await projected.json()) as { projection: { ok: boolean; events: unknown[] } };
    expect(body.projection.ok).toBe(true);
    expect(body.projection.events.length).toBeGreaterThan(0);
    // The override was not stored.
    expect(((await (await getOne(new Request("http://bench/api"), ctx(debt.id))).json()) as { debt: { assumptions: unknown[] } }).debt.assumptions).toEqual([]);

    const elig = (await (await eligibility(new Request("http://bench/api?formulaRules=1&splitActions=1&transferPayees=1&ruleReadback=1"), ctx(debt.id))).json()) as { eligibility: { recommended: string } };
    expect(elig.eligibility.recommended).toBe("actual-formula-rule");
    const noCaps = (await (await eligibility(new Request("http://bench/api"), ctx(debt.id))).json()) as { eligibility: { recommended: string } };
    expect(noCaps.eligibility.recommended).toBe("bench-periodic");

    const applied = await putAssumptions(
      json({ assumptions: [{ kind: "extra-repayment", effectiveFrom: "2024-06-01", recurrence: null, amountMinor: 100000, feeTreatment: null, offsetAccountId: null, note: null }], changeSummary: "Calculator: lump sum" }, "PUT"),
      ctx(debt.id)
    );
    expect(((await applied.json()) as { debt: { debt: { currentRevision: number } } }).debt.debt.currentRevision).toBe(2);
    expect((await schedule(json({ from: "2024-01-01", to: "2024-12-31" }), ctx("missing"))).status).toBe(404);
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
    expect(files.length).toBe(5);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect({ file, sql: /prepare\(|SELECT |INSERT |UPDATE |DELETE FROM/.test(source) }).toEqual({ file, sql: false });
      expect({ file, math: /financial-models|@\/lib\/actual/.test(source) }).toEqual({ file, math: false });
    }
  });
});
