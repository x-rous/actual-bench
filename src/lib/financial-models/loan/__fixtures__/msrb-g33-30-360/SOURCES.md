# MSRB Rule G-33 30/360: reference sources

status: verified
convention: msrb-g33-30-360 (researched, not a loan convention: owner decision 2026-09-29; see ../../daycount/THIRTY_360.md)
reviewed: 2026-09-29

## Verified

1. **MSRB Rule G-33, "Calculations", section (e) "Day Counting"**, Municipal Securities Rulemaking
   Board, https://www.msrb.org/Rules-and-Interpretations/MSRB-Rules/General/Rule-G-33 (page
   published 2023-12-28; retrieved 2026-09-29). msrb.org returns HTTP 403 to direct fetches from this
   environment; the page was read through a reader proxy that renders the same URL
   (`https://r.jina.ai/<url>`). Section (e)(ii) as retrieved, verbatim:

   > Number of Days = (Y2 - Y1) 360 + (M2 - M1) 30 + (D2 - D1)

   > For purposes of this formula, if the symbol "D2" has a value of "31," and the symbol "D1" has a
   > value of "30" or "31," the value of the symbol "D2" shall be changed to "30." If the symbol "D1"
   > has a value of "31," the value of the symbol "D1" shall be changed to "30." For purposes of this
   > rule time periods shall be computed to include the day specified in the rule for the beginning
   > of the period but not to include the day specified for the end of the period.

   The rule contains **no last-day-of-February adjustment**. (P1.1's search-engine summaries said it
   did; they were wrong and are withdrawn.)
2. **MSRB interpretation of June 2, 1982, "Day counting: securities dated on the 15th of a month"**,
   published under the same rule page. Works June 15, 1982 to July 1, 1982 as `(0) 360 + (1) 30 +
   (-14) = 16 days`, and states that June 15 to September 1 "would correctly be figured as 76
   days". Both are encoded in `msrb-interpretations-1982`.

## Scope of the source

G-33 governs municipal-securities dealer calculations (accrued interest, price and yield), not
loans. It proves the algorithm, not that any lender uses it. Relevance to RD-084 loans is an open
decision (THIRTY_360.md).

## Not coverage

- OpenGamma Strata (`30/360 ISDA`, `30U/360`, `30U/360 EOM`): a reference implementation whose
  `30/360 ISDA` applies the same two rules; secondary only.
- SIA *Standard Securities Calculation Methods* and ISDA 2006 §4.16(f): not publicly available,
  not read.
- mortgagemath `DayCount.THIRTY_360`: not a day count at all (it charges `annual rate / 12` per
  payment period and never reads a date); see docs/assets-debt/reference-crosswalk.md.

## Fixtures

- `msrb-interpretations-1982`: reference (both published day counts).
- `month-end-rules`: synthetic; each row applies the verified text (31st rules, and the absence of
  any February rule), checked by the independent oracle.
