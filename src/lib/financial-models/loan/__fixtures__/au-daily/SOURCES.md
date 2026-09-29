# Australian daily accrual, monthly charge (Figura-style): reference sources

status: verified-behavior
convention: actual-365-fixed accrual, monthly charge, weekly/fortnightly repayments
reviewed: 2026-09-29 (second pass)

## Verified behavior (calculator, not lender)

1. **Figura home loan repayment calculator, method notes**, https://figura.com.au/calculators/repayments
   (retrieved 2026-09-29). Quoted:
   - "Interest is calculated daily on the current loan balance to 5 decimal places."
   - "At the end of the monthly period the total is then rounded to 2 decimal places before
     being charged."
   - "The calculator always charges interest monthly on the same day each month, except when the
     first interest charge falls on the 29th, 30th, or 31st. Following months with less days will
     instead charge interest on the last day of the month."
   - Weekly and fortnightly repayments are still charged interest monthly. Repayment derivation
     is split over 52/26, or uses "Split monthly" (48 weeks a year).
   - A new rate takes effect "from the start of the next interest period".
2. **Figura's shipped calculator code** (same page; bundles `413.a586a8ebc8ce98be.js` and
   `775.140419e210bd0f5b.js`, retrieved 2026-09-29). Read to confirm behavior only; no code copied.
   It shows:
   - each monthly period walks the days from the day after the period start through the charge
     date;
   - on each day, extra ("extra transaction") repayments, redraws and offset deposits apply first;
     interest then accrues on the balance net of the offset, rounded to 5 places half-up;
   - on the charge date, the period total is rounded to cents half-up and added to the balance;
   - the scheduled ("minimum") repayment for that day applies last;
   - the daily rate is `rate / 100 / denominator` in bignumber.js, whose default division scale is
     20 places, half-up.
3. **Unloan (Commonwealth Bank of Australia)**: daily interest = balance × rate / 365 (see
   act365f/SOURCES.md).

## RD-084 conventions this supports, and what it does not

- `event-order@1` takes both of its day boundaries from FR-047's literal order, and Figura's code
  agrees with them:
  - a charge on C is taken after C's accrual, covering (previous charge, C];
  - accrual starts the day after the anchor or drawdown.

  This is calculator evidence, not a lender's published rule.
- Figura's placement (extra repayments before the accrual, scheduled repayments after it) is
  expressible as `eventOrder: { scheduledRepayments: "after-accrual", otherPayments:
  "before-accrual", offsets: "before-accrual" }`. RD-084's default (`start-of-day`) differs.
- Figura's **"Actual/Actual"** uses a denominator of 365 or 366 depending on whether the 12 months
  from the loan anniversary contain 29 February. That is not ISDA's calendar-year method (RD-084
  `actual-actual-calendar`). No RD-084 convention reproduces Figura's variant.
- Figura's **"30/360"**: see monthly-alloc/SOURCES.md.

## Withdrawn (P1.1 first pass)

`fortnightly-monthly-charge` assumed three things, and none of them is Figura's behavior:
- a charge covering [previous charge, C) and capitalized the day before C;
- accrual on the drawdown day;
- every repayment before the accrual.

The P1.1 report wrongly called that boundary consistent with FR-047. The fixture was removed and
replaced by `figura-order-fortnightly-monthly-charge`; see ../CANDIDATES.md.

## Coverage limits

No published full schedule was found: no dated repayments with amounts and monthly charges, from
Figura or from any lender. The fixture's values come from the oracle following the verified
behavior. No preset may claim to match a named lender on this evidence (FR-050).

## Fixtures

- `figura-order-fortnightly-monthly-charge`: synthetic, oracle-derived. It covers a charge-day clamp
  from the 31st, a scheduled repayment on a charge date, and an extra repayment. The P1.2 daily
  engine consumes it.
