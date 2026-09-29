# Assets & Debt: mortgagemath crosswalk

This compares the RD-084 calculation layer (`src/lib/financial-models/`) with
[mortgagemath](https://github.com/murraystokely/mortgagemath). The comparison uses commit
`efec448a3a3d5f9c916a98db06f530d9f895d736`, the MIT-licensed Python library, studied on
2026-09-29.

mortgagemath is a reference for comparison and a way to find sources. It is **not** a dependency.
No RD-084 behavior or expected value depends on it. Where it cites an original source, RD-084 read
that source (see `loan/__fixtures__/CANDIDATES.md`).

Classifications used in the table:

- **Same**: the same concept.
- **RD-084 broader**: RD-084 covers more than mortgagemath does.
- **mm useful**: mortgagemath has something worth borrowing for tests or design.
- **Deliberate**: RD-084 differs on purpose, for the reason given.
- **Investigate**: open for P1.2.

| Area | mortgagemath | RD-084 | Class |
|---|---|---|---|
| Exact arithmetic | Python `Decimal`, 50-digit context; floats rejected | BigInt fixed point, powers and roots exact, one rounding | Same |
| Working precision | 50 significant digits | 30 decimal places, versioned (`WORKING_SCALE`) | Same concept, different unit |
| Payment rounding | UP (default), DOWN, HALF_UP, HALF_EVEN | `paymentRounding`, same four modes, symmetric about zero | Same |
| Interest rounding | One mode per loan | `interestPostingRounding`, plus intermediate scale and mode | RD-084 broader |
| Currency unit | Power of 10, at most 1 | Minor digits ≥ 0 (unit 1 for JPY/KRW) | Same |
| ROUND_EACH | Balance rounded every period; interest on the rounded balance | `balancePrecision: round-each-posting` | Same |
| CARRY_PRECISION | Unrounded balance, **reduced by an unrounded payment**; display rounded | `carry-full-precision` keeps the unrounded interest remainder, but posted payments are cash (whole minor units) | Deliberate: RD-084 posts real cash. mortgagemath's mode is a *theoretical* schedule (Fannie §1103 is one). RD-084 reproduces §1103 at the primitive level. Whether the projection offers a theoretical unrounded-payment mode is a P1.2 question |
| Actual/360 forces carry | Yes, for every Actual/360 loan | No: precision is its own axis | Deliberate: no source ties them. §1103 shows its *aggregate* is full precision, not that every Actual/360 loan is |
| Quote / compounding | MONTHLY (r/ppy), SEMI_ANNUAL (j2), ANNUAL | `nominal-simple-periodic`, `nominal-compounded-monthly`, `nominal-compounded-semiannual`, `annual-effective` | RD-084 broader |
| 30/360 | `THIRTY_360`: `annual / 12` per payment; **no date arithmetic** | Regular periods: `nominal-simple-periodic`. Date-sensitive: `msrb-g33-30-360` (frozen, not exposed) | Deliberate: the names differ in meaning; mm's label does not close the 30/360 gate |
| Actual/360 | Days of the calendar month containing the period start; monthly only | Day-count segments for any period; any cadence | RD-084 broader. mm's monthly-only rule reflects its fixtures, not a financial constraint |
| Actual/365F, Actual/Actual | Not implemented (Actual/365 listed as future work) | Implemented and selectable | RD-084 broader |
| Frequencies | 52/26/24/12/4/1 abstract periods; `term × ppy` divisible by 12 | Real dates: every 7 or 14 days, semi-monthly, monthly, quarterly, annual, custom | Deliberate: RD-084 schedules are dated; 52 and 26 appear only in payment *derivation* |
| Payment derivation | Annuity at the frequency; accelerated bi-weekly = monthly ÷ 2 (constructor) | Five named derivations, independent of frequency | RD-084 broader |
| Term vs amortization | `term_months` and `amortization_period_months` (balloon) | Separate contractual and amortization terms (FR-045) | Same |
| Balloon | The final row keeps the balance (balloon at term) | `finalPayment: contractual-balloon` | Same |
| Interest-only | Leading IO months, then recast over the rest | `phases[]` IO windows with `recastAtEnd` | RD-084 broader (windows anywhere) |
| Variable rates | Payment-numbered `rate_schedule` (30/360 only) | Effective-dated rate periods, rate gap blocks | RD-084 broader; translate mm fixtures into dates |
| Recast | `recast` flag per change | `never`, `on-rate-change`, `annual`, `on-contract-date`, `lender-provided` | RD-084 broader |
| Payment cap | Factor of the prior payment | `payment_cap_minor` (absolute) per rate period | **Investigate**: a percentage cap cannot be expressed today (human decision) |
| Negative amortization | Allowed when the cap binds | `negativeAmortizationAllowed`, else Review or Blocked | Same concept |
| Final true-up | Final row lands at exactly zero; early payoff truncates with a warning | `true-up-to-zero`, `continue-until-paid`; never pushed through zero (FR-048) | Same; add P1.2 tests (below) |
| Payment override | `payment_override`; the final row absorbs the residual | `contractual-fixed` or `lender-provided` derivation | Same |
| Fees | Flat `fee_per_period` on top of P&I | Components with an economic kind (fee, insurance, escrow, tax…), cash-paid or capitalized | RD-084 broader |
| Offsets, redraw, daily events | Not implemented (future work) | Core requirements | RD-084 broader |
| Fixture method | TOML + CSV; every published value; synthetic rows explained; rejected sources recorded | `source.md` per fixture, `SOURCES.md` per family, independent oracle, lint isolation | Same discipline; RD-084 adds the oracle |

## Adopted from mortgagemath

- **Sources:**
  - Fannie Mae §1103, now an RD-084 Actual/360 reference fixture;
  - candidate originals for payment caps, fees and ARMs (CANDIDATES.md).
- **Discipline:** "all published values or no fixture", and a register of rejected sources.
- **P1.2 test ideas:**
  - early payoff caused by an up-rounded payment on a small principal (`EarlyPayoffWarning`);
  - a final-row true-up of one or two cents;
  - a payment override ended by a short final payment (FHLBB 1935).

## P1.2 test requirements identified

1. **True-up:** the final payment extinguishes principal exactly, and the final row may differ from
   the level payment by a few cents.
2. **Contractual balloon:** the balance at term equals the balloon, with no forced zero (Fannie
   §1103: $20,885,505.83 at payment 120 on the theoretical schedule, derived from the published
   aggregate).
3. **Early payoff from rounding:** an up-rounded payment on a small loan finishes early. The last
   payment is balance plus interest, and the schedule never goes into credit (FR-048).
4. **Continue-until-paid:** a fixed payment ends with a short final payment (FHLBB 1935, once read
   at source).
5. **Payment cap:** negative amortization appears when the capped payment is below the interest.
   The ProEducate figures apply only once a percentage cap can be configured.
6. **Recast:** annual recast versus recast on rate change, each asserted separately (Reg Z H-14,
   narrowed as described).
7. **IO to amortizing:** the IO payment equals interest, then recasts over the remaining term.
8. **Fees:** a flat cash-paid component leaves principal and interest unchanged (MoneyVox, 48
   cells). A capitalized fee raises the balance.
9. **Figura day order:** the `au-daily` fixture, which covers a charge on the charge date including
   that day, a scheduled repayment after the accrual, an extra repayment before it, and the
   clamped charge day.
