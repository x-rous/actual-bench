# HSBC AED 350,000 loan source

The repository owner supplied a private HSBC amortization schedule. The bank-published facts are:

- AED 350,000 opening principal on 25-Oct-2023;
- displayed rate 6.99% reducing;
- AED 8,379.57 contractual repayment;
- 48 monthly installments from 01-Dec-2023 through 01-Nov-2027;
- the five rows in `published.json`;
- a later contractual installment dated 02-Sep-2024.

The private document is not committed. `published.json` contains only the values needed for the
regression and labels them `bank-published`.

## Calculation-rate evidence

Exact 6.990000% Actual/365 over the 37-day first period gives AED 2,480.013698… and rounds half-up
to AED 2,480.01, one cent below the published AED 2,480.02. The five published rows share a common
annual calculation-rate interval of 6.990003668%–6.990009764%. The fixture uses 6.990005% as an
independently inferred point inside that interval to reproduce the published rows. This is not
claimed to be a bank-published contractual rate; it is evidence that the displayed 6.99% is not the
complete calculation input.

## Date evidence

01-Sep-2024 was a Sunday and the source row is 02-Sep-2024. That is consistent with a following
business-day adjustment but does not identify the full weekend/holiday calendar, adjustment rule,
or accrual-effective convention. RD-084 P1 explicitly excludes business-day calendars, so the
engine fixture records the source exception but keeps its unadjusted monthly generator. Later
checkpoints and totals are therefore labelled independently derived and unadjusted, not bank rows.
