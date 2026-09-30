import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listModelRevisions } from "@/lib/app-db/modelRevisionRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { LEDGER_READ_METHODS, readAccountDirectory } from "../actual/ledgerPort";
import { BUDGET, debtConfig, directory, saveInput, tempDebtDb } from "../testing/debtFixtures";
import {
  archiveDebtConfiguration,
  createDebtConfiguration,
  discardDraftDebt,
  getDebtDetail,
  listDebtSummaries,
  saveBaselineAssumptions,
  updateDebtConfiguration,
  validateDebtSave,
  type DebtSaveInput,
} from "./debtConfigService";
import { projectStoredDebt, storedDebtEligibility } from "./projectionService";

let db: SqliteDatabase;
beforeEach(() => {
  db = tempDebtDb();
});
afterEach(() => resetAppDbForTests());

/** Validation issues for a save, without persisting anything. */
function issuesOf(input: DebtSaveInput, dir = directory()): string[] {
  const result = validateDebtSave(db, input, dir);
  return result.ok ? [] : result.issues.map((i) => `${i.field}: ${i.message}`);
}

describe("saving a debt configuration", () => {
  it("creates the debt, its rows and revision 1 in one save, with canonical decimals and the default drift tolerance", () => {
    const detail = createDebtConfiguration(db, saveInput({ rates: [{ ...saveInput().rates[0], annualRateDecimal: "0.06120" }] }), directory());
    expect(detail.debt).toMatchObject({ status: "active", currentRevision: 1, driftToleranceMinor: 100 });
    expect(detail.rates[0].annualRateDecimal).toBe("0.0612");
    expect(detail.blocked).toBeNull();
    const revisions = listModelRevisions(db, "debt", detail.debt.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ revision: 1, configFormat: "rd084.debt-revision", configVersion: 1, changeSummary: "Created" });
    expect(detail.revision.hash).toBe(revisions[0].configHash);
  });

  it("writes no new revision for a cosmetic edit, and one for a material edit", () => {
    const created = createDebtConfiguration(db, saveInput(), directory());
    const id = created.debt.id;
    const renamed = updateDebtConfiguration(db, id, saveInput({ name: "Our home loan", rates: [{ ...saveInput().rates[0], id: created.rates[0].id, source: "Bank letter", note: "checked" }] }), directory());
    expect(renamed.debt.name).toBe("Our home loan");
    expect(renamed.debt.currentRevision).toBe(1);
    expect(renamed.revision.hash).toBe(created.revision.hash);

    const repriced = updateDebtConfiguration(db, id, saveInput({ rates: [{ ...saveInput().rates[0], annualRateDecimal: "0.0599" }], changeSummary: "Rate cut" }), directory());
    expect(repriced.debt.currentRevision).toBe(2);
    expect(repriced.revision.hash).not.toBe(created.revision.hash);
    const labelled = updateDebtConfiguration(
      db, id,
      saveInput({ rates: [{ ...saveInput().rates[0], annualRateDecimal: "0.0599" }], config: debtConfig({ components: [
        { economicKind: "principal", label: "Principal repaid", destination: "transfer", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 0 },
        { economicKind: "interest", label: "Interest", destination: "category", categoryId: null, amountRule: "calculated", fixedAmountMinor: null, treatment: null, order: 1 },
      ] }) }),
      directory()
    );
    expect(labelled.debt.currentRevision).toBe(3);
    expect(listModelRevisions(db, "debt", id).map((r) => [r.revision, r.changeSummary])).toEqual([[1, "Created"], [2, "Rate cut"], [3, ""]]);
  });

  it("rejects offsets outside the debt's budget and accounts that cannot offset", () => {
    const other = { actualAccountId: "acc-elsewhere", effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 10000, balanceBasis: "total" as const, capMinor: null };
    expect(issuesOf(saveInput({ offsets: [other] }))).toEqual([expect.stringMatching(/offsets.0.actualAccountId: is not an account in this budget/)]);
    expect(issuesOf(saveInput({ offsets: [{ ...other, actualAccountId: "acc-mortgage" }] }))[0]).toMatch(/own liability account/);
    expect(issuesOf(saveInput({ offsets: [{ ...other, actualAccountId: "acc-closed" }] }))[0]).toMatch(/closed/);
    createDebtConfiguration(db, saveInput({ name: "Car", liabilityAccountId: "acc-car" }), directory());
    expect(issuesOf(saveInput({ offsets: [{ ...other, actualAccountId: "acc-car" }] }))[0]).toMatch(/another debt's liability account/);
    // An account list read from another budget is refused outright.
    expect(issuesOf(saveInput(), directory({ budgetSyncId: "budget-2" }))[0]).toMatch(/different budget/);
    const ok = createDebtConfiguration(db, saveInput({ offsets: [{ ...other, actualAccountId: "acc-offset" }] }), directory());
    expect(ok.offsets[0].actualAccountId).toBe("acc-offset");
  });

  it("requires boundary categories only when the relationship crosses the budget boundary, and only existing expense categories", () => {
    expect(issuesOf(saveInput({ loanPaymentCategoryId: null }))).toEqual([expect.stringMatching(/loanPaymentCategoryId: is required/)]);
    expect(issuesOf(saveInput({ loanPaymentCategoryId: "cat-missing" }))[0]).toMatch(/not a category in this budget/);
    expect(issuesOf(saveInput({ loanPaymentCategoryId: "cat-income" }))[0]).toMatch(/expense category/);
    // Both on budget: no boundary, no category needed.
    expect(issuesOf(saveInput({ liabilityAccountId: "acc-offset", loanPaymentCategoryId: null }))).toEqual([]);
    // Draws cross too once the facility can draw.
    const revolving = saveInput({ debtType: "heloc", behaviorClass: "revolving-credit", lenderPattern: null, liabilityAccountId: "acc-car", config: debtConfig({ revolving: { paymentModel: "interest-only", percentOfBalanceBps: null, minimumFloorMinor: null } }) });
    expect(issuesOf(revolving)).toEqual([expect.stringMatching(/drawCategoryId: is required/)]);
  });

  it("validates rates: exact strings, no negatives, floor below cap, per-rate overrides and recast consistency", () => {
    const r = saveInput().rates[0];
    const one = (patch: Partial<typeof r>) => issuesOf(saveInput({ rates: [{ ...r, ...patch }] }));
    expect(one({ annualRateDecimal: 0.0612 as unknown as string })[0]).toMatch(/not a number/);
    expect(one({ annualRateDecimal: "-0.01" })[0]).toMatch(/negative values are not supported/);
    expect(one({ annualRateDecimal: "6%" })[0]).toMatch(/decimal/);
    expect(one({ annualRateDecimal: "0" })).toEqual([]);
    expect(one({ rateCapDecimal: "0.05", rateFloorDecimal: "0.06" })[0]).toMatch(/not be above the rate cap/);
    expect(one({ paymentRecalcPolicy: "annual" })[0]).toMatch(/contract, not on a rate/);
    expect(one({ paymentRecalcPolicy: "on-contract-date" })[0]).toMatch(/contract, not on a rate/);
    expect(one({ paymentCap: { kind: "previous-payment-factor", factor: "0" } })[0]).toMatch(/greater than zero/);
    expect(one({ paymentRecalcPolicy: "never", paymentEffectiveFrom: "2024-03-01" })[0]).toMatch(/only when this rate change recalculates/);
    expect(one({ paymentRecalcPolicy: "never", paymentCap: { kind: "absolute", amountMinor: 100 } })[0]).toMatch(/only when this rate change recalculates/);
    expect(one({ paymentCap: { kind: "previous-payment-factor", factor: "1.0750" } })).toEqual([]);
    expect(issuesOf(saveInput({ rates: [r, { ...r }] }))[0]).toMatch(/same date/);
    expect(issuesOf(saveInput({ rates: [{ ...r, accrualEffectiveFrom: "2024-06-01" }] }))[0]).toMatch(/no rate applies on the opening date/);
  });

  it("validates each assumption kind's required and forbidden fields", () => {
    const a = { kind: "extra-repayment" as const, effectiveFrom: "2025-01-01", recurrence: null, amountMinor: 5000, feeTreatment: null, offsetAccountId: null, note: null };
    const one = (patch: Record<string, unknown>) => issuesOf(saveInput({ assumptions: [{ ...a, ...patch } as never] }));
    expect(one({})).toEqual([]);
    expect(one({ amountMinor: 0 })[0]).toMatch(/positive amount/);
    expect(one({ kind: "fee" })[0]).toMatch(/feeTreatment/);
    expect(one({ feeTreatment: "capitalized" })[0]).toMatch(/only a fee/);
    expect(one({ kind: "offset-balance", amountMinor: 0 })[0]).toMatch(/offset accounts/);
    expect(one({ kind: "payment-change", recurrence: { frequency: "monthly", until: "2026-01-01" } })[0]).toMatch(/can recur/);
    expect(one({ recurrence: { frequency: "semi-monthly", until: "2026-01-01" } })[0]).toMatch(/frequency/);
    expect(one({ recurrence: { frequency: "monthly", until: "2024-01-01" } })[0]).toMatch(/until/);
  });

  it("refuses unsupported config identifiers, and allows a draft without accounts", () => {
    expect(issuesOf(saveInput({ config: debtConfig({ version: 3 }) }))[0]).toMatch(/unsupported-config/);
    const gated = debtConfig();
    (gated.profile as Record<string, unknown>).dayCount = "monthly-30-360-actual-day-allocation";
    expect(issuesOf(saveInput({ config: gated }))[0]).toMatch(/unsupported-config/);
    const semi = debtConfig();
    (semi.profile as Record<string, unknown>).repaymentFrequency = "semi-monthly";
    expect(issuesOf(saveInput({ config: semi }))[0]).toMatch(/unsupported-config/);
    expect(issuesOf(saveInput({ status: "draft", liabilityAccountId: null, paymentAccountId: null, loanPaymentCategoryId: null, rates: [] }))).toEqual([]);
    expect(issuesOf(saveInput({ liabilityAccountId: null }))[0]).toMatch(/required before the debt can be active/);
  });

  it("archives with a revision, refuses later edits, and discards only drafts", () => {
    const d = createDebtConfiguration(db, saveInput(), directory());
    const archived = archiveDebtConfiguration(db, d.debt.id);
    expect(archived.debt.status).toBe("archived");
    expect(archived.debt.currentRevision).toBe(2);
    expect(() => updateDebtConfiguration(db, d.debt.id, saveInput(), directory())).toThrow(/archived/);
    // The liability account is free again for a new debt.
    createDebtConfiguration(db, saveInput({ name: "Refinanced" }), directory());
    expect(() => discardDraftDebt(db, d.debt.id)).toThrow(/Only a draft/);

    const draft = createDebtConfiguration(db, saveInput({ status: "draft", liabilityAccountId: null, loanPaymentCategoryId: null }), directory());
    expect(listModelRevisions(db, "debt", draft.debt.id)).toHaveLength(1);
    expect(discardDraftDebt(db, draft.debt.id)).toBe(true);
    expect(getDebtDetail(db, draft.debt.id)).toBeNull();
    expect(listModelRevisions(db, "debt", draft.debt.id)).toEqual([]);
  });

  it("an active debt cannot go back to draft", () => {
    const d = createDebtConfiguration(db, saveInput(), directory());
    expect(() => updateDebtConfiguration(db, d.debt.id, saveInput({ status: "draft" }), directory())).toThrow(/cannot return to draft/);
  });
});

describe("config compatibility (schema-review A-2)", () => {
  it("Blocks only the debt whose stored config is a newer version; the others stay usable", () => {
    const newer = createDebtConfiguration(db, saveInput({ name: "Newer" }), directory());
    const fine = createDebtConfiguration(db, saveInput({ name: "Fine", liabilityAccountId: "acc-car" }), directory());
    db.prepare("UPDATE debts SET current_config_json = ? WHERE id = ?").run(JSON.stringify({ ...debtConfig(), version: 3 }), newer.debt.id);
    const summaries = listDebtSummaries(db, BUDGET);
    expect(summaries.find((s) => s.id === newer.debt.id)?.blocked).toEqual({ code: "unsupported-config", message: expect.stringMatching(/newer version of Actual Bench/) });
    expect(summaries.find((s) => s.id === fine.debt.id)?.blocked).toBeNull();
    expect(projectStoredDebt(db, newer.debt.id, { from: "2024-01-01", to: "2024-12-31" })).toMatchObject({ ok: false, blocked: { code: "unsupported-config" } });
    expect(projectStoredDebt(db, fine.debt.id, { from: "2024-01-01", to: "2024-12-31" }).ok).toBe(true);
    expect(() => saveBaselineAssumptions(db, newer.debt.id, [], "x")).toThrow(/newer version/);
  });

  it("Blocks a debt holding a relational enum value from a newer build", () => {
    const d = createDebtConfiguration(db, saveInput(), directory());
    db.prepare("UPDATE debt_rate_periods SET payment_recalc_policy = 'quarterly-reset'").run();
    expect(getDebtDetail(db, d.debt.id)?.blocked?.code).toBe("unsupported-value");
  });
});

describe("baseline assumptions and projection", () => {
  it("projection overrides are never persisted; applying a baseline writes only assumptions and a revision", () => {
    const d = createDebtConfiguration(db, saveInput(), directory());
    const before = JSON.stringify(getDebtDetail(db, d.debt.id));
    const base = projectStoredDebt(db, d.debt.id, { from: "2024-01-01", to: "2026-12-31" });
    const lump = projectStoredDebt(db, d.debt.id, { from: "2024-01-01", to: "2026-12-31", overrides: { assumptions: [{ kind: "extra-repayment", date: "2025-02-01", amountMinor: 1_000_000 }] } });
    expect(JSON.stringify(getDebtDetail(db, d.debt.id))).toBe(before);
    const closing = (p: typeof base) => (p.ok && p.projection.ok ? p.projection.events.at(-1)!.balanceAfterMinor : NaN);
    expect(closing(base) - closing(lump)).toBeGreaterThan(1_000_000);

    const applied = saveBaselineAssumptions(db, d.debt.id, [{ kind: "extra-repayment", effectiveFrom: "2025-02-01", recurrence: null, amountMinor: 1_000_000, feeTreatment: null, offsetAccountId: null, note: null }], "Calculator: lump sum");
    expect(applied.assumptions).toHaveLength(1);
    expect(applied.debt.currentRevision).toBe(2);
    expect({ ...applied.debt, currentRevision: 1, updatedAt: d.debt.updatedAt }).toEqual(d.debt);
    expect(applied.rates).toEqual(d.rates);
    expect(closing(projectStoredDebt(db, d.debt.id, { from: "2024-01-01", to: "2026-12-31" }))).toBe(closing(lump));
  });

  it("reports eligibility with reasons for every rejected strategy", () => {
    const d = createDebtConfiguration(db, saveInput(), directory());
    const result = storedDebtEligibility(db, d.debt.id, { formulaRules: false, splitActions: true, transferPayees: true, ruleReadback: true });
    expect(result.ok && result.eligibility.recommended).toBe("bench-periodic");
    expect(result.ok && result.eligibility.options[0].reasons.length).toBeGreaterThan(0);
  });
});

describe("zero Actual writes (T079, FR-002, SC-001)", () => {
  function spyTransport(): { transport: ActualBenchTransport; calls: string[] } {
    const calls: string[] = [];
    const reads: Record<string, () => Promise<unknown>> = {
      getAccounts: async () => directory().accounts.map((a) => ({ ...a })),
      getCategoryGroups: async () => ({ groups: [{ id: "g1", name: "Bills", isIncome: false, hidden: false, categoryIds: [] }], categories: directory().categories.map((c) => ({ id: c.id, name: c.name, groupId: "g1", isIncome: c.isIncome, hidden: c.hidden })) }),
    };
    const transport = new Proxy({} as ActualBenchTransport, {
      get: (_t, prop: string) => {
        if (prop === "then") return undefined;
        return () => {
          calls.push(prop);
          return reads[prop] ? reads[prop]() : Promise.resolve(undefined);
        };
      },
    });
    return { transport, calls };
  }

  it("every configuration operation calls only transport read methods", async () => {
    const { transport, calls } = spyTransport();
    const dir = await readAccountDirectory(transport, BUDGET);
    const created = createDebtConfiguration(db, saveInput({ offsets: [{ actualAccountId: "acc-offset", effectiveFrom: "2024-01-01", effectiveTo: null, offsetPercentageBps: 10000, balanceBasis: "total", capMinor: null }] }), dir);
    updateDebtConfiguration(db, created.debt.id, saveInput({ name: "Renamed" }), dir);
    updateDebtConfiguration(db, created.debt.id, saveInput({ rates: [{ ...saveInput().rates[0], annualRateDecimal: "0.05" }] }), dir);
    saveBaselineAssumptions(db, created.debt.id, [], "cleared");
    projectStoredDebt(db, created.debt.id, { from: "2024-01-01", to: "2025-01-01" });
    storedDebtEligibility(db, created.debt.id, { formulaRules: true, splitActions: true, transferPayees: true, ruleReadback: true });
    const draft = createDebtConfiguration(db, saveInput({ status: "draft", liabilityAccountId: null, loanPaymentCategoryId: null }), dir);
    discardDraftDebt(db, draft.debt.id);
    archiveDebtConfiguration(db, created.debt.id);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(LEDGER_READ_METHODS).toContain(call);
  });

  it("no configuration module can reach a transport at runtime: Actual imports are type-only", () => {
    const roots = [join(__dirname), join(__dirname, "../actual")];
    for (const root of roots) {
      for (const file of readdirSync(root).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
        const source = readFileSync(join(root, file), "utf8");
        const runtimeActual = source.split("\n").filter((l) => /from "@\/lib\/actual/.test(l) && !/^import type /.test(l.trim()));
        expect({ file, runtimeActual }).toEqual({ file, runtimeActual: [] });
      }
    }
  });
});
