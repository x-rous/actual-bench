# Actual/360: reference sources

status: verified
convention: actual-360
reviewed: 2026-09-29 (upgraded in the second pass)

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

3. **Fannie Mae Multifamily Guide, Part III Ch. 11 §1103 "Actual Amortization Calculation"**,
   https://mfguide.fanniemae.com/node/5286 (retrieved 2026-09-29; found through mortgagemath's
   fixture, then read at source). It is a worked Tier 2 SARM example with published anchors: a
   6.8134680% debt service constant at 5.500%, $4,114,494.17 aggregate principal over 120
   payments, and a $34,287.45 fixed monthly principal. Encoded as `fanniemae-mf-1103`; every
   published value is claimed.

## What the sources establish

- Interest per period is balance × annual rate × actual days / 360. For §1103 the days are those of
  the month before each payment date.
- The **payment** is an ordinary level annuity at annual rate / 12. It is **not** derived with a
  365/360-bumped rate: the published debt service constant fixes this.
- The §1103 aggregate is reproduced only with the payment and interest at full precision. It is a
  prescribed calculation, not a cent-rounded servicer schedule; see the fixture's source.md.
- Nothing in these sources restricts Actual/360 to monthly payments. mortgagemath does, because its
  only fixtures are monthly; RD-084 treats that as a fixture gap, not a rule.

## Coverage limits

The `variable-month-lengths` amounts remain oracle-derived. `fanniemae-mf-1103` is the published
numerical anchor. Fannie Mae §1104 and §1106 (cited by mortgagemath) were not read.

## Not coverage

- Commercial-real-estate explainer blogs (PropertyMetrics, Private Capital Investors) print
  Actual/360 examples; they are not lenders or regulators and are not used.

## Fixtures

- `variable-month-lengths`: synthetic, oracle-derived (28, 29, 30 and 31-day months; a leap year).
- `fanniemae-mf-1103`: reference (every published §1103 value).
