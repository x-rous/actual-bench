# HSBC AED 350,000 repayment history source

The repository owner supplied the lender's own account history for the loan in
`../hsbc-aed-350k`: 35 repayments of AED 8,379.57 from 25-Nov-2023 to 25-Sep-2026, each with the
lender-reported principal, interest and balance. The private statement is not committed;
`history.json` holds only those values plus the dates derived from them.

## What was derived, and how it was checked

- **Due dates.** The 1st of each month, moved to the following business day. Non-business days
  are Sunday and nine explicit holiday dates (New Year 2024/2025/2026, 2-3 Dec 2024, 30 Mar-2 Apr
  2025). Saturday is a business day. Every lender row agrees with these dates.
- **Interest.** 6.99% Actual/365 simple daily interest on the actual balance, with each repayment
  reducing the balance on its actual (early) date.
- **Statement allocation.** Repayment k reports `A(k) - A(k-1)`, where `A(k)` is the accrual from
  drawdown to due date k with earlier repayments on their actual dates and repayment k on its due
  date. The early-payment benefit therefore shows up one repayment later.
- **Fit.** 34 of 34 regular rows agree within AED 0.01 (an unresolved one-fils rounding residual),
  and the reconstructed balance stays within AED 0.02 of the lender's and ends on it exactly.

## The known anomaly

The last row (25-Sep-2026, normal due date 01-Oct-2026) reports AED 735.29 interest where the
convention gives AED 635.28: AED 100.00 more. It is recorded as `anomaly` and treated as a separate,
unexplained lender charge. The calculation is never fitted to it.

The working is in the RD-084 spec evidence (`hsbc-350k-2023-history.md`,
`hsbc-350k-2023-convention-fit.py`).
