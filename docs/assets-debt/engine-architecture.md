# Assets & Debt: calculation engines and projection

This covers the two loan engines in `src/lib/financial-models/loan/`, the projection built on them,
and how both are tested. The primitives they use are in `engine-kernel.md`.

Everything here is pure. Nothing imports the app database, the Actual transport, automation or UI
(`eslint.config.mjs`). An engine reads its inputs once, simulates, and returns data. It never
posts, and it never reads Actual during a run.

## Choosing an engine

`projection.ts#simulate` picks the engine from the profile:

- `accrual: per-period` → **bench-periodic** (`periodic-engine.ts`, `loan-periodic@1`);
- `daily-simple` or `daily-compounded` → **bench-daily** (`daily-engine.ts`, `loan-daily@1`).

`eligibility.ts#evaluateStrategyEligibility` gives the recommended strategy (FR-026). It walks the
ladder Actual formula rule → bench-periodic → bench-daily, and gives a reason for every strategy
it rejects.

## bench-periodic

A period runs from one scheduled payment date to the next. Each period's interest is
`balance × periodic rate`, rounded once at posting.

- **Where the rate is an exact ratio,** as with a simple periodic quote (annual ÷ k), interest is
  formed exactly as `balance × rate ÷ k` (`rates.ts#periodInterestAt`). A pre-rounded rate never
  leaks in. The mortgagemath cross-check found a ¥1 truncation error when it did.
- **The day count is not used.** For a monthly loan quoted `nominal-simple-periodic`, each period
  earns rate ÷ 12. That is what "30/360" means for regular periods.
- **Payments:**
  - the level payment is derived per `repaymentDerivation` from the abstract payment count;
  - interest-only phases pay the interest;
  - a constant-principal loan pays its installment plus interest;
  - a payment is allocated with principal as the residual (`allocation.ts`).
- **Recasts.** A rate-change recast takes effect at the first payment on or after its payment
  effective date whose period accrues at the new rate, so a payment date left at the accrual date
  never recasts at the old rate. A dated contractual recast (`paymentRecasts`) takes effect at the
  first payment on or after its date.
- **Capitalized fee components** are added to the debt after the payment on each payment date.
- **It refuses, rather than approximating** (FR-215), an irregular first period, a rate change
  inside a period, offsets, and any event between payment dates. All of these belong to
  bench-daily.

## bench-daily

The engine walks real calendar days, from the day after the anchor to the end of the run. The
day's rule is:

```
before-accrual events → daily accrual → interest charge or capitalization, if due → after-accrual events
```

An event placed after the day's interest therefore also follows a same-day charge. Which events
are before or after is the profile's `eventOrder` (a timing preset, or per-group placements for
scheduled repayments, other payments and offsets). No lender's order is built in: a
Figura-compatible profile places other payments and offsets before and the scheduled repayment
after. Every event records `sameDayStep` and `eventOrder: "event-order@1"` in its diagnostics.
Within one group, same-day ledger events keep the ledger's deterministic order.

In detail, every day follows `events.ts#dayStepOrder` (`event-order@1`):

1. contract and rate changes, and recasts;
2. external cash (fees);
3. payments placed before the accrual (other payments, then the scheduled repayment);
4. offset changes placed before the accrual;
5. determine the interest base (the debt net of offsets);
6. accrue;
7. charge, when a charge is due;
8. anything placed after the accrual;
9. close.

The engine keeps three pieces of state apart:

| State | Meaning |
|---|---|
| debt | principal plus charged interest and capitalized fees, always whole minor units |
| accrued | interest accrued but not charged; it bears no interest under `daily-simple` |
| carry | the sub-minor remainder, carried only under `carry-full-precision` |

- **Charging.** Monthly, quarterly or annual charges follow their own calendar (`charge.ts`), clamped
  in short months. `at-repayment` charges with each scheduled repayment. A charge due on date C covers
  the days after the previous charge up to and including C.
- **Payoffs.** A payoff or a true-up charges any accrued interest first, so the debt never goes into
  credit (FR-048).
- **Interest-only with its own cadence.** Repayments need not fall on charge dates. Under
  `interestOnlyRepayment: charged-interest-outstanding` (the only v1 convention), a repayment pays
  the interest charged since the previous scheduled repayment: nothing before the first charge, and
  one repayment per charge period pays it. The phase ends with a recast to an amortizing payment.
- **Recasts.** Rate-change, annual, phase-end and dated contractual recasts (`paymentRecasts`,
  reason `contract-date`) are separate triggers; a rate change need not recast.
- **Fees.** Each fee states its treatment. A `capitalized` fee raises the debt on its date with no
  cash and is never a principal repayment; a `cash-paid` fee moves cash only. Capitalized fee
  components are added on each scheduled repayment date.
- **Resuming.** A closing state (`accruedInterestExact`, `carriedRemainder`) resumes a later run with
  no rounding. Splitting a run at any day changes nothing, and a test holds this.

## Events and invariants

Each `ModelEvent` explains one balance change. The invariants below are tested in
`engine.invariants.test.ts`:

- `balanceAfter − balanceBefore = principalMovement`, and each event's `balanceBefore` is the
  previous event's `balanceAfter`.
- Each unit of interest appears in exactly one event: a standalone `interest-charge`, or the payment
  that charged it.
- Payment lines (`principal`, `interest`, cash-paid components) sum to the cash paid.
- An offset never changes the debt. An extra repayment reduces it exactly once, and a draw raises it
  exactly once. A negative repayment is refused, never read as a draw.
- **Negative amortization** is its own marker event, with the unpaid interest in its diagnostics.
  It is never reported as a principal repayment. It is allowed only when the profile permits it;
  otherwise it needs review (FR-067).
- **A payment cap** is a `PaymentLimit` on the rate period: `absolute`, or `previous-payment-factor`
  (for example 1.075). The recast event records the uncapped payment, the cap and the capped payment.
- **Final payments** follow the policy (`finalPayment.ts`): true-up, contractual balloon (a separate
  `balloon` event), a level payment with a residual, or continuing until paid. Every policy stops at
  zero on an early payoff.
- **Revolving facilities** take their payment from the payment model only, with no amortization and
  no final payment. Receivables use the same engines and are viewed from the lender's side
  (`receivable.ts`).

## Projection (contract v1, frozen)

`projection.ts#projectDebt` returns `DebtProjectionEvent[]` (schema version 1). Each event has:

- the date and event type;
- the signed cash and principal movements;
- interest and fees;
- the balance before and after;
- the certainty;
- the model revision and engine versions;
- empty category allocations (categories are applied later, from account budget status);
- diagnostics.

It also returns monthly summaries, yearly ones on request, and a `stale` flag when the baseline came
from an older anchor. Overrides (`assumptions`, `rates`) apply to a copy of the model and are never
written back. The output holds no ledger operation of any kind (FR-019). RD-073 is a future
consumer; nothing here plans household cash flow (FR-114).

## Diagnostics

Every event carries deterministic diagnostics for preview and audit, for example:

- the rate in force and the periodic rate;
- the exact interest and any carried or dropped remainder;
- the charge's accrued amount;
- the decision taken (regular, early payoff, true-up, balloon);
- the recast's previous, recalculated and capped payments;
- negative amortization.

Two diagnostic groups feed the simulator's schedule, so the UI never recomputes them
(`loan-daily@2`, `loan-periodic@2`):

- **Rate:** `effectiveAnnualRateDecimal` is the exact annual rate the engine accrued with on that
  event's day (so `from-next-charge-period` timing shows the old rate until the rate takes effect).
  `interestRatesDecimal` lists, separated by `;`, every rate that accrued into the interest the
  event charges or pays; more than one means the period mixed rates, and the schedule shows
  "Multiple".
- **Offset** (only when the loan has an offset): with `base` the engine's own pre-offset
  interest base for the day (the debt, plus accrued interest under daily compounding) and
  `eligible` the offset after its share, basis and cap,
  `offsetAppliedMinor = floor(min(max(0, eligible), max(0, debt)))` and
  `interestBearingMinor = floor(max(0, base - applied))`, both rounded down to minor units.
  They explain the calculation and are never fed back into it.

These are added to repayment, final-payment and interest-charge events after the day's steps. The
projection contract stays v1: diagnostics are an open scalar record.

`diagnostics.ts#diagnoseConventions` re-runs a request under each selectable day count, same-day
timing and posting rounding, and ranks them against a lender balance. It returns evidence, never a
configuration change (FR-093).

## Testing

- **Engine properties:** `loan/*.test.ts`.
- **Golden suite:** `src/test-golden/rd084/` compares the engines with the independent oracle
  (`src/test-oracles/rd084/schedules.ts`) for V3 §40.1–40.3, and with published anchors:
  - MoneyVox, all 48 cells;
  - ProEducate, all six figures;
  - Reg Z H-14, narrowed;
  - York j2;
  - Figura's day order;
  - Fannie Mae §1103's cash schedule.

  The oracle and the engine cannot import each other; only the golden folder sees both.
- **mortgagemath cross-check (P1.2, research only).** 39 of its 45 comparable fixtures match
  RD-084's periodic engine. The other six:
  - FHLBB, Geltner and Goldstein use mortgagemath's theoretical carry-precision mode, which an owner
    decision rules out;
  - MoneyVox and RBC were harness artifacts;
  - LoanKeisan exposed the pre-rounded-rate bug above, now fixed and covered by a golden case.
