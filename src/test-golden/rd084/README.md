# RD-084 golden suite

Compares the calculation engines (`src/lib/financial-models/`) with the independent oracle
(`src/test-oracles/rd084/`) and with published anchors.

The engine and the oracle may not import each other, in either direction
(`eslint.config.mjs`). This folder is the only place that sees both, so a shared mistake cannot
pass on both sides. It is task T068's golden suite; it lives here rather than under
`financial-models/loan/` for that reason.

## V3 §40.1 cases

| # | Case | Where |
|---|---|---|
| 1, 2, 3, 10, 12, 29, 32–35 | zero rate; level payment; constant principal; j2; delayed payment change; interest-only then recast; balloon; true-up; residual; payment rounded up finishing early | `periodic.golden.test.ts` (against the oracle) |
| 13, 31, 36 | missing rate, negative amortization blocked, overpayment | `periodic.golden.test.ts` (blocks) |
| 27, 30 | recurring fee (MoneyVox, all 48 cells); payment cap and negative amortization (ProEducate, all six figures) | `periodic.golden.test.ts` (published) |
| 4–7, 11, 14–26, 28 | first partial period; Act/365F; Act/Act; Act/360; mid-period rate change; start- and end-of-day; daily accrual with monthly charge; weekly and fortnightly; the five offset cases; recurring extra; lump sum; redraw; capitalized fee | `daily.golden.test.ts` (against the oracle) |
| 8 | 30/360 | out of scope: `msrb-g33-30-360` is researched, not a loan convention (owner decision 2026-09-29) |
| 9 | monthly 30/360 allocation | refused as unselectable (`engine.invariants.test.ts`) |

## Other sets

- §40.2 derivation: `daily.golden.test.ts`.
- §40.3 rounding and precision: both files, including a 30-year daily run.
- Fannie Mae §1103 in the cash schedule: `daily.golden.test.ts`.
- The convention diagnostic: `diagnostics.golden.test.ts`.
