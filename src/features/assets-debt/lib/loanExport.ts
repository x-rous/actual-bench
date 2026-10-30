import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import { aggregateSchedule, paymentNumberCell, scheduleEventLabel, schedulePeriodLabel, type ScheduleView } from "./schedule";
import { headline } from "./results";
import { derivedFirstPaymentDate, type SimulationState } from "./simulatorModel";
import type { TrackedHistory } from "./trackedSchedule";
import { fractionToPercent } from "./money";

type ExportInput = {
  sim: SimulationState;
  events: readonly DebtProjectionEvent[];
  name: string;
  today: string;
  generatedAt: string;
  revision: number | null;
  unsaved: boolean;
  tracked?: TrackedHistory | null;
  source?: (period: string, paymentNumber: number | null) => string;
};

/** Export the displayed calculation, including every row, rather than the virtualized viewport. */
export function loanExportRows({ sim, events, name, today, generatedAt, revision, unsaved, tracked, source }: ExportInput): unknown[][] {
  const amount = (value: number | null | undefined) => value == null ? "" : (value / 10 ** sim.minorDigits).toFixed(sim.minorDigits);
  const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
  const value = (v: unknown): string => v == null ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  const rows: unknown[][] = [[`Generated on ${generatedAt} - Actual-Bench`]];
  const section = (name: string, header?: unknown[]) => { if (rows.length) rows.push([]); rows.push([name]); if (header) rows.push(header); };
  const metric = headline(events);
  section("Loan report");
  rows.push(["Loan", name || "New loan"], ["Exported on", today], ["Currency", sim.currency], ["Saved revision", revision ?? "Not saved"], ["Unsaved changes", unsaved ? "Yes" : "No"], ["Tracking", tracked ? "Tracked in Actual" : "Simulation"]);
  section("Headline results");
  rows.push(["Repayment frequency", label(sim.profile.repaymentFrequency)], ["Regular repayment", amount(metric.regularRepaymentMinor)], ["Total repayments", amount(metric.totalRepaidMinor)], ["Total interest", amount(metric.totalInterestMinor)], ["Payoff date", metric.payoffDate ?? "Not within the term"]);
  section("Loan inputs and terms");
  rows.push(["Loan type", label(sim.shape)], ["Loan amount", amount(sim.principalMinor)], ["Start date", sim.startDate], ["Amortization term (months)", sim.termMonths], ["Contract term (months)", sim.contractTermMonths], ["Contract maturity date", sim.maturityDate], ["First repayment date (entered)", sim.firstPaymentDate], ["First repayment date (effective)", derivedFirstPaymentDate(sim)], ["First interest charge", sim.firstInterestChargeDate], ["Contract repayment amount", amount(sim.contractualPaymentMinor)], ["Credit limit", amount(sim.creditLimitMinor)], ["Interest-only enabled", value(sim.interestOnly)]);
  if (sim.shape === "revolving-credit" && sim.revolving) rows.push(["Minimum payment model", label(sim.revolving.paymentModel)], ["Share of balance (%)", sim.revolving.percentOfBalanceBps == null ? "" : sim.revolving.percentOfBalanceBps / 100], ["Minimum amount", amount(sim.revolving.minimumFloorMinor)]);
  section("Calculation settings", ["Setting", "Value"]);
  for (const [key, item] of Object.entries(sim.profile)) {
    if ((key === "rounding" || key === "eventOrder") && typeof item === "object" && item !== null) {
      for (const [sub, entry] of Object.entries(item)) rows.push([`${label(key)}: ${label(sub)}`, typeof entry === "object" && entry !== null ? JSON.stringify(entry) : value(entry)]);
    } else rows.push([label(key), value(item)]);
  }
  rows.push(["Business-day adjustment", sim.businessDays?.adjustment ?? "none"], ["Non-business weekdays", sim.businessDays?.nonBusinessWeekdays.join(", ") ?? ""], ["Holidays", sim.businessDays?.holidays.join(", ") ?? ""], ["Lender statement interest allocation", sim.lenderStatement?.interestAllocation ?? "as-calculated"]);
  section("Rates", ["Effective from", "Annual rate (%)", "Payment recalc", "Payment effective from", "Rate floor", "Rate cap", "Payment cap", "Announced", "Source", "Notes"]);
  for (const rate of sim.rates) rows.push([rate.accrualEffectiveFrom, fractionToPercent(rate.annualRateDecimal), rate.paymentRecalcPolicy, rate.paymentEffectiveFrom, rate.rateFloorDecimal, rate.rateCapDecimal, rate.paymentCap ? JSON.stringify(rate.paymentCap) : "", rate.announcedAt, rate.source, rate.note]);
  section("Interest-only periods", ["From", "To", "Recast at end"]);
  if (sim.interestOnly) for (const phase of sim.phases) rows.push([phase.from, phase.to, phase.recastAtEnd]);
  section("Repayment recast dates", ["Date", "Notes"]);
  for (const recast of sim.paymentRecasts) rows.push([recast.date, recast.note]);
  section("Costs", ["Type", "Amount rule", "Amount", "Treatment"]);
  for (const cost of sim.components) rows.push([label(cost.economicKind), label(cost.amountRule), amount(cost.fixedAmountMinor), cost.treatment]);
  section("Offsets", ["Offset", "From", "To", "Percentage (basis points)", "Balance basis", "Cap", "Fund repayments", "Funding from", "Use Actual balance"]);
  sim.offsets.forEach((offset, i) => rows.push([`Offset ${i + 1}`, offset.effectiveFrom, offset.effectiveTo, offset.percentageBps, offset.basis, amount(offset.capMinor), value(offset.fundScheduledRepayments), offset.fundScheduledRepaymentsFrom, value(offset.useActualBalance)]));
  section("Extra events and assumptions", ["Date", "Type", "Amount", "Recurring", "Until", "Treatment", "Offset", "Enabled", "Notes"]);
  for (const event of sim.assumptions) {
    const offsetIndex = sim.offsets.findIndex((o) => o.placeholderAccountId === event.offsetAccountId);
    rows.push([event.effectiveFrom, label(event.kind), amount(event.amountMinor), event.recurrence?.frequency, event.recurrence?.until, event.feeTreatment, event.offsetAccountId ? (offsetIndex < 0 ? "Unavailable offset" : `Offset ${offsetIndex + 1}`) : "", value(event.enabled !== false), event.note]);
  }
  if (tracked) {
    section("Tracking", ["Field", "Value"]);
    rows.push(["Tracked from", tracked.startDate], ["History through", tracked.anchor.date], ["Projection restart", tracked.anchor.restartDate], ["Missing due dates", tracked.missingDueDates.join(", ")]);
    section("Events from Actual", ["Date", "Type", "Amount", "Payee", "Notes"]);
    for (const e of tracked.ledgerEvents) rows.push([e.date, label(e.kind), amount(e.amountMinor), e.payee, e.notes]);
  }
  const views: [ScheduleView, string][] = [["events", "Amortization schedule - all events"], ["month", "Amortization schedule - monthly"], ["year", "Amortization schedule - yearly"]];
  for (const [view, title] of views) {
    section(title, ["Payment #", view === "events" ? "Date" : "Period", "Loan period", ...(view === "events" ? ["Event"] : []), ...(source ? ["Source"] : []), "Payment", "Principal / debt reduction", "Interest", "Extra repayment", "Fees", "From offset", "Other funds", "Offset applied", "Interest-bearing balance", "Rates (%)", "Draw / redraw", "Unpaid interest added", "Balloon", "Residual", "Balance"]);
    for (const row of aggregateSchedule(events, view)) rows.push([
      paymentNumberCell(row), row.period, schedulePeriodLabel(row.period, view, sim.startDate, derivedFirstPaymentDate(sim), sim.profile.repaymentFrequency),
      ...(view === "events" ? [scheduleEventLabel(row.eventType)] : []), ...(source ? [source(row.period, row.paymentNumberTo)] : []),
      amount(row.paymentMinor), amount(row.principalMinor), amount(row.interestMinor), amount(row.extraRepaymentMinor), amount(row.feesMinor),
      row.hasRepaymentFunding ? amount(row.offsetFundedMinor) : "", row.hasRepaymentFunding ? amount(row.otherFundsMinor) : "", amount(row.offsetAppliedMinor), amount(row.interestBearingMinor), row.rates.map(fractionToPercent).join("; "), amount(row.drawMinor), amount(row.unpaidInterestMinor), amount(row.balloonMinor), amount(row.residualMinor), amount(row.closingBalanceMinor),
    ]);
  }
  return rows;
}

export function loanExportFilename(name: string, today: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "loan"}-calculation-${today}.csv`;
}
