# Fixture fortnightly-monthly-charge

id: au-daily-fortnightly-monthly-charge
country: AU
currency: AUD
source-name: Independent oracle (src/test-oracles/rd084) from the behavior published by Figura and Unloan (see SOURCES.md); hand-checked with Python fractions
source-url: https://figura.com.au/calculators/repayments
source-type: synthetic-oracle
verified: 2026-09-29
conventions: actual-365-fixed, daily-simple accrual, monthly charge, fortnightly repayment, start-of-day repayments, daily interest to 5 places, charge rounded half-up to cents
engine-versions: daycount-act365f@1, money-kernel@1 (daily engine: P1.2)
coverage: synthetic

Daily accrual on the day's balance at Actual/365 Fixed, each day's interest rounded to 5 places
(Figura's published method), the month's total rounded to cents and charged monthly on the 1st,
while repayments fall fortnightly on their own real dates, through 29 February. Repayments are not
interest charges: interest is charged only on the charge dates.

Interpretations (not stated by any source, chosen to match FR-047's default order):
- a charge on date C covers the days from the previous charge date (inclusive) to C (exclusive),
  and is capitalized at the end of the day before C, so it bears interest from C;
- a repayment on a date applies before that day's accrual (`start-of-day`);
- ties round half-up.

Consumed by the P1.2 daily engine (T049 onward). In P1.1 only the oracle checks it.
