# Fixture fanniemae-mf-1103

id: act360-fanniemae-mf-1103
country: US
currency: USD
source-name: Fannie Mae Multifamily Selling and Servicing Guide, Part III, Chapter 11, Section 1103 "Actual Amortization Calculation" (Tier 2 SARM example)
source-url: https://mfguide.fanniemae.com/node/5286
source-type: GSE guide
verified: 2026-09-29
conventions: actual-360 accrual, nominal-simple-periodic payment (r/12), 360-payment amortization, 120-payment term, carry-full-precision with unrounded payment
engine-versions: daycount-act360@1, rate-quote@1, repayment@1, money-kernel@1
coverage: reference

Read from the original page (retrieved 2026-09-29), not from mortgagemath. Every value the example
publishes is claimed and reproduced:

| Column | Published | Value |
|---|---|---|
| debt_service_constant_pct_7dp | yes: "5.500% (6.8134680% debt service constant)" | 6.8134680 |
| aggregate_principal_minor | yes: "aggregate principal amortization amount over 120 payments is $4,114,494.17" | 411449417 |
| fixed_monthly_principal_minor | yes: "$4,114,494.17 ÷ 120 = $34,287.45" | 3428745 |
| monthly_pi_minor | derived: $25,000,000 × 6.8134680% ÷ 12 | 14194725 |
| balance_after_term_minor | derived: $25,000,000 − $4,114,494.17 | 2088550583 |

Also given: 5.500% gross note rate, $25,000,000, 30-year amortization, 10-year term, issue date
1 December 2018, first payment 1 January 2019, and "the number of days (i.e., 28, 29, 30, or 31)
in the month before each loan payment date" drives the amortization.

**What this proves.**

- **The payment is not rate-bumped.** The debt service constant equals 12 × the level payment at
  5.5%/12 over 360 payments, divided by the principal. The payment is derived on the ordinary
  monthly basis, not with a 365/360-bumped rate. With a bumped rate the constant would not be
  6.8134680%.
- **Accrual:** each period's interest is balance × 5.5% × (days in the calendar month before the
  payment) / 360.
- **Precision:** the published aggregate is reproduced exactly only when the payment and every
  month's interest are carried at full precision, with no rounding before the sum.

**What it does not prove.** It is not a servicer's cash schedule. With the payment rounded to
$141,947.25 the same loan amortizes $4,114,494.11 (interest at full precision) or $4,114,494.10
(interest rounded to cents each month), not .17. The
fixture therefore claims the calculation Fannie Mae prescribes for the aggregate, not the rounding
of real monthly postings. mortgagemath reproduces the same value the same way (carry-precision with
an unrounded payment) and was used only as a cross-check.
