import type { ApplyPlan } from "../apply/operations";
import { balanceAsOf, checkClosingBalance, planEffectOn, storedClosingBalance } from "./closingBalance";

const statement = { amount: -120000, asOf: "2026-01-31", source: "closing-line" as const, polarity: "liability" as const, polarityDetected: false };

describe("the statement's closing balance against Actual", () => {
  it("works the balance back to the closing date from today's balance", () => {
    expect(balanceAsOf(-150000, [
      { amount: -20000, date: "2026-02-03" },
      { amount: -10000, date: "2026-02-10" },
      { amount: -5000, date: "2026-01-31" },
      { amount: -999, date: "2026-02-03", isChild: true },
    ], "2026-01-31")).toBe(-120000);
  });

  it("counts creates, deletes, corrections and date moves across the closing date", () => {
    const plan = { operations: [
      { kind: "create", date: "2026-01-30", amount: -2500 },
      { kind: "create", date: "2026-02-02", amount: -9999 },
      { kind: "delete", date: "2026-01-12", amount: -1000 },
      { kind: "update", date: "2026-01-20", amount: -4000, patch: { amount: { original: -4000, staged: -4250, source: "manual" } } },
      { kind: "update", date: "2026-01-31", amount: -300, patch: { date: { original: "2026-01-31", staged: "2026-02-01", source: "manual" } } },
    ] } as unknown as Pick<ApplyPlan, "operations">;
    expect(planEffectOn(plan, "2026-01-31")).toBe(-2500 + 1000 - 250 + 300);
  });

  it("reconciles when the writes close the gap", () => {
    const plan = { operations: [{ kind: "create", date: "2026-01-30", amount: -2500 }] } as unknown as Pick<ApplyPlan, "operations">;
    const check = checkClosingBalance({ statement, actualNow: -117500, plan });
    expect(check).toMatchObject({ afterApply: -120000, difference: 0, reconciles: true });
    expect(checkClosingBalance({ statement, actualNow: -117000, plan }).difference).toBe(-500);
  });

  it("reads a stored figure back defensively", () => {
    expect(storedClosingBalance({ rowCount: 3, closingBalance: statement })).toEqual(statement);
    expect(storedClosingBalance({ closingBalance: { ...statement, amount: 1.5 } })).toBeNull();
    expect(storedClosingBalance(null)).toBeNull();
  });
});
