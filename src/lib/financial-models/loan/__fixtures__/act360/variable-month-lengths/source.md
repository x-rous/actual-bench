# Fixture variable-month-lengths

id: act360-variable-month-lengths
country: US
currency: USD
source-name: Independent oracle (src/test-oracles/rd084) from the Actual/360 definition in the Fannie Mae Multifamily Guide 204.02A; hand-checked with Python fractions
source-url: https://mfguide.fanniemae.com/node/7941
source-type: synthetic-oracle
verified: 2026-09-29
conventions: actual-360
engine-versions: daycount-act360@1, money-kernel@1
coverage: synthetic

The actual days of each month over 360: every month length from 28 to 31 appears, so the fixture
fails if a 30-day month is assumed (that would be 30/360). A whole leap year accrues 366/360 of
the annual rate.
