import { formatElapsed } from "../components/chart/chartMeta";
import { chartSeries, monthsElapsed, withTracking, type ChartData } from "./results";
import { project, sim } from "./simulatorTestKit";

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
    expect(march.repaidPercent).toBe(Math.round((1 - march.balance! / 40_000_000) * 100));
    expect(march.repaidPercent).toBeGreaterThanOrEqual(3);
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
