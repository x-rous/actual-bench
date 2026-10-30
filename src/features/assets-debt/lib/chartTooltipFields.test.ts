import { formatElapsed } from "../components/chart/chartMeta";
import { chartSeries, headline, monthsElapsed, withTracking, type ChartData } from "./results";
import { newSimulation } from "./simulatorModel";
import { DAILY_MONTHLY_CHARGE, offsetOf, project, sim } from "./simulatorTestKit";

describe("the loan chart's installment and elapsed time", () => {
  it("counts whole months from the loan's start to the end of a month or a year", () => {
    expect(monthsElapsed("2023-10-25", "2023-10")).toBe(0);
    expect(monthsElapsed("2023-10-25", "2023-12")).toBe(2);
    expect(monthsElapsed("2023-10-25", "2026-10")).toBe(36);
    expect(monthsElapsed("2023-10-25", "2026")).toBe(38);
    // From the 31st, the end of a shorter month is not yet a full month later.
    expect(monthsElapsed("2024-01-31", "2024-02")).toBe(0);
  });

  it("reads like 3 years, 2 months", () => {
    expect(formatElapsed(0)).toBe("Less than a month");
    expect(formatElapsed(5)).toBe("5 months");
    expect(formatElapsed(12)).toBe("1 year");
    expect(formatElapsed(38)).toBe("3 years, 2 months");
    expect(formatElapsed(13)).toBe("1 year, 1 month");
  });

  it("puts the installment number and elapsed months on each chart point", () => {
    const s = sim();
    const projection = project(s);
    const monthly = chartSeries(projection, s, { view: "month" }).points;
    // The loan starts 2024-01-01; its first repayment is 2024-02-01, so April holds installment 3, three months in.
    expect(monthly.find((p) => p.period === "2024-04")).toMatchObject({ installment: 3, elapsedMonths: 3 });
    const yearly = chartSeries(projection, s, { view: "year" }).points;
    expect(yearly.find((p) => p.period === "2024")).toMatchObject({ installment: 11, elapsedMonths: 11 });
  });

  it("keeps the opening balance and offset distinct from the first yearly result", () => {
    const s = sim({ ...offsetOf(5_000_000), profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE } });
    const points = chartSeries(project(s), s, { view: "year" }).points;
    expect(points[0]).toMatchObject({ openingDate: "2024-01-01", balance: 40_000_000, offsetBalance: 5_000_000, interestBearing: 35_000_000 });
    expect(points[1].period).toBe("2024");
    expect(points[1].balance).toBeLessThan(40_000_000);
    expect(points[1].balanceDate).toMatch(/^2024-/);
  });

  it("shows small balance reductions to one decimal place", () => {
    const s = sim();
    const projection = project(s);
    if (!projection.ok) throw new Error("blocked");
    const events = [{ ...projection.events[0], balanceAfterMinor: 39_840_000 }];
    const point = chartSeries({ ...projection, events }, s, { view: "month" }).points.find((p) => !p.openingDate);
    expect(point?.repaidPercent).toBe(0.4);
  });

  it("uses the engine's offset rules for the opening interest basis and does not add an offset-only start point", () => {
    const offset = offsetOf(5_000_000);
    const s = sim({ ...offset, offsets: offset.offsets.map((link) => ({ ...link, percentageBps: 5_000, capMinor: 1_000_000 })), profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE } });
    const points = chartSeries(project(s), s, { view: "month" }).points;
    expect(points[0].interestBearing).toBe(39_000_000);
    expect(points.filter((point) => point.period === "2024-01" && point.balance === undefined)).toHaveLength(0);
  });

  it("represents the 550,000 loan with a 300,000 starting offset", () => {
    const offset = offsetOf(30_000_000);
    const s = { ...newSimulation({ currency: "AED", today: "2025-10-01" }), principalMinor: 55_000_000, termMonths: 300,
      offsets: offset.offsets.map((link) => ({ ...link, effectiveFrom: "2025-10-01" })),
      assumptions: offset.assumptions.map((event) => ({ ...event, effectiveFrom: "2025-10-01" })) };
    const projection = project(s);
    if (!projection.ok) throw new Error("blocked");
    expect(headline(projection.events)).toMatchObject({ regularRepaymentMinor: 334_471, totalInterestMinor: 5_547_158, payoffDate: "2040-12-01" });
    for (const view of ["month", "year"] as const) {
      const points = chartSeries(projection, s, { view }).points;
      expect(points[0]).toMatchObject({ date: "2025-10-01", balance: 55_000_000, offsetBalance: 30_000_000, interestBearing: 25_000_000 });
      expect(points[1].date).toBe(view === "month" ? "2025-11-01" : "2025-12-01");
    }
  });

  it("marks mixed event sources in the same period and adds the existing what-if baseline", () => {
    const s = sim({ assumptions: [{ key: "x", kind: "extra-repayment", effectiveFrom: "2024-03-01", recurrence: null, amountMinor: 1_000_000, feeTreatment: null, offsetAccountId: null, note: null }] });
    const current = project(s);
    if (!current.ok) throw new Error("blocked");
    const events = current.events.map((e, i) => ({ ...e, diagnostics: { ...e.diagnostics, chartSource: i % 2 ? "actual" : "projected" } }));
    const data = chartSeries({ ...current, events }, s, { view: "year", baseline: project(sim()) });
    expect(data.series).toContain("baseline");
    expect(data.points.find((point) => point.period === "2024")?.sources).toEqual(expect.arrayContaining(["actual", "projected"]));
    expect(data.points.find((point) => point.period === "2024")?.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "extra-repayment", date: "2024-03-01" })]));
  });

  it("marks a repayment change even though it is not a projection event", () => {
    const s = sim({ assumptions: [{ key: "payment", kind: "payment-change", effectiveFrom: "2024-03-15", recurrence: null, amountMinor: 300_000, feeTreatment: null, offsetAccountId: null, note: null }] });
    const points = chartSeries(project(s), s, { view: "month" }).points;
    expect(points.find((point) => point.period === "2024-03")?.events).toEqual(expect.arrayContaining([{ date: "2024-03-15", type: "payment-change" }]));
  });

  it("gives the payment in the period, the interest in it, extra payments and how much is repaid", () => {
    const s = sim({ assumptions: [{ key: "x", kind: "extra-repayment", effectiveFrom: "2024-03-01", recurrence: null, amountMinor: 1_000_000, feeTreatment: null, offsetAccountId: null, note: null }] });
    const points = chartSeries(project(s), s, { view: "month" }).points;
    const march = points.find((p) => p.period === "2024-03")!;
    expect(march.paymentMinor).toBe(239_820);
    expect(march.paymentInterestMinor).toBeGreaterThan(0);
    expect(march.paymentInterestMinor).toBeLessThan(march.paymentMinor!);
    expect(march.extraMinor).toBe(1_000_000);
    expect(points.find((p) => p.period === "2024-02")!.extraMinor).toBeUndefined();
    // Repaid share of the 400,000 opening principal after the extra payment: a little over 2.5%.
    expect(march.repaidPercent).toBe(Math.round((1 - march.balance! / 40_000_000) * 1000) / 10);
    expect(march.repaidPercent).toBeGreaterThanOrEqual(2.5);
  });

  it("uses the repayment allocation lines and refuses an incomplete split", () => {
    const s = sim();
    const projection = project(s);
    if (!projection.ok) throw new Error("blocked");
    const event = projection.events.find((e) => e.eventType === "repayment")!;
    const data = chartSeries({ ...projection, events: [event] }, s, { view: "month" });
    const point = data.points.find((p) => p.paymentMinor !== undefined)!;
    expect(Object.values(point.paymentBreakdown!).reduce((a, b) => a + b, 0)).toBe(point.paymentMinor);
    const incomplete = chartSeries({ ...projection, events: [{ ...event, lines: undefined }] }, s, { view: "month" });
    expect(incomplete.points.find((p) => p.paymentMinor !== undefined)?.paymentBreakdown).toBeNull();
  });

  it("marks where a tracked loan's figures come from: the contract, Actual, or the projection", () => {
    const data = { points: [{ period: "2023-10" }, { period: "2024-01" }, { period: "2026-10" }, { period: "2026-11" }], series: ["balance"], rateChanges: [], payoff: null } as unknown as ChartData;
    const points = withTracking(data, { startDate: "2023-12-01", today: "2026-10-29", actual: [], anchor: { date: "2026-10-22" } }, "month").points;
    expect(points.map((p) => p.source)).toEqual(["contract", "actual", "actual", "projected"]);
  });

  it("marks the periods that hold an event from Actual, so a point is labelled by its own content", () => {
    const s = sim();
    const projection = project(s);
    if (!projection.ok) throw new Error("blocked");
    const events = projection.events.map((e) => (e.date.startsWith("2024-03") ? { ...e, diagnostics: { ...e.diagnostics, fromActual: true } } : e));
    const points = chartSeries({ ...projection, events }, s, { view: "month" }).points;
    expect(points.find((p) => p.period === "2024-03")?.fromActual).toBe(true);
    expect(points.find((p) => p.period === "2024-02")?.fromActual).toBeUndefined();
  });
});
