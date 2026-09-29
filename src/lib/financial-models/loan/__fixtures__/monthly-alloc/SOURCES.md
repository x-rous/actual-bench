# Monthly 30/360 with actual-day allocation: reference sources

status: no-verified-source
convention: monthly-30-360-actual-day-allocation
reviewed: 2026-09-29 (second pass)

## Result

No public reference exists that we could find and verify. The convention (1/12 of the nominal
annual interest spread over the actual days of the month) comes from the RD-084 V3 planning
document §10.3 and FR-038, not from a lender, regulator or standards publication.

Searched (2026-09-29): lender and loan-agreement wording for "one-twelfth" with "actual number of
days in the month"; US and Australian regulator material. The nearest match, Ohio Revised Code
1321.68 (a month is 1/12 of a year and a day 1/365 of a year for part months), is a different
convention and is not used.

## Second pass: Figura

The Figura calculator (see au-daily/SOURCES.md) offers an interest method it labels **"30/360"**.
Its method notes describe it as "360 days per year, then multiplying by 30 days per month (or simply
dividing the decimal rate by 12 equal months), then dividing by the actual number of days in the
current month", so that "1/12th of the annual interest is paid each month". That is this
convention, and the text calls the days those of the "current month". Its shipped code divides by
the number of days in the **interest charge period** instead. The two agree only when interest is
charged on the 1st, so the calendar month and the charge period coincide. They differ for a
mid-month charge day.

What this changes:
- There is now external evidence that the convention exists in Australian calculator practice.
  Figura says a minority of lenders use methods other than Actual/365, but names none.
- It is still not a lender, regulator or standards source, and Figura's own text and code disagree
  on the denominator for a mid-month charge day.
- Figura's "30/360" label must not be confused with MSRB G-33 30/360. RD-084 keeps the explicit
  identifier.

## Consequence

The convention is implemented and tested against the independent oracle, but it is **not
selectable** (FR-050, FR-215). It becomes selectable only when a verified lender or regulator source
(and a reference fixture) is added here, or the owner decides that Figura's calculator evidence
suffices for the 1st-of-month charge case. A separate identifier would be needed for the
charge-period variant.

## Fixtures

- `allocation-synthetic`: synthetic, oracle-derived; not reference coverage.
