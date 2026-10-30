import { Heading, Para } from "@/components/ui/guide-primitives";
import { SIMULATOR_DEFAULT_PROFILE } from "../../lib/simulatorModel";
import { ACCRUAL_OPTIONS, AMORTIZATION_OPTIONS, BALANCE_PRECISION_OPTIONS, CAPITALIZATION_OPTIONS, CHARGE_FREQUENCY_OPTIONS, DAY_COUNT_OPTIONS, FINAL_PAYMENT_OPTIONS, RATE_QUOTE_OPTIONS, RECAST_OPTIONS, REPAYMENT_DERIVATION_OPTIONS, ROUNDING_OPTIONS, labelOf } from "../../lib/vocabulary";

type Setting = { field: string; controls: string; values: [string, string][] };
const profile = SIMULATOR_DEFAULT_PROFILE;
const defaults: Record<string, string> = {
  "Start from a preset": profile.presetId === null ? "No preset" : "",
  "Rate quoted as": labelOf(RATE_QUOTE_OPTIONS, profile.rateQuote),
  "Interest accrues": labelOf(ACCRUAL_OPTIONS, profile.accrual),
  "Day count method": labelOf(DAY_COUNT_OPTIONS, profile.dayCount),
  "Interest is charged": labelOf(CHARGE_FREQUENCY_OPTIONS, profile.chargeFrequency),
  "Interest capitalizes": labelOf(CAPITALIZATION_OPTIONS, profile.capitalization),
  "A new rate applies": profile.rateEffectiveTiming === "on-accrual-effective-date" ? "From the rate's own date" : "From the next interest period",
  "Transactions on the same day as interest": "timing" in profile.eventOrder ? (profile.eventOrder.timing === "end-of-day" ? "After the day's interest" : "Before the day's interest") : "Set each group separately",
  "First interest charge": "Blank",
  "Amortization": labelOf(AMORTIZATION_OPTIONS, profile.amortization),
  "Repayment amount": labelOf(REPAYMENT_DERIVATION_OPTIONS, profile.repaymentDerivation),
  "Recalculate the repayment": labelOf(RECAST_OPTIONS, profile.recast),
  "A repayment counts": profile.repaymentEffectiveTiming === "transaction-date" ? "On the repayment date" : "From the next day",
  "Final repayment (end of loan)": labelOf(FINAL_PAYMENT_OPTIONS, profile.finalPayment),
  "The contract allows negative amortization": profile.negativeAmortizationAllowed ? "On" : "Off",
  "Repayment rounding": labelOf(ROUNDING_OPTIONS, profile.rounding.paymentRounding),
  "Interest rounding": labelOf(ROUNDING_OPTIONS, profile.rounding.interestPostingRounding),
  "Working precision": profile.rounding.intermediateScale.mode === "full" ? "Full precision" : profile.rounding.intermediateScale.mode === "currency" ? "Amount precision" : "A fixed number of places",
  "Working rounding": labelOf(ROUNDING_OPTIONS, profile.rounding.intermediateRounding),
  "Balance precision": labelOf(BALANCE_PRECISION_OPTIONS, profile.rounding.balancePrecision),
  "A due date on a non-business day": "Stays on its date",
  "Lender statements split repayments using": "Interest up to each payment's actual date",
};
const roundingChoices: [string, string][] = [
  ["Half up", "Nearest; an exact halfway value rounds away from zero."],
  ["Half even (banker's)", "Nearest; a halfway value rounds to the even neighbour, for example 2.5 to 2 and 3.5 to 4."],
  ["Up", "Away from zero whenever digits are discarded."],
  ["Down (truncate)", "Discards extra digits toward zero."],
];

/** Keep each setting's purpose separate from its individual choices. */
function SettingsTable({ title, settings }: { title: string; settings: Setting[] }) {
  return <div className="my-4 max-w-[65rem] overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
    <table className="w-full min-w-[42rem] table-fixed text-left text-[13px] leading-relaxed">
      <caption className="sr-only">{title}</caption>
      <colgroup><col className="w-[20%]" /><col className="w-[29%]" /><col className="w-[51%]" /></colgroup>
      <thead className="bg-muted/50 text-muted-foreground"><tr><th scope="col" className="px-4 py-1.5 text-xs font-semibold">Field</th><th scope="col" className="px-4 py-1.5 text-xs font-semibold">What it controls</th><th scope="col" className="px-4 py-1.5 text-xs font-semibold">Values and behavior</th></tr></thead>
      <tbody className="divide-y divide-border">{settings.map(({ field, controls, values }) => <tr key={field} className="align-top">
        <th scope="row" className="px-4 py-2 font-semibold text-foreground">{field}</th>
        <td className="px-4 py-2 text-muted-foreground">{controls}</td>
        <td className="px-4 py-2"><ul className="space-y-2">{values.map(([name, explanation]) => <li key={name} className="flex gap-2.5"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/70" /><span><strong className="font-semibold text-foreground">{name}:</strong>{defaults[field] === name ? <span className="ml-1.5 inline-block rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Default</span> : null} <span className="text-foreground/80">{explanation}</span></span></li>)}</ul></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/** Reference for the fields in the calculation-method drawer. */
export function LoanSettingsGuide() {
  return <>
    <div className="mb-4 max-w-[65rem] rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs leading-relaxed">
      <p className="font-semibold text-foreground">Match your lender&apos;s method</p>
      <p className="mt-1 text-muted-foreground">Open <b>Set calculation method</b> on Terms &amp; Schedule. Choose the settings your lender uses and save the loan to keep changes. The day count is also beside the interest rate.</p>
      <p className="mt-1 text-muted-foreground"><b>Default</b> marks the starting choice for a new loan. A preset or an existing loan may use different values; match your lender rather than choosing a value just because it is the default.</p>
    </div>
    <Heading>Start from a preset</Heading>
    <SettingsTable title="Presets" settings={[
      { field: "Start from a preset", controls: "Fills a set of calculation fields as a starting point. Other fields keep their current values; you can change the result.", values: [
        ["No preset", "Set the fields individually."],
        ["Monthly level payment", "Monthly level payment with per-period interest charged at repayment."],
        ["Daily interest, charged monthly", "Daily simple Actual/365 Fixed interest, charged monthly on day 1; monthly repayments."],
        ["Rate compounded semi-annually, paid monthly", "A nominal rate quoted with semi-annual compounding, monthly repayments and per-period interest."],
        ["Constant principal plus interest", "Constant principal with per-period interest, a contract payment and no automatic recast."],
      ] },
    ]} />
    <Heading>Interest</Heading>
    <SettingsTable title="Interest settings" settings={[
      { field: "Rate quoted as", controls: "How the stated annual rate is converted to a periodic rate. This is separate from day count.", values: [
        ["Nominal annual rate, divided by payments per year", "Divides the annual rate by the number of payments per year."],
        ["Nominal annual rate, compounded monthly", "Converts a rate quoted with monthly compounding to the payment period."],
        ["Nominal annual rate, compounded semi-annually", "Converts a rate quoted with twice-yearly compounding to the payment period."],
        ["Effective annual rate", "Starts from the rate after a full year of growth."],
      ] },
      { field: "Interest accrues", controls: "How often interest is calculated and whether it compounds before a charge.", values: [
        ["Per payment period", "Calculates interest once for each repayment period."],
        ["Daily, simple (charged later)", "Accrues interest each day without adding it to the balance until charged."],
        ["Daily, compounded", "Adds interest to the balance each day, so later daily interest includes it."],
      ] },
      { field: "Day count method", controls: "How daily interest counts the year; the actual calendar days still matter.", values: [
        ["Actual/365 Fixed", "Uses actual days and a 365-day denominator every year."],
        ["Actual/360", "Uses actual days and a 360-day denominator."],
        ["Actual/Actual (calendar year)", "Uses 365 or 366 according to each calendar year."],
        ["Monthly 30/360 with actual-day allocation", "Shown but not selectable without a verified source."],
      ] },
      { field: "Interest is charged", controls: "When accrued interest is charged. A scheduled charge adds to the debt; it is not itself a repayment.", values: [
        ["With each repayment", "Charges interest on each repayment date."],
        ["Monthly", "Charges on a monthly schedule, independent of repayment frequency."],
        ["Quarterly", "Charges every three months on its own schedule."],
        ["Annually", "Charges once a year on its own schedule."],
      ] },
      { field: "Charge day of the month", controls: "Sets the day for a separate charge schedule; shown when interest is not charged with each repayment.", values: [["Day of month", "Bench initially fills day 1 when a separate schedule is chosen. Check the lender's day; a day missing in a short month moves to its last day."]] },
      { field: "First interest charge", controls: "Sets the first date of a separate charge schedule. Check this and the charge day against the lender's dates.", values: [
        ["A date", "Starts charging on the date entered."], ["Blank", "Uses one charge interval after the loan starts, with the charge day."],
      ] },
      { field: "Interest capitalizes", controls: "When interest is added to the balance that can itself accrue interest.", values: [
        ["When interest is charged", "Adds interest to the debt at the charge."], ["Daily", "Adds interest each day; required for daily compounded accrual and incompatible with daily simple accrual."],
      ] },
      { field: "A new rate applies", controls: "When an effective-dated rate change affects interest.", values: [
        ["From the rate's own date", "Uses the new rate from its effective date."], ["From the next interest period", "Keeps the existing rate until the next charge period."],
      ] },
    ]} />
    <div className="my-3 max-w-[65rem] rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed">
      <p className="font-semibold">How accrual, charging and capitalization fit together</p>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
        <li><b className="text-foreground">Accrual:</b> interest builds up, for example daily on the outstanding balance.</li>
        <li><b className="text-foreground">Charging:</b> the accumulated interest is posted, for example monthly or with a repayment.</li>
        <li><b className="text-foreground">Capitalization:</b> interest is added to the debt; with capitalization at charge, this happens when it is charged.</li>
      </ol>
      <p className="mt-2 text-muted-foreground">Daily compounding instead adds interest to the balance each day. The lender&apos;s contract determines which treatment to use.</p>
    </div>
    <Heading>Transactions on the same day as interest</Heading>
    <SettingsTable title="Same-day order" settings={[
      { field: "Transactions on the same day as interest", controls: "Determines whether balance changes on a day affect that day's interest.", values: [
        ["Before the day's interest", "Applies the relevant transactions before that day's accrual."],
        ["After the day's interest", "Accrues interest before applying the transactions."],
        ["Set each group separately", "Reveals separate before/after choices for scheduled repayments, other payments and draws, and offset balance changes."],
      ] },
      { field: "Scheduled repayments; Other payments and draws; Offset balance changes", controls: "Controls the timing of each group when Set each group separately is selected.", values: [
        ["Before the day's interest", "The group's balance changes apply before accrual."], ["After the day's interest", "The group's balance changes apply after accrual."],
      ] },
    ]} />
    <Heading>Repayment</Heading>
    <SettingsTable title="Repayment settings" settings={[
      { field: "Amortization", controls: "The intended pattern of principal and repayments.", values: [
        ["Level payment", "Aims for a regular payment."], ["Constant principal plus interest", "Uses the same principal per period with interest on top."], ["Custom payment", "Uses a supplied payment."], ["Revolving", "A revolving-credit loan uses its own payment settings."],
      ] },
      { field: "Repayment amount", controls: "How the scheduled payment is worked out, separately from how often it is paid.", values: [
        ["Level payment at the repayment frequency", "Uses a regular-period annuity."],
        ["Level payment over the dated cash-flow schedule", "Uses the actual scheduled accrual periods; subject to the limits below."],
        ["Monthly payment × 12 ÷ payments per year", "Converts a monthly payment to weekly or fortnightly."],
        ["Monthly payment split evenly", "Divides the monthly payment by 4 for weekly or 2 for fortnightly."],
        ["The contract's fixed payment", "Uses the supplied contractual payment."],
        ["Whatever the lender says", "Uses the supplied lender payment."],
      ] },
      { field: "Recalculate the repayment", controls: "When Bench recalculates the scheduled amount. A rate change can have an override.", values: [
        ["When the rate changes", "Recalculates on eligible rate changes."], ["Never", "Does not schedule a recast under this policy."], ["Once a year", "Recalculates annually."], ["On the contract's recast dates", "Uses the dates entered in the fields that appear."], ["When the lender says", "Use a repayment-change event for an amount supplied by the lender; this policy does not schedule its own recast."],
      ] },
      { field: "Recast dates and notes", controls: "The dates and optional notes used when the contract-date recast option is selected.", values: [["Add a recast date", "Enter each contractual date; notes are optional."]] },
      { field: "A repayment counts", controls: "The date a repayment affects the balance for interest. Check this alongside same-day order.", values: [["On the repayment date", "The payment takes effect on its date."], ["From the next day", "The payment takes effect on the next calendar day."]] },
      { field: "Final repayment (end of loan)", controls: "What happens when the contractual term ends with debt still owed.", values: [
        ["Adjust the last payment to clear the debt", "Changes the final payment to clear what is owed."], ["A balloon payment at maturity", "Makes the level payment, then a separate balloon for the remainder."], ["Keep the level payment; leave a residual", "Leaves the unpaid balance as a residual."], ["Keep paying until it is paid off", "Continues level payments and adjusts the final payoff."],
      ] },
      { field: "The contract allows negative amortization", controls: "Whether a repayment can leave charged interest unpaid and increase the debt.", values: [
        ["Off", "When interest is charged with a repayment, Bench blocks a payment that does not cover that charge."], ["On", "The shortfall may increase the debt. Use only if the contract permits it; this is separate from periodic interest charges."],
      ] },
    ]} />
    <div className="my-3 max-w-[65rem] rounded-lg border border-amber-300/60 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-foreground dark:border-amber-800 dark:bg-amber-950/20"><strong>Some combinations are limited.</strong> The dated cash-flow method needs level payments, daily simple interest, interest charged at repayment and capitalization at charge; it does not approximate offsets or interest-only phases. Split and pro-rata methods need weekly or fortnightly repayments. Bench reports unsupported combinations.</div>
    <Heading>Precision and rounding</Heading>
    <SettingsTable title="Precision and rounding" settings={[
      { field: "Repayment rounding", controls: "Rounds a calculated payment to the currency's amount precision.", values: roundingChoices },
      { field: "Interest rounding", controls: "Rounds interest when charged.", values: roundingChoices },
      { field: "Working precision", controls: "How many digits the calculation keeps at intermediate steps.", values: [
        ["Full precision", "Keeps the calculation's working precision."], ["Amount precision", "Uses the amount's decimal places."], ["A fixed number of places", "Reveals a Decimal places field, from 0 to 30."],
      ] },
      { field: "Decimal places", controls: "The number of working decimal places when fixed precision is selected.", values: [["0 to 30", "Choose the working precision required by the lender."]] },
      { field: "Working rounding", controls: "The rounding rule applied at the selected working precision.", values: roundingChoices },
      { field: "Balance precision", controls: "How the calculation handles fractions below the currency's minor unit.", values: [
        ["Round each posting", "Rounds each charge and drops the remainder."], ["Round each event", "Also rounds daily accrual to amount precision."], ["Carry full precision", "Carries the remainder to the next charge."],
      ] },
      { field: "Amount decimal places", controls: "The precision of loan amounts.", values: [["0 to 4", "The starting value depends on the currency; use its precision."]] },
    ]} />
    <SettingsTable title="Rounding rules" settings={[
      { field: "Rounding rules", controls: "The four choices used by the rounding fields above.", values: roundingChoices },
    ]} />
    <Heading>Due dates and lender statements</Heading>
    <SettingsTable title="Due-date settings" settings={[
      { field: "A due date on a non-business day", controls: "How a scheduled date moves when it falls on a configured non-business day.", values: [
        ["Stays on its date", "Does not move the date."], ["Moves to the next business day", "Moves forward."], ["Next business day, unless that is next month", "Moves forward unless that crosses into the next month; then moves back."], ["Moves to the previous business day", "Moves backward."], ["Previous business day, unless that is last month", "Moves backward unless that crosses into the previous month; then moves forward."],
      ] },
      { field: "Non-business weekdays", controls: "Which weekdays are not business days for the lender; shown when dates move.", values: [["Mon–Sun", "When date adjustment is first enabled, Saturday and Sunday are preselected. Check the lender's weekdays; at least one must remain a business day."]] },
      { field: "Holidays", controls: "Additional non-business dates, shown when dates move.", values: [["YYYY-MM-DD dates", "Enter the lender's dates; Bench saves them with the loan and does not fetch a calendar."]] },
      { field: "Lender statements split repayments using", controls: "How observed repayments are allocated for statement comparison; it does not change how interest accrues.", values: [
        ["Interest up to each payment's actual date", "Reports accrued interest at payment."], ["Interest up to each due date; early-payment benefit next time", "Reports through the adjusted due date, with the benefit of early payment reflected in the next repayment."],
      ] },
    ]} />
    <Para>Business-day rules move scheduled dates, including scheduled charge dates; interest still accrues on calendar days. Compare the result with the lender&apos;s statement before saving changes.</Para>
  </>;
}
