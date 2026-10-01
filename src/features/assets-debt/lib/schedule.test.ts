import { simulate } from "@/lib/financial-models/loan/projection";
import { aggregateSchedule, paymentNumberCell, principalLabel, rateCell, scheduleColumns, schedulePeriodLabel, type ScheduleRow } from "./schedule";
import { projectionWindow, simKey, simulationToModel, type SimulationState } from "./simulatorModel";
import { DAILY_MONTHLY_CHARGE, offsetOf, project, sim } from "./simulatorTestKit";

/*
 * P1.3b T212: the schedule aggregates engine fields directly, and every view reconciles.
 */

const extra = (date: string, amountMinor: number, recurrence: SimulationState["assumptions"][number]["recurrence"] = null) => ({ key: simKey("x"), kind: "extra-repayment" as const, effectiveFrom: date, recurrence, amountMinor, feeTreatment: null, offsetAccountId: null, note: null });

const FIXTURES: [string, SimulationState][] = [
  ["ordinary amortizing (five-input default)", sim()],
  ["separately charged interest (daily, monthly charge)", sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE } })],
  ["interest-only period", sim({ interestOnly: true, phases: [{ kind: "interest-only", from: "2024-01-01", to: "2026-01-01", recastAtEnd: "on-rate-change" }] })],
  ["cash-paid fee component", sim({ components: [{ key: "fee-1", economicKind: "fee", amountRule: "fixed", fixedAmountMinor: 1_000, treatment: "cash-paid" }] })],
  ["capitalized fee event", sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, assumptions: [{ key: "f", kind: "fee", effectiveFrom: "2024-05-10", recurrence: null, amountMinor: 50_000, feeTreatment: "capitalized", offsetAccountId: null, note: null }] })],
  ["extra repayments", sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, assumptions: [extra("2024-03-10", 100_000, { frequency: "monthly", until: "2030-12-10" })] })],
  ["draw", sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, assumptions: [{ key: "d", kind: "draw", effectiveFrom: "2025-02-10", recurrence: null, amountMinor: 1_000_000, feeTreatment: null, offsetAccountId: null, note: null }] })],
  ["negative amortization", sim({ contractualPaymentMinor: 150_000, profile: { ...sim().profile, repaymentDerivation: "contractual-fixed", negativeAmortizationAllowed: true, finalPayment: "continue-until-paid" } }, "0.06")],
  ["balloon", sim({ contractTermMonths: 60, profile: { ...sim().profile, finalPayment: "contractual-balloon" } })],
  ["offset", sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, ...offsetOf(5_000_000) })],
  ["mid-period rate change", sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, rates: [{ ...sim().rates[0] }, { ...sim().rates[0], key: "r2", accrualEffectiveFrom: "2025-03-15", annualRateDecimal: "0.07" }] })],
];

const SUMMED: (keyof ScheduleRow)[] = ["paymentMinor", "principalMinor", "interestMinor", "extraRepaymentMinor", "feesMinor", "drawMinor", "unpaidInterestMinor", "balloonMinor", "residualMinor", "principalMovementMinor"];
const total = (rows: ScheduleRow[], f: keyof ScheduleRow) => rows.reduce((s, r) => s + (r[f] as number), 0);

describe.each(FIXTURES)("%s", (_name, s) => {
  const projection = project(s, "2034-12-31");
  if (!projection.ok) throw new Error(projection.blocked.map((b) => b.message).join("; "));
  const events = aggregateSchedule(projection.events, "events");

  it.each(["month", "year"] as const)("%s rows reconcile to the event view", (view) => {
    const rows = aggregateSchedule(projection.events, view);
    for (const f of SUMMED) expect(total(rows, f)).toBe(total(events, f));
    for (const r of rows) expect(r.openingBalanceMinor + r.principalMovementMinor).toBe(r.closingBalanceMinor);
    // Consecutive periods chain: each opens where the last closed.
    for (let i = 1; i < rows.length; i++) expect(rows[i].openingBalanceMinor).toBe(rows[i - 1].closingBalanceMinor);
  });

  it("monthly closing balances equal the engine's own monthly summaries", () => {
    const rows = aggregateSchedule(projection.events, "month");
    const engine = new Map(projection.monthly.map((m) => [m.period, m.closingMinor]));
    for (const r of rows) if (engine.has(r.period)) expect(r.closingBalanceMinor).toBe(engine.get(r.period));
  });

  it("Principal is the engine's principal line; Payment, Extra and Balloon never double-count cash", () => {
    const built = simulationToModel(s);
    if (!built.ok) throw new Error("model");
    const { model } = built;
    const result = simulate({ model, anchor: { date: model.terms.openingDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: [], to: "2034-12-31" });
    if (!result.ok) throw new Error("simulate");
    const lines = result.events.filter((e) => e.type === "repayment" || e.type === "final-payment").map((e) => e.lines.filter((l) => l.kind === "principal").reduce((a, l) => a + l.amountMinor, 0));
    const principal = events.filter((r) => r.eventType === "repayment" || r.eventType === "final-payment").map((r) => r.principalMinor);
    expect(principal).toEqual(lines);
    const cashOut = projection.events.filter((e) => ["repayment", "final-payment", "extra-repayment", "balloon"].includes(e.eventType)).reduce((a, e) => a - e.cashMovementMinor, 0);
    expect(total(events, "paymentMinor") + total(events, "extraRepaymentMinor") + total(events, "balloonMinor")).toBe(cashOut);
  });
});

describe("dynamic columns", () => {
  const cols = (s: SimulationState, view: "events" | "month" = "month") => {
    const p = project(s, "2034-12-31");
    if (!p.ok) throw new Error(p.blocked[0].message);
    return scheduleColumns(aggregateSchedule(p.events, view), view);
  };

  it("a simple loan has payment sequence plus the five financial columns", () => {
    expect(cols(sim())).toEqual(["paymentNumber", "period", "payment", "principal", "interest", "balance"]);
    expect(cols(sim(), "events")).toEqual(["paymentNumber", "period", "event", "payment", "principal", "interest", "balance"]);
  });

  it.each([
    ["extras", FIXTURES[5][1], ["extra"]],
    ["fees", FIXTURES[3][1], ["fees"]],
    ["offset", FIXTURES[9][1], ["offset", "interestBearing"]],
    ["rate change", FIXTURES[10][1], ["rate"]],
    ["draw", FIXTURES[6][1], ["draw"]],
    ["negative amortization", FIXTURES[7][1], ["unpaidInterest"]],
  ] as const)("%s adds only its own column(s)", (_n, s, added) => {
    const extraCols = cols(s).filter((c) => !["paymentNumber", "period", "payment", "principal", "interest", "balance"].includes(c));
    expect(extraCols).toEqual(added);
  });

  it("an optional feature that produces nothing adds no column", () => {
    // An offset with a zero balance applies nothing: no offset columns.
    const s = sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE }, ...offsetOf(0) });
    expect(cols(s)).not.toContain("offset");
  });
});

describe("schedule labels", () => {
  it("separates repayment sequence from elapsed loan time", () => {
    const projection = project(sim({ termMonths: 3 }), "2024-05-01");
    if (!projection.ok) throw new Error(projection.blocked[0].message);
    const rows = aggregateSchedule(projection.events, "month");
    expect(rows.map(paymentNumberCell).filter(Boolean)).toEqual(["1", "2", "3"]);
    expect(schedulePeriodLabel("2024-02", "month", "2024-01-01")).toBe("Yr 1, Mo 2 · Feb 2024");
    expect(schedulePeriodLabel("2025-01", "month", "2024-01-01")).toBe("Yr 2, Mo 1 · Jan 2025");
  });
});

describe("rate display (O2)", () => {
  const rows = (s: SimulationState, view: "events" | "month" | "year") => {
    const p = project(s, "2026-12-31");
    if (!p.ok) throw new Error(p.blocked[0].message);
    return aggregateSchedule(p.events, view);
  };
  const withChange = (date: string, timing?: "from-next-charge-period") =>
    sim({ profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE, ...(timing ? { rateEffectiveTiming: timing } : {}) }, rates: [{ ...sim().rates[0] }, { ...sim().rates[0], key: "r2", accrualEffectiveFrom: date, annualRateDecimal: "0.07" }] });

  it("one rate shows that rate everywhere", () => {
    for (const r of rows(sim(), "month")) expect(rateCell(r.rates)).toBe("0.06");
  });

  it("a change at a charge boundary: each month shows a single rate", () => {
    const march = rows(withChange("2024-03-02"), "month").find((r) => r.period === "2024-03")!;
    const april = rows(withChange("2024-03-02"), "month").find((r) => r.period === "2024-04")!;
    expect(rateCell(march.rates)).toBe("0.06");
    expect(rateCell(april.rates)).toBe("0.07");
  });

  it("a mid-period change: the month whose interest spans both rates shows Multiple, never first or last", () => {
    const april = rows(withChange("2024-03-15"), "month").find((r) => r.period === "2024-04")!;
    expect(april.rates).toEqual(["0.06", "0.07"]);
    expect(rateCell(april.rates)).toBe("Multiple");
  });

  it("from-next-charge-period follows the engine, not the contract date", () => {
    const m = rows(withChange("2024-03-15", "from-next-charge-period"), "month");
    expect(rateCell(m.find((r) => r.period === "2024-04")!.rates)).toBe("0.06");
    expect(rateCell(m.find((r) => r.period === "2024-05")!.rates)).toBe("0.07");
  });

  it("a year containing a change shows Multiple", () => {
    expect(rateCell(rows(withChange("2024-03-15"), "year").find((r) => r.period === "2024")!.rates)).toBe("Multiple");
    expect(rateCell(rows(withChange("2024-03-15"), "year").find((r) => r.period === "2025")!.rates)).toBe("0.07");
  });
});

describe("principal terminology (O5)", () => {
  it("Principal when interest is charged with the repayment; Debt reduction when charged separately", () => {
    expect(principalLabel(sim().profile)).toEqual({ label: "Principal", help: null });
    expect(principalLabel({ chargeFrequency: "monthly" })).toMatchObject({ label: "Debt reduction", help: expect.stringMatching(/charged separately/) });
  });

  it("the projection window covers the whole loan", () => {
    expect(projectionWindow(sim())).toEqual({ from: "2024-01-01", to: "2054-02-01" });
  });
});
