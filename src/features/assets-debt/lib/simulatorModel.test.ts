import { resetAppDbForTests } from "@/lib/app-db/connection";
import { createDebtConfiguration, getDebtDetail, validateDebtSave } from "@/lib/assets-debt/services/debtConfigService";
import { directory, saveInput, tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";
import { parseDebtConfig } from "@/lib/financial-models/loan/configSchema";
import { validateProfile } from "@/lib/financial-models/loan/profile";
import { chartSeries, deltas, headline } from "./results";
import {
  dailyEngineReason,
  derivedFirstPaymentDate,
  detailToStates,
  minorDigitsFor,
  missingInputs,
  newSimulation,
  newTracking,
  simulationToModel,
  statesToSaveInput,
  summarizeProfile,
  switchToDayByDay,
  SIMULATOR_DEFAULT_PROFILE,
  type SimulationState,
} from "./simulatorModel";
import { DAILY_MONTHLY_CHARGE, offsetOf, project, sim } from "./simulatorTestKit";

describe("the five-input path", () => {
  it("a new simulation needs exactly amount, term and rate; start date and frequency come pre-filled", () => {
    const fresh = newSimulation({ currency: "AUD", today: "2026-09-29" });
    expect(fresh.shape).toBe("term-loan");
    expect(fresh.startDate).toBe("2026-09-29");
    expect(fresh.profile.repaymentFrequency).toBe("monthly");
    expect(missingInputs(fresh)).toEqual(["loan amount", "term", "interest rate"]);
  });

  it("the five inputs alone build a valid config v1 model and a complete projection", () => {
    const s = sim();
    const built = simulationToModel(s);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.model.terms.firstPaymentDate).toBe("2024-02-01");
    expect(built.model.lenderPattern).toBeNull();
    expect(validateProfile(built.model.profile).ok).toBe(true);
    const config = { format: "rd084.debt-config", version: 1, terms: built.model.terms, profile: built.model.profile, phases: built.model.phases, components: [], paymentRecasts: [], revolving: null };
    expect(parseDebtConfig(config).ok).toBe(true);
    const p = project(s);
    if (!p.ok) throw new Error("blocked");
    const h = headline(p.events);
    // The standard figure for 400,000 at 6% over 30 years, monthly: 2,398.20.
    expect(h.regularRepaymentMinor).toBe(239_820);
    expect(h.payoffDate).toBe("2054-01-01");
    expect(h.totalInterestMinor).toBeGreaterThan(0);
    expect(h.totalRepaidMinor).toBe(40_000_000 + h.totalInterestMinor);
  });

  it("the default profile is explicit, periodic and names no lender", () => {
    expect(SIMULATOR_DEFAULT_PROFILE).toMatchObject({ accrual: "per-period", rateQuote: "nominal-simple-periodic", repaymentDerivation: "annuity-at-payment-frequency", presetId: null });
    expect(summarizeProfile(SIMULATOR_DEFAULT_PROFILE)).toBe("interest per repayment period · level payment");
    expect(summarizeProfile({ ...SIMULATOR_DEFAULT_PROFILE, ...DAILY_MONTHLY_CHARGE })).toBe("Actual/365 Fixed · daily interest · charged monthly on day 1 · level payment");
  });

  it("derives the first repayment one period after the start, and currency precision from the currency", () => {
    expect(derivedFirstPaymentDate(sim({ profile: { ...sim().profile, repaymentFrequency: "fortnightly" } }))).toBe("2024-01-15");
    expect(derivedFirstPaymentDate(sim({ startDate: "2024-01-31" }))).toBe("2024-02-29");
    expect(minorDigitsFor("JPY")).toBe(0);
    expect(minorDigitsFor("KWD")).toBe(3);
    expect(minorDigitsFor("AUD")).toBe(2);
  });

  it("features switched off contribute nothing to the model", () => {
    const off = simulationToModel(sim({ interestOnly: false, phases: [{ kind: "interest-only", from: "2024-01-01", to: "2025-01-01", recastAtEnd: "on-rate-change" }], paymentRecasts: [{ date: "2027-01-01", note: null }] }));
    expect(off.ok && off.model.phases).toEqual([]);
    expect(off.ok && off.model.paymentRecasts).toEqual([]);
    expect(off.ok && off.model.terms.contractualPaymentMinor).toBeNull();
  });
});

describe("O1: features that need day-by-day interest", () => {
  const periodic = sim();

  it("an offset under a period-by-period profile asks to switch", () => {
    expect(dailyEngineReason({ ...periodic, ...offsetOf(5_000_000) })).toMatch(/offset/i);
  });

  it("an extra repayment between repayment dates asks; one on a repayment date does not", () => {
    const mid: SimulationState = { ...periodic, assumptions: [{ key: "x", kind: "extra-repayment", effectiveFrom: "2024-03-10", recurrence: null, amountMinor: 100_000, feeTreatment: null, offsetAccountId: null, note: null }] };
    expect(dailyEngineReason(mid)).toMatch(/between repayment dates/);
    const onDate = { ...mid, assumptions: [{ ...mid.assumptions[0], effectiveFrom: "2024-03-01" }] };
    expect(dailyEngineReason(onDate)).toBeNull();
  });

  it("a rate change inside a payment period asks; one at a period boundary does not", () => {
    const mid = { ...periodic, rates: [periodic.rates[0], { ...periodic.rates[0], key: "r2", accrualEffectiveFrom: "2025-03-15", annualRateDecimal: "0.07" }] };
    expect(dailyEngineReason(mid)).toMatch(/part-way through/);
    const boundary = { ...mid, rates: [mid.rates[0], { ...mid.rates[1], accrualEffectiveFrom: "2025-03-01" }] };
    expect(dailyEngineReason(boundary)).toBeNull();
  });

  it("compatible periodic features never ask", () => {
    expect(dailyEngineReason(periodic)).toBeNull();
    expect(dailyEngineReason({ ...periodic, interestOnly: true, phases: [{ kind: "interest-only", from: "2024-01-01", to: "2026-01-01", recastAtEnd: "on-rate-change" }] })).toBeNull();
    expect(dailyEngineReason({ ...periodic, components: [{ key: "c", economicKind: "fee", amountRule: "fixed", fixedAmountMinor: 1_000, treatment: "cash-paid" }] })).toBeNull();
  });

  it("switching changes only the accrual and yields a valid daily model that calculates", () => {
    const candidate = { ...periodic, ...offsetOf(5_000_000) };
    const switched = switchToDayByDay(candidate);
    const changed = Object.entries(switched.profile).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((candidate.profile as Record<string, unknown>)[k])).map(([k]) => k);
    expect(changed).toEqual(["accrual"]);
    expect(validateProfile(switched.profile).ok).toBe(true);
    expect(dailyEngineReason(switched)).toBeNull();
    expect(project(switched).ok).toBe(true);
    // Every other input is kept.
    expect({ ...switched, profile: null }).toEqual({ ...candidate, profile: null });
  });
});

describe("state boundary and saving", () => {
  afterEach(() => resetAppDbForTests());

  it("SimulationState carries nothing Actual-specific", () => {
    const keys = Object.keys(sim());
    for (const forbidden of ["liabilityAccountId", "paymentAccountId", "categoryId", "loanPaymentCategoryId", "lenderPattern", "executionStrategy", "driftToleranceMinor", "name"]) expect(keys).not.toContain(forbidden);
  });

  it("an active save needs the lender pattern answered, offsets mapped and a name; a draft only needs the name and mapping", () => {
    const s = { ...sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE } }), ...offsetOf(5_000_000) };
    const t = newTracking(s);
    expect(t.lenderPattern).toBeNull();
    const first = statesToSaveInput(s, t, "budget-1", "bench-daily");
    expect(first.ok ? [] : first.issues.map((i) => i.field)).toEqual(expect.arrayContaining(["name", `offset:${s.offsets[0].key}`, "lenderPattern"]));
    const draft = statesToSaveInput(s, { ...t, name: "Home loan", status: "draft", offsetAccountMap: { [s.offsets[0].placeholderAccountId]: "acc-offset" } }, "budget-1", "bench-daily");
    expect(draft.ok).toBe(true);
  });

  it("the saved configuration is exactly the simulated calculation, and round-trips", () => {
    const db = tempDebtDb();
    const s = { ...sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, components: [{ key: "fee-1", economicKind: "fee", amountRule: "fixed", fixedAmountMinor: 1_000, treatment: "cash-paid" }] }), ...offsetOf(5_000_000) };
    const t = { ...newTracking(s), name: "Home loan", lenderPattern: "separate-interest" as const, liabilityAccountId: "acc-mortgage", paymentAccountId: "acc-checking", loanPaymentCategoryId: "cat-loan", offsetAccountMap: { [s.offsets[0].placeholderAccountId]: "acc-offset" } };
    const built = statesToSaveInput(s, t, "budget-1", "bench-daily");
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    expect(validateDebtSave(db, built.input, directory()).ok).toBe(true);
    const saved = createDebtConfiguration(db, built.input, directory());
    const states = detailToStates(getDebtDetail(db, saved.debt.id)!)!;
    // The reloaded simulation projects identically to the one that was saved.
    const a = project(s);
    const b = project(states.simulation);
    expect(a.ok && b.ok && headline(b.events)).toEqual(a.ok && headline(a.events));
    expect(states.tracking).toMatchObject({ name: "Home loan", lenderPattern: "separate-interest", offsetAccountMap: { [states.simulation.offsets[0].placeholderAccountId]: "acc-offset" } });
    const again = statesToSaveInput(states.simulation, states.tracking, "budget-1", "bench-daily");
    expect(again.ok && again.input.config).toEqual(JSON.parse(saved.debt.currentConfigJson));
    // The existing fixture still validates as before.
    expect(validateDebtSave(db, saveInput({ name: "Other", liabilityAccountId: "acc-car" }), directory()).ok).toBe(true);
  });

  it("writes config v2 only for the dated cash-flow repayment identifier", () => {
    const base = sim();
    const dated = {
      ...base,
      profile: {
        ...base.profile,
        accrual: "daily-simple" as const,
        dayCount: "actual-360" as const,
        chargeFrequency: "at-repayment" as const,
        chargeDay: null,
        capitalization: "at-charge" as const,
        repaymentDerivation: "dated-cashflow-annuity" as const,
        eventOrder: { timing: "end-of-day" as const },
      },
    };
    const tracking = { ...newTracking(dated), name: "Dated loan", status: "draft" as const };
    const saved = statesToSaveInput(dated, tracking, "budget-1", "bench-daily");
    expect(saved.ok && (saved.input.config as { version: number }).version).toBe(2);
    const conventional = statesToSaveInput(base, { ...newTracking(base), name: "Conventional", status: "draft" }, "budget-1", "bench-periodic");
    expect(conventional.ok && (conventional.input.config as { version: number }).version).toBe(1);
  });
});

describe("headline, deltas and chart series", () => {
  it("deltas describe savings in words-ready numbers", () => {
    const base = project(sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE } }));
    const extra = project(sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, assumptions: [{ key: "x", kind: "extra-repayment", effectiveFrom: "2024-03-10", recurrence: { frequency: "monthly", until: "2035-12-10" }, amountMinor: 100_000, feeTreatment: null, offsetAccountId: null, note: null }] }));
    if (!base.ok || !extra.ok) throw new Error("blocked");
    const d = deltas(headline(extra.events), headline(base.events));
    expect(d.interestMinor).toBeLessThan(0);
    expect(d.payoffDays).toBeLessThan(0);
    expect(d.repaymentMinor).toBe(0);
  });

  it("chart series include only what the loan has", () => {
    const plain = sim();
    const p = project(plain);
    expect(chartSeries(p, plain, { view: "year" }).series).toEqual(["balance", "cumulativeInterest"]);
    const withOffset = { ...sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE } }), ...offsetOf(5_000_000) };
    const po = project(withOffset);
    const data = chartSeries(po, withOffset, { view: "month", comparison: p });
    expect(data.series).toEqual(["balance", "comparison", "offsetBalance", "interestBearing", "cumulativeInterest"]);
    const jan = data.points[0];
    expect(jan.offsetBalance).toBe(5_000_000);
  });
});
