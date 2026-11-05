import { summarizeLoanEvents } from "./loanSummaryEvents";

const event = (date: string, before: number, after: number, eventType = "repayment") => ({ date, eventType, balanceBeforeMinor: before, balanceAfterMinor: after, cashMovementMinor: before > after ? after - before : 0, interestMinor: 0, principalMovementMinor: after - before, feesMinor: 0 }) as never;
const run = (events: never[]) => summarizeLoanEvents(events, { today: "2026-06-15", forecastFrom: "2026-01-01", paidOffOn: null, startingPrincipalMinor: 100_000 });

describe("a loan's payoff date", () => {
  it("is the date the balance reached zero, when it stays there", () => {
    expect(run([event("2026-01-01", 100_000, 50_000), event("2026-07-01", 50_000, 0, "final-payment")]).payoffDate).toBe("2026-07-01");
  });

  it("is the last time the balance reached zero, not the first", () => {
    const events = [event("2026-01-01", 100_000, 0, "final-payment"), event("2026-02-01", 0, 80_000, "draw"), event("2026-09-01", 80_000, 0, "final-payment")];
    expect(run(events).payoffDate).toBe("2026-09-01");
  });

  it("is none when the loan is drawn on again after reaching zero and is still owed", () => {
    const events = [event("2026-01-01", 100_000, 0, "final-payment"), event("2026-02-01", 0, 80_000, "draw")];
    expect(run(events).payoffDate).toBeNull();
  });
});

describe("a paid-off loan's past figures", () => {
  it("count only what has happened by today, never an event scheduled after it", () => {
    const events = [event("2026-01-01", 100_000, 50_000), event("2026-05-01", 50_000, 0, "final-payment"), event("2026-08-01", 0, 0, "repayment")];
    const summary = summarizeLoanEvents(events, { today: "2026-06-15", forecastFrom: "2026-01-01", paidOffOn: "2026-05-01", startingPrincipalMinor: 100_000 });
    expect(summary.paymentsMade).toBe(2);
  });
});
