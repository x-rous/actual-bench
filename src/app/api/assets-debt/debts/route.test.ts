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
import { POST as backtest } from "./[id]/backtest/route";
import { DELETE as deleteRule, GET as getRules, PATCH as patchRule, POST as postRule } from "./[id]/match-rules/route";
import { GET as getObservations, POST as postObservation } from "./[id]/observations/route";
import { GET as getAnchors, POST as postAnchor } from "./[id]/anchors/route";
import { POST as reconcile } from "./[id]/reconciliation/route";
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
const conditions = {
  format: "rd084.debt-match-conditions",
  version: 1,
  operator: "all",
  items: [
    { kind: "source-account", accountId: "acc-checking" },
    { kind: "expected-date", daysBefore: 3, daysAfter: 3 },
    { kind: "bench-marker", value: "exclude" },
    { kind: "posting-link", value: "exclude" },
  ],
};
const actions = { format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] };

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

  it("creates, backtests, edits, lists and deletes a read-only matching rule", async () => {
    const debt = await create();
    const createdResponse = await postRule(json({ rule: { purpose: "repayment", conditions, actions, enabled: false } }), ctx(debt.id));
    expect(createdResponse.status).toBe(201);
    const created = ((await createdResponse.json()) as { rule: { record: { id: string }; blocked: string | null } }).rule;
    expect(created.blocked).toBeNull();

    const listed = (await (await getRules(new Request("http://bench/api"), ctx(debt.id))).json()) as { rules: unknown[] };
    expect(listed.rules).toHaveLength(1);

    const tested = await backtest(json({
      ruleId: created.record.id,
      from: "2024-02-01",
      to: "2024-02-01",
      snapshots: [{ accountId: "acc-checking", transactions: [{
        id: "tx-1", accountId: "acc-checking", date: "2024-02-01", amount: -500_000,
        payeeId: "bank", payeeName: "Bank", categoryId: null, categoryName: null, notes: null,
        cleared: true, reconciled: false, importedId: null, transferId: null, scheduleId: null,
        isParent: false, isChild: false, parentId: null, splitLines: [],
      }] }],
    }), ctx(debt.id));
    const testedBody = (await tested.json()) as { backtest?: { summary: { unique: number } }; error?: string };
    expect({ status: tested.status, error: testedBody.error }).toEqual({ status: 200, error: undefined });
    expect(testedBody.backtest?.summary.unique).toBe(1);

    const edited = await patchRule(json({ ruleId: created.record.id, rule: { purpose: "interest-charge", conditions, actions, enabled: false } }, "PATCH"), ctx(debt.id));
    expect(((await edited.json()) as { rule: { record: { purpose: string } } }).rule.record.purpose).toBe("interest-charge");

    const deleted = await deleteRule(new Request(`http://bench/api/assets-debt/debts/${debt.id}/match-rules?ruleId=${created.record.id}`, { method: "DELETE" }), ctx(debt.id));
    expect(deleted.status).toBe(204);
    expect(((await (await getRules(new Request("http://bench/api"), ctx(debt.id))).json()) as { rules: unknown[] }).rules).toHaveLength(0);
  });

  it("records immutable observations, diagnoses without changing config, reconciles and appends an anchor", async () => {
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

    const reconciled = await reconcile(json({ comparisonDate: "2024-06-01", actualBalanceMinor: 39_100_000 }), ctx(debt.id));
    expect(reconciled.status).toBe(200);
    expect(await reconciled.json()).toMatchObject({ reconciliation: { comparison: { comparisonDate: "2024-06-01", actualMinor: 39_100_000 } } });

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
    expect(files.length).toBe(11);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect({ file, sql: /prepare\(|SELECT |INSERT |UPDATE |DELETE FROM/.test(source) }).toEqual({ file, sql: false });
      expect({ file, math: /financial-models|@\/lib\/actual/.test(source) }).toEqual({ file, math: false });
    }
  });
});
