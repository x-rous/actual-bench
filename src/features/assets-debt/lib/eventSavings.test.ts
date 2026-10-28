import { projectDebt } from "@/lib/financial-models/loan/projection";
import { formatSaving, ledgerChain, savingBetween, whatIfChain, chainOf } from "./eventSavings";
import { headline, type Headline } from "./results";
import { simulationToModel, projectionWindow, type SimAssumption, type SimulationState } from "./simulatorModel";
import { sim } from "./simulatorTestKit";

const h = (p: Partial<Headline>): Headline => ({ regularRepaymentMinor: 100_00, repaymentChanges: false, totalRepaidMinor: 0, totalInterestMinor: 0, payoffDate: "2030-01-01", closingBalanceMinor: 0, ...p });
const extra = (key: string, date: string, amountMinor: number, patch: Partial<SimAssumption> = {}): SimAssumption => ({ key, kind: "extra-repayment", effectiveFrom: date, recurrence: null, amountMinor, feeTreatment: null, offsetAccountId: null, note: null, ...patch });

function head(s: SimulationState): Headline {
  const built = simulationToModel(s);
  if (!built.ok) throw new Error("not ok");
  const w = projectionWindow(s);
  const p = projectDebt({ model: built.model, anchor: { date: built.model.terms.openingDate, principalMinor: built.model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: [], from: w.from, to: w.to });
  if (!p.ok) throw new Error("projection failed");
  return headline(p.events);
}

describe("what each event saves", () => {
  it("says it in words: saved, added, earlier, later, or a lower repayment", () => {
    expect(formatSaving(savingBetween(h({ totalInterestMinor: 5_000_00, payoffDate: "2030-03-01" }), h({ totalInterestMinor: 3_137_60, payoffDate: "2030-02-01" })), 2)).toBe("1,862.40 · 1 mo");
    expect(formatSaving(savingBetween(h({ totalInterestMinor: 100_00 }), h({ totalInterestMinor: 90_00, payoffDate: "2029-12-25" })), 2)).toBe("10.00 · under 1 mo");
    expect(formatSaving(savingBetween(h({ totalInterestMinor: 100_00 }), h({ totalInterestMinor: 1_340_00, payoffDate: "2030-03-02" })), 2)).toBe("adds 1,240.00 · 2 mo later");
    expect(formatSaving(savingBetween(h({ totalInterestMinor: 2_000_00 }), h({ totalInterestMinor: 760_00, regularRepaymentMinor: 47_90 })), 2)).toBe("1,240.00 · repayment −52.10");
    expect(formatSaving(savingBetween(h({ payoffDate: "2040-07-01" }), h({ payoffDate: "2037-03-01" })), 2)).toBe("3 yr 4 mo");
    expect(formatSaving(savingBetween(h({}), h({})), 2)).toBe("No change");
  });

  it("credits what-ifs in date order, each on top of the earlier ones, so the rows add up to the total", () => {
    const loan = sim({ termMonths: 120, principalMinor: 20_000_000, assumptions: [extra("late", "2027-06-01", 1_000_000), extra("early", "2025-03-01", 1_000_000), extra("off", "2026-01-01", 500_000, { enabled: false })] });
    const chain = whatIfChain(loan, null);
    expect(chain.events.map((e) => e.key)).toEqual(["early", "late"]);
    const heads = [head(chain.base), ...chainOf(chain.base, chain.events).map(head)];
    const rows = chain.events.map((_, k) => savingBetween(heads[k], heads[k + 1]));
    const total = savingBetween(heads[0], heads.at(-1)!);
    expect(rows.every((r) => r.interestMinor > 0)).toBe(true);
    expect(rows[0].interestMinor + rows[1].interestMinor).toBe(total.interestMinor);
    // The earlier payment saves more interest than the same amount paid later.
    expect(rows[0].interestMinor).toBeGreaterThan(rows[1].interestMinor);
    // The last step is the projection with every what-if: the same as the full simulation without the switched-off one.
    expect(heads.at(-1)!.totalInterestMinor).toBe(head(loan).totalInterestMinor);
  });

  it("a tracked loan only credits what-ifs after the projection's start, and Loan Ledger rows on the contract", () => {
    const loan = sim({ assumptions: [extra("before", "2024-06-01", 100_000), extra("after", "2025-06-01", 100_000)] });
    expect(whatIfChain(loan, "2025-01-01").events.map((e) => e.key)).toEqual(["after"]);
    const ledger = ledgerChain(loan, "2025-01-01", [
      { date: "2025-03-01", kind: "draw", amountMinor: 50_000, rowId: "d" },
      { date: "2025-02-01", kind: "extra-principal", amountMinor: 200_000, rowId: "x" },
      { date: "2025-04-01", kind: "interest-charged", amountMinor: 1_000, rowId: "i" },
    ]);
    expect(ledger.base.assumptions.map((a) => a.key)).toEqual(["before"]);
    expect(ledger.events.map((e) => [e.rowId, e.kind])).toEqual([["x", "extra-repayment"], ["d", "draw"]]);
  });
});
