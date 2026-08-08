# Budget-month contract fixtures (PR-033 / F-088)

Small, **sanitized** budget-month payloads derived from real Direct + HTTP captures (amounts scaled and
categories renamed — no private data). They encode the golden cases the parity plan requires:

- **Tracking** (`tracking-month.json`): `totalBudgeted` **positive**; summary **excludes hidden**; a
  **carryover** category where **Balance ≠ Variance** (Car Fund: budgeted 1,000 + spent −1,000 → variance 0,
  but balance 500); a **refund** category with net-positive `spent`; income has `budgeted`/`received`/`balance`.
- **Envelope** (`envelope-month.json`): `totalBudgeted` **negative**; summary **includes hidden**; income is
  **`received`-only**; the funding bridge reconciles exactly
  (`incomeAvailable + lastMonthOverspent + totalBudgeted − forNextMonth = toBudget`); expense `balance` is
  carryover-inclusive (≠ budgeted + spent).

Both are in **Direct** shape (month object at top level). The HTTP transport wraps the same object as
`{ data: … }` and coerces some not-applicable Tracking funding fields `null → 0`; the parser handles both,
and `parseBudgetMonth.test.ts` asserts it. See `agents/planning/PR-033-phase0-contract-findings.md` for the
real-capture provenance.
