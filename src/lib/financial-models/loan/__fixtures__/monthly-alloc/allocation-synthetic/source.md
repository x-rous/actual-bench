# Fixture allocation-synthetic

id: monthly-alloc-allocation-synthetic
country: n/a
currency: AUD
source-name: Independent oracle (src/test-oracles/rd084) from the V3 planning formula (§10.3) and FR-038; hand-checked with Python fractions
source-url: n/a (synthetic; no published source found)
source-type: synthetic-oracle
verified: 2026-09-29
conventions: monthly-30-360-actual-day-allocation
engine-versions: daycount-monthly-alloc@1, money-kernel@1
coverage: synthetic

Every whole month earns exactly 1/12 of a year (50000) whatever its length, and a part month earns
its share of that month's days. March 2024 differs from Actual/360, which gives 51667 for the
same loan (FR-038 requires the two to be distinct). A whole leap year earns exactly one year.
