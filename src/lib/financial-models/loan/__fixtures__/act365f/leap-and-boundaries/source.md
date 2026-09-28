# Fixture leap-and-boundaries

id: act365f-leap-and-boundaries
country: AU
currency: AUD
source-name: Independent oracle (src/test-oracles/rd084) from the Actual/365 Fixed definition; hand-checked with Python fractions
source-url: n/a (synthetic)
source-type: synthetic-oracle
verified: 2026-09-29
conventions: actual-365-fixed
engine-versions: daycount-act365f@1, money-kernel@1
coverage: synthetic

Edge cases for FR-038: the denominator stays 365 on 29 February, so a whole leap year (366 days)
accrues more than one year of interest (2454707 > 2448000) and 29 February earns a full day
(6707, the same as any other day). Covers a one-day period across a year end, a month-end start,
and a period through 29 February. Expected values come from the oracle and a separate Python
`fractions` calculation, never from the engine.
