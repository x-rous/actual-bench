# HSBC UAE Ijara / financing schedule

## Source status

The contract facts, first five rows, regular payment, corrected final payment, totals and maturity
in `published.json` were transcribed from a real bank schedule supplied by the product owner on
2026-09-30. The underlying customer document is private and is not stored in this repository.

These are the only bank-published values in this fixture. Checkpoints after row 5 are independently
derived by `hsbc-uae.golden.test.ts` and must never be described as lender-published evidence.

## Evidenced interpretation

- Actual days / 360.
- Accrual begins the day after 2026-07-03.
- The scheduled payment on 2026-07-27 follows that day's accrual, producing 24 days of first-period
  profit: `1,500,000 × 4.49% × 24 / 360 = 4,490.00`.
- Profit is rounded half-up to cents at each payment posting.
- The regular payment is the level amount solved over the 300 actual dated cash flows, not a PMT at
  `4.49% / 12`.
- Balance precision is round-each-posting.

The product owner corrected the initially transcribed final payment from AED 8,376.83 to
AED 8,376.63. The corrected amount is arithmetically consistent with the published total:
`299 × 8,378.91 + 8,376.63 = 2,513,670.72`.
