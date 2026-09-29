# Fixture figura-order-fortnightly-monthly-charge

id: au-daily-figura-order-fortnightly-monthly-charge
country: AU
currency: AUD
source-name: Independent oracle (src/test-oracles/rd084) following the Figura calculator's published method notes and shipped calculation code (see SOURCES.md); hand-checked with Python fractions
source-url: https://figura.com.au/calculators/repayments
source-type: synthetic-oracle
verified: 2026-09-29
conventions: actual-365-fixed; daily-simple accrual; monthly charge on the drawdown day of month clamped to month end; fortnightly scheduled repayments after the day's accrual; extra repayments before it; daily interest to 5 places half-up; charge rounded half-up to cents
engine-versions: daycount-act365f@1, event-order@1, money-kernel@1 (daily engine: P1.2)
coverage: synthetic

A $500,000 loan drawn on 31 January 2024 at 6% (Actual/365 Fixed), with fortnightly scheduled
repayments of $1,500 from 1 February and one $5,000 extra repayment on 10 March.

**Figura behavior this encodes**, each verified from Figura's page or shipped code (SOURCES.md):
- Interest accrues daily on the balance, rounded to 5 places half-up.
- Each month's total is rounded to cents half-up and capitalized.
- Charges fall on the drawdown's day of month, clamped to the month end: 29 Feb, 31 Mar, 30 Apr.
- A charge covers the days after the previous charge date (or drawdown) through the charge date.
- An extra repayment applies before that day's accrual.
- A scheduled repayment applies after the day's accrual and after any charge that day (29 Feb
  has both).

**Not encoded:** Figura rounds the daily rate to 20 decimal places (bignumber.js default) before
multiplying. The oracle uses the exact rate. The two can differ only within about 1e-15 of a 5-place tie. The
closest any day here comes is 0.048 of the fifth place (checked with Python fractions).

Consumed by the P1.2 daily engine (T049 onward). In P1.1 only the oracle checks it.
