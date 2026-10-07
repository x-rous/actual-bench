# Actual/365 Fixed: reference sources

status: verified
convention: actual-365-fixed
reviewed: 2026-09-29

## Verified

1. **Unloan (a division of Commonwealth Bank of Australia)**, "How do banks calculate the interest
   on my home loan?", https://www.unloan.com.au/learn/how-do-banks-calculate-the-interest-on-my-home-loan
   (retrieved 2026-09-29). Lender publication. States daily interest as `(P x R) / T` with T = 365
   and works `($600,000 x 0.045) / 365 = $73.97`. Used as fixture `unloan-daily-example`.
   License: a single published figure quoted as a test value with attribution; no content copied
   beyond the formula and the figure.
2. **Figura home loan repayment calculator, method notes**, https://figura.com.au/calculators/repayments
   (retrieved 2026-09-29). Calculator publisher, not a lender. Documents that "most Australian
   lenders use the Actual/365 interest method" and that Actual/365 "effectively charges an
   additional day of interest every leap year", which is the 365-on-29-February behavior. Used for
   the leap-year behavior only; no figures taken.

## Not coverage

- Secondary explainer sites (Canstar, Hunter Galloway, WOWA) repeat the formula; not used.
- ISDA 2006 Definitions §4.16(d) defines "Actual/365 (Fixed)" but is not publicly available; it
  was not read for this work and is not cited as verified.

## Fixtures

- `unloan-daily-example`: reference (published figure).
- `leap-and-boundaries`: synthetic, oracle-derived edge cases (29 February, year ends, month ends).
