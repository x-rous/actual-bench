import { projectDebt } from "@/lib/financial-models/loan/projection";
import { inputFor } from "./useLiveProjection";
import { project, sim } from "./simulatorTestKit";

/** A loan whose third installment (due 2024-04-01) was paid a week early, on 2024-03-25. */
describe("a tracked loan's projection after an installment paid before its due date", () => {
  const s = sim();
  const contract = project(s);
  if (!contract.ok) throw new Error("the sample loan does not calculate");
  const repayments = (events: readonly { eventType: string; date: string; balanceAfterMinor: number; cashMovementMinor: number }[]) =>
    events.filter((e) => e.eventType === "repayment" || e.eventType === "final-payment");
  const paid = repayments(contract.events);
  const third = paid[2];
  const anchor = { date: "2024-03-25", principalMinor: third.balanceAfterMinor, scheduledPaymentMinor: Math.abs(third.cashMovementMinor) };
  const run = (extra: { restartDate?: string; accruedInterestMinor?: number }) => {
    const input = inputFor(s, undefined, { mode: "projection", at: { startDate: "2024-02-01", anchor: { ...anchor, ...extra } } });
    if (!input) throw new Error("no input");
    const result = projectDebt(input);
    if (!result.ok) throw new Error("blocked");
    return repayments(result.events);
  };

  it("restarts from the covered due date, so the next projected payment is the fourth installment and the loan ends when the contract does", () => {
    const projected = run({ restartDate: "2024-04-01", accruedInterestMinor: 2_500 });
    expect(third.date).toBe("2024-04-01");
    expect(projected[0].date).toBe(paid[3].date);
    expect(projected.at(-1)!.date).toBe(paid.at(-1)!.date);
    expect(projected).toHaveLength(paid.length - 3);
  });

  it("without the restart, the engine would schedule the covered due date again (the bug this guards against)", () => {
    expect(run({})[0].date).toBe("2024-04-01");
  });
});
