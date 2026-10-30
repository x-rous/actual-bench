import { toCsv } from "@/lib/csv";
import { loanExportFilename, loanExportRows } from "./loanExport";
import { project, sim } from "./simulatorTestKit";
import { aggregateSchedule } from "./schedule";

it("exports the current loan details, events and every schedule row in all three views", () => {
  const loan = sim({ termMonths: 12, assumptions: [{ key: "extra", kind: "extra-repayment", effectiveFrom: "2024-04-10", recurrence: null, amountMinor: 100_000, feeTreatment: null, offsetAccountId: null, note: "=example" }] });
  const projection = project(loan);
  if (!projection.ok) throw new Error("projection blocked");
  const rows = loanExportRows({ sim: loan, events: projection.events, name: "Home loan", today: "2026-10-30", generatedAt: "30/10/2026, 12:34:56", revision: 3, unsaved: true });
  expect(rows[0]).toEqual(["Generated on 30/10/2026, 12:34:56 - Actual-Bench"]);
  const section = (name: string) => {
    const start = rows.findIndex((r) => r[0] === name);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = rows.findIndex((r, i) => i > start && r.length === 0);
    return rows.slice(start + 1, end === -1 ? undefined : end);
  };
  expect(section("Loan report")).toContainEqual(["Loan", "Home loan"]);
  expect(section("Loan report")).toContainEqual(["Unsaved changes", "Yes"]);
  expect(section("Loan inputs and terms")).toContainEqual(["Loan amount", "400000.00"]);
  expect(section("Extra events and assumptions")).toContainEqual(expect.arrayContaining(["2024-04-10", "Extra repayment", "1000.00", "=example"]));
  for (const [view, title] of [["events", "all events"], ["month", "monthly"], ["year", "yearly"]] as const) {
    const exported = section(`Amortization schedule - ${title}`);
    const expected = aggregateSchedule(projection.events, view);
    expect(exported).toHaveLength(expected.length + 1);
    expect(exported[1][1]).toBe(expected[0].period);
    expect(exported.at(-1)?.at(-1)).toBe((expected.at(-1)!.closingBalanceMinor / 100).toFixed(2));
  }
  expect(toCsv(rows)).toContain("'=example");
  expect(loanExportFilename("Home loan", "2026-10-30")).toBe("home-loan-calculation-2026-10-30.csv");
});

it("exports revolving payment terms and the same event names shown in the schedule", () => {
  const loan = sim({ shape: "revolving-credit", revolving: { paymentModel: "percent-of-balance", percentOfBalanceBps: 250, minimumFloorMinor: 5000 } });
  const projection = project(sim());
  if (!projection.ok) throw new Error("projection blocked");
  const template = projection.events[0];
  const events = [{ ...template, eventType: "interest-charge" as const }, { ...template, eventType: "negative-amortization" as const }];
  const rows = loanExportRows({ sim: loan, events, name: "Credit", today: "2026-10-30", generatedAt: "now", revision: null, unsaved: true });
  expect(rows).toContainEqual(["Minimum payment model", "Percent of balance"]);
  expect(rows).toContainEqual(["Share of balance (%)", 2.5]);
  expect(rows).toContainEqual(["Minimum amount", "50.00"]);
  expect(rows.some((row) => row[3] === "Interest charged")).toBe(true);
  expect(rows.some((row) => row[3] === "Unpaid interest added")).toBe(true);
});
