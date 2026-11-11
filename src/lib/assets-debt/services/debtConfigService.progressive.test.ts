import { resetAppDbForTests } from "@/lib/app-db/connection";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { detailToStates, statesToSaveInput } from "@/features/assets-debt/lib/simulatorModel";
import { debtConfig, directory, saveInput, tempDebtDb } from "../testing/debtFixtures";
import { createDebtConfiguration, getDebtDetail, updateDebtConfiguration } from "./debtConfigService";
import { projectStoredDebt } from "./projectionService";

/** Feedback #399 as a saved loan: per-period progressive principal, config v4. */
const progressiveConfig = () => debtConfig({
  version: 4,
  terms: { openingDate: "2026-09-30", openingPrincipalMinor: 203_353_10, maturityDate: null, contractualTermMonths: 276, amortizationTermMonths: 276, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2026-10-30", firstInterestChargeDate: null },
  profile: { ...(debtConfig().profile as object), amortization: "progressive-principal", recast: "never" },
  businessDays: null,
  lenderStatement: null,
  progressive: { growthPerRepaymentDecimal: "0.0034592411" },
});
const rate = { announcedAt: null, accrualEffectiveFrom: "2026-09-30", annualRateDecimal: "0.036", paymentRecalcPolicy: null, paymentEffectiveFrom: null, rateCapDecimal: null, rateFloorDecimal: null, paymentCap: null, source: null, note: null };

let db: SqliteDatabase;
beforeEach(() => { db = tempDebtDb(); });
afterEach(() => resetAppDbForTests());

describe("saving a progressive principal loan", () => {
  it("saves, reloads into the calculator and projects the bank's first instalment", () => {
    const saved = createDebtConfiguration(db, saveInput({ config: progressiveConfig(), rates: [rate] }), directory());
    const detail = getDebtDetail(db, saved.debt.id)!;
    const states = detailToStates(detail)!;
    expect(states.simulation.profile.amortization).toBe("progressive-principal");
    expect(states.simulation.progressiveGrowthDecimal).toBe("0.0034592411");

    const projected = projectStoredDebt(db, saved.debt.id, { from: "2026-09-30", to: "2027-01-31" });
    if (!projected.ok || !projected.projection.ok) throw new Error("not projected");
    const first = projected.projection.events.find((e) => e.eventType === "repayment")!;
    expect(first).toMatchObject({ date: "2026-10-30", cashMovementMinor: -1_051_44, interestMinor: 610_06, balanceAfterMinor: 202_911_72 });
  });

  it("revises through the calculator: a recast date stays v4, switching to level payment drops back to v1", () => {
    const saved = createDebtConfiguration(db, saveInput({ config: progressiveConfig(), rates: [rate] }), directory());
    const { simulation, tracking } = detailToStates(getDebtDetail(db, saved.debt.id)!)!;

    const recast = statesToSaveInput({ ...simulation, profile: { ...simulation.profile, recast: "on-contract-date" }, paymentRecasts: [{ date: "2027-01-31", note: null }] }, tracking, saved.debt.budgetSyncId, "bench-periodic");
    if (!recast.ok) throw new Error(JSON.stringify(recast.issues));
    expect(recast.input.config).toMatchObject({ version: 4, progressive: { growthPerRepaymentDecimal: "0.0034592411" }, paymentRecasts: [{ date: "2027-01-31" }] });
    expect(updateDebtConfiguration(db, saved.debt.id, recast.input, directory()).config).toMatchObject({ ok: true });

    const level = statesToSaveInput({ ...simulation, profile: { ...simulation.profile, amortization: "level-payment" } }, tracking, saved.debt.budgetSyncId, "bench-periodic");
    if (!level.ok) throw new Error(JSON.stringify(level.issues));
    expect(level.input.config).toMatchObject({ version: 1 });
    expect(level.input.config).not.toHaveProperty("progressive");
    const reloaded = detailToStates(updateDebtConfiguration(db, saved.debt.id, level.input, directory()))!;
    expect(reloaded.simulation.profile.amortization).toBe("level-payment");
  });

  it("refuses a rate change that would recalculate or cap a progressive repayment", () => {
    const capped = { ...rate, accrualEffectiveFrom: "2027-03-30", annualRateDecimal: "0.042", paymentRecalcPolicy: "on-rate-change" };
    expect(() => createDebtConfiguration(db, saveInput({ config: progressiveConfig(), rates: [rate, capped] }), directory())).toThrow(/changes the interest only/);
  });
});
