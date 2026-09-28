# Fixture cross-year-synthetic

id: actact-cross-year-synthetic
country: AU
currency: AUD
source-name: Independent oracle (src/test-oracles/rd084) from the ISDA-method definition in the 1998 ISDA memo; hand-checked with Python fractions
source-url: n/a (synthetic)
source-type: synthetic-oracle
verified: 2026-09-29
conventions: actual-actual-calendar
engine-versions: daycount-actact-calendar@1, money-kernel@1
coverage: synthetic

Leap to normal (2024-12 to 2025-02) and normal to leap (2023-12 to 2024-02) crossings, 29 February,
a one-day period on 31 December, and whole years: a full leap year accrues exactly one year of
interest (1312500), and two years spanning a leap year accrue exactly two. The two 62-day
crossings give the same figure because each has 31 days on each side of the year end.
