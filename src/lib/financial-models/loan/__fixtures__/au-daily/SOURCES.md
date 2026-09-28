# Australian daily accrual, monthly charge (Figura-style): reference sources

status: verified-behavior
convention: actual-365-fixed accrual, monthly charge, weekly/fortnightly repayments
reviewed: 2026-09-29

## Verified (behavior)

1. **Figura home loan repayment calculator, method notes**, https://figura.com.au/calculators/repayments
   (retrieved 2026-09-29). Calculator publisher, not a lender. Quoted: "Interest is calculated
   daily on the current loan balance to 5 decimal places. At the end of the monthly period the
   total is then rounded to 2 decimal places before being charged. The calculator always charges
   interest monthly on the same day each month, except when the first interest charge falls on
   the 29th, 30th, or 31st. Following months with less days will instead charge interest on the
   last day of the month". Also: interest is "charged monthly" even with weekly or fortnightly
   repayments; weekly/fortnightly repayments are derived either by splitting the yearly total
   over 52/26 or by the "Split monthly" method that "assumes there are 48 weeks per year".
2. **Unloan (Commonwealth Bank of Australia)**, "How do banks calculate the interest on my home
   loan?" (see act365f/SOURCES.md): daily interest = balance × rate / 365, charged per period.

## Coverage limits

No published full schedule (dated repayments and monthly charges with amounts) was found. The
fixture's figures come from the independent oracle following the behavior above; the
interpretations it needed are listed in the fixture's source.md. No preset may claim to match a
named lender on the strength of this family (FR-050).

## Fixtures

- `fortnightly-monthly-charge`: synthetic, oracle-derived; consumed by the P1.2 daily engine.
