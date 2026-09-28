# Monthly 30/360 with actual-day allocation: reference sources

status: no-verified-source
convention: monthly-30-360-actual-day-allocation
reviewed: 2026-09-29

## Result

No public reference exists that we could find and verify. The convention (1/12 of the nominal
annual interest spread over the actual days of the month) comes from the RD-084 V3 planning
document §10.3 and FR-038, not from a lender, regulator or standards publication.

Searched (2026-09-29): lender and loan-agreement wording for "one-twelfth" with "actual number of
days in the month"; US and Australian regulator material. The nearest match, Ohio Revised Code
1321.68 (a month is 1/12 of a year and a day 1/365 of a year for part months), is a different
convention and is not used.

## Consequence

The convention is implemented and tested against the independent oracle, but it is **not
selectable** (FR-050, FR-215). It becomes selectable only when a verified published source and a
reference fixture are added here.

## Fixtures

- `allocation-synthetic`: synthetic, oracle-derived; not reference coverage.
