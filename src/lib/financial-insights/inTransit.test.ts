import { explainInTransit, type TransferRow } from "./inTransit";

const money = (n: number) => (n / 100).toFixed(2);
const period = { startDate: "2026-01-01", endDate: "2026-10-31" };
const row = (id: string, amountMinor: number, transferId: string | null, extra: Partial<TransferRow> = {}): TransferRow => ({ id, date: "2026-03-05", accountId: "a", amountMinor, transferId, counterpartAccountId: "b", ...extra });

describe("financial insights: why a transfer is in transit", () => {
  it("leaves out a pair that cancels exactly, even across months, so the listed rows add up to the amount", () => {
    const r = explainInTransit([row("1", -5000, "2"), row("2", 5000, "1", { accountId: "b", counterpartAccountId: "a", date: "2026-04-01" })], new Map(), period, money, new Set());
    expect(r).toEqual({ ids: [], reasons: {}, totalMinor: 0 });
  });

  it("lists both sides of a pair whose amounts differ, saying only what is recorded", () => {
    const r = explainInTransit([row("1", -500000, "2"), row("2", 430000, "1", { accountId: "b", counterpartAccountId: "a" })], new Map(), period, money, new Set());
    expect(r.ids.sort()).toEqual(["1", "2"]);
    expect(r.totalMinor).toBe(-70000);
    expect(r.reasons["1"]).toBe("Both sides are recorded in the period, but the amounts differ: -5000.00 here and 4300.00 on the other side, -700.00 left over.");
    expect(r.reasons["2"]).toContain("4300.00 here and -5000.00 on the other side");
    expect(r.reasons["1"]).not.toMatch(/currency|FX|fee/i);
  });

  it("names a missing counterpart, a counterpart outside the period and one that cannot be found", () => {
    const rows = [row("1", -1000, null), row("2", -2000, "x"), row("3", -3000, "y"), row("4", -4000, "z")];
    const others = new Map([["x", { date: "2025-12-30", accountId: "b", amountMinor: 2000 }], ["z", { date: "2026-05-05", accountId: "q", amountMinor: 4000 }]]);
    const r = explainInTransit(rows, others, period, money, new Set());
    expect(r.reasons["1"]).toMatch(/No other side is recorded/);
    expect(r.reasons["2"]).toBe("The other side is dated 30 Dec 2025, outside the period.");
    expect(r.reasons["3"]).toMatch(/could not be found/);
    expect(r.reasons["4"]).toMatch(/not part of this view/);
    expect(r.totalMinor).toBe(-10000);
  });

  it("leaves out a transfer whose other side is an excluded account (it has its own line)", () => {
    const r = explainInTransit([row("1", -1000, null, { counterpartAccountId: "scratch" })], new Map(), period, money, new Set(["scratch"]));
    expect(r.ids).toEqual([]);
  });
});
