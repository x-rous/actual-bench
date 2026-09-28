# Actual/360: reference sources

status: verified
convention: actual-360
reviewed: 2026-09-29

## Verified

1. **Fannie Mae Multifamily Selling and Servicing Guide, 204.02A "Actual/360 Interest
   Calculation Method"**, https://mfguide.fanniemae.com/node/7941 (also in
   https://mfguide.fanniemae.com/node/5436, "Calculating Interest Due"; retrieved 2026-09-29).
   Quoted: "Interest will accrue based upon the actual number of days in a calendar month and a
   360-day year." Definition only; no worked amount.
2. **ISDA, "EMU and Market Conventions: Recent Developments"** (1998), section 5 and Exhibit 1
   (same document as the Actual/Actual sources). Names Actual/360 as the euro money-market day
   count and shows converting a 10% Actual/360 rate to Actual/365 (Fixed) by 365/360 = 10.139%.
   Used to check that the oracle's Actual/360 and Actual/365 Fixed differ by exactly 365/360.

## Coverage limits

No publicly available worked Actual/360 **interest amount** was found. The fixture's figures are
computed by the independent oracle from the verified definition (research R-14 allows oracle
expected values; they are never produced by the engine). The published 365/360 conversion is
checked in the oracle's own tests.

## Not coverage

- Commercial-real-estate explainer blogs (PropertyMetrics, Private Capital Investors) print
  Actual/360 examples; they are not lenders or regulators and are not used.

## Fixtures

- `variable-month-lengths`: synthetic, oracle-derived (28, 29, 30 and 31-day months; a leap year).
