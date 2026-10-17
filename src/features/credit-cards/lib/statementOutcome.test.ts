import { statementOutcome } from "./paymentSummary";
import { statementScenario } from "./statementScenarios.fixture";
import type { Settlement } from "./repayments";

it.each(["full", "late", "carry"] as const)("uses the RD098 %s scenario's confirmed timing and carried balances", (kind) => {
  const scenario = statementScenario(kind);
  const statements = scenario.rows.filter((row) => row.officialBalanceMinor > 0);
  const displays = statements.map((statement) => statementOutcome(statement, scenario.statuses.find((entry) => entry.statementId === statement.id), "2026-10-15", true));
  if (kind !== "carry") expect(displays.filter((display) => display.paid).every((display) => !/(Paid in full|Minimum paid)/.test(display.timing))).toBe(true);
  if (kind === "full") {
    expect(displays.every((display) => display.label === "Paid in full" && display.marker === "on-time" && !display.carried)).toBe(true);
  } else if (kind === "late") {
    expect(displays.filter((display) => display.label === "Paid in full · late")).toHaveLength(10);
    expect(displays.at(-1)).toMatchObject({ label: "Minimum overdue", marker: "overdue", timing: "14 days overdue · unpaid" });
    expect(displays.filter((display) => display.paid && display.carried).every((display) => display.late)).toBe(true);
  } else {
    expect(displays.every((display) => display.label === "Minimum paid · carried" && display.marker === "partial" && !display.paid)).toBe(true);
    expect(displays.every((display) => !/(Paid in full|Minimum paid)/.test(display.timing))).toBe(true);
  }
});

const base = () => {
  const scenario = statementScenario("full");
  const statement = scenario.rows.find((row) => row.officialBalanceMinor > 0)!;
  const payment = scenario.statuses.find((row) => row.statementId === statement.id)!;
  return { statement, payment };
};

it("separates bank confirmation, incomplete source, baseline and actual zero statements", () => {
  const { statement, payment } = base();
  expect(statementOutcome(statement, undefined, "2026-10-15", true).label).toBe("Payment history incomplete");
  expect(statementOutcome(statement, payment, "2026-10-15", false).label).toBe("Payment data unavailable");
  expect(statementOutcome({ ...statement, bankConfirmed: false }, payment, "2026-10-15", true).label).toBe("Estimated");
  expect(statementOutcome(statement, payment, "2026-10-15", true, true).label).toBe("Starting point");
  expect(statementOutcome({ ...statement, officialBalanceMinor: 0 }, payment, "2026-10-15", true).label).toBe("No payment required");
  expect(statementOutcome({ ...statement, officialBalanceMinor: -1000 }, payment, "2026-10-15", true).label).toBe("Card credit");
});

it("does not infer success from pending transfers or credits that leave the minimum unpaid", () => {
  const { statement, payment } = base();
  const pending: Settlement = { ...payment, confirmedPaidMinor: 0, provisionalMinor: statement.officialBalanceMinor, confirmedPaidDate: null, confirmedMinimumPaidDate: null, debtCarriedAtDueMinor: null };
  expect(statementOutcome(statement, pending, "2025-11-02", true)).toMatchObject({ label: "Minimum overdue", marker: "overdue", timing: "1 day overdue · clearance pending" });
  const credits = { ...pending, provisionalMinor: 0, confirmedCreditMinor: statement.officialBalanceMinor, confirmedPaidDate: statement.dueDate };
  expect(statementOutcome(statement, credits, "2025-11-02", true).label).toBe("Minimum overdue");
  const paidMinimum = { ...credits, confirmedPaidMinor: statement.minimumDueMinor, confirmedMinimumPaidDate: statement.dueDate, fullByDue: true, debtCarriedAtDueMinor: 0 };
  expect(statementOutcome(statement, paidMinimum, "2025-11-02", true)).toMatchObject({ label: "Minimum paid · carried", marker: "partial", paid: false });
});

it("preserves late minimums, zero minimums, missing payment dates and future partial payments", () => {
  const { statement, payment } = base();
  const partial = { ...payment, confirmedPaidMinor: statement.minimumDueMinor, recordedDebtRemainingMinor: statement.officialBalanceMinor - statement.minimumDueMinor, confirmedPaidDate: null, confirmedMinimumPaidDate: "2025-11-04", minimumByDue: false, debtCarriedAtDueMinor: statement.officialBalanceMinor };
  expect(statementOutcome(statement, partial, "2025-11-06", true)).toMatchObject({ label: "Minimum paid late", marker: "late" });
  expect(statementOutcome({ ...statement, minimumDueMinor: 0 }, { ...partial, confirmedPaidMinor: 0, confirmedMinimumPaidDate: null }, "2025-11-06", true)).toMatchObject({ label: "Balance carried", marker: "overdue" });
  expect(statementOutcome(statement, { ...payment, confirmedPaidDate: null, fullByDue: null }, "2025-11-06", true)).toMatchObject({ marker: "unknown", timing: "Timing unknown" });
  expect(statementOutcome({ ...statement, dueDate: "2025-11-20" }, { ...partial, confirmedPaidMinor: 500, confirmedMinimumPaidDate: null, debtCarriedAtDueMinor: null }, "2025-11-06", true)).toMatchObject({ label: "Part paid", marker: "partial", countdown: "in 14 days" });
});
