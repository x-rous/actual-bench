# Actual/Actual (calendar, ISDA method): reference sources

status: verified
convention: actual-actual-calendar
reviewed: 2026-09-29

## Verified

1. **ISDA, "EMU and Market Conventions: Recent Developments"**, BS:9951.1, 25 November 1998,
   https://www.isda.org/a/AIJEE/1998-ISDA-memo-EMU-and-Market-Conventions-Recent-Developments.pdf
   (retrieved and read in full 2026-09-29). Section 4 defines the ISDA method (each part of a
   period uses its own calendar year's denominator, start inclusive, end exclusive) and prints
   worked amounts. Seven of its ISDA-method figures are encoded in `isda-1998-memo`.
   License: publicly posted by ISDA; figures quoted as test values with attribution.

## Discrepancy found in the source

Page 6, second period (15 July 2003 to 15 January 2004): the memo prints the ISDA method as
184/365 = £504.11. That period crosses into 2004, a leap year, and the memo's own definition gives
170/365 + 14/366 = £504.00. It looks like a typesetting error (the AFB figure beside it is also
184/365, correctly for that method). The row is excluded from the fixture; neither value is
encoded.

## Not coverage

- The ISMA/ICMA and AFB variants in the same memo are different conventions and are not
  implemented.
- ISDA 2006 Definitions §4.16(b) (the current text) is not publicly available and was not read.

## Fixtures

- `isda-1998-memo`: reference (published figures).
- `cross-year-synthetic`: synthetic, oracle-derived crossings in both directions.
