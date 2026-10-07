# Fixture isda-1998-memo

id: actact-isda-1998-memo
country: GB
currency: GBP
source-name: ISDA, 'EMU and Market Conventions: Recent Developments' (BS:9951.1, 25 November 1998), section 4, ISDA method
source-url: https://www.isda.org/a/AIJEE/1998-ISDA-memo-EMU-and-Market-Conventions-Recent-Developments.pdf
source-type: industry-standard body publication
verified: 2026-09-29
conventions: actual-actual-calendar
engine-versions: daycount-actact-calendar@1, money-kernel@1
coverage: reference

Every row is an "ISDA Method" figure printed in the memo for a £10,000 notional at 10%, e.g.
page 3: `£10,000 × 10% × (61/365 + 121/366) = £497.72`. The memo defines the method as: days in a
leap year over 366 plus days outside it over 365, the period running from and including the
first date to but excluding the last. This is `actual-actual-calendar` (FR-038).

**Erratum, excluded:** page 6 prints the ISDA method for 15 July 2003 to 15 January 2004 as
`184/365 = £504.11`, but that period includes 14 days of 2004, a leap year, so the memo's own
rule gives 170/365 + 14/366 = £504.00. The row is left out rather than encoded either way; see
SOURCES.md.
