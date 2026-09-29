# Candidate, narrowed and rejected reference sources

This file records sources that were examined but are not (or not yet) golden fixtures, so later
work does not rediscover the same discrepancies. The adopted fixtures and their provenance are in
each family's `SOURCES.md`.

## Fixture discipline

- **All or nothing per claim.** If a published worked example prints several values, a fixture
  that cites it must reproduce every value it claims as evidence. Never keep only the cells that
  agree with RD-084.
- **Record discrepancies.** When a source contradicts itself, write it down. Never "correct" the
  source silently. Either exclude the contradictory value (or the whole source), or narrow in
  writing what the source proves.
- **Cite the original.** Provenance names the original publisher: regulator, GSE, lender or
  textbook. A secondary library such as mortgagemath is a cross-check, never the source.
- **Independent expected values.** Every expected value comes from the cited publication, or
  from the oracle in `src/test-oracles/rd084/`. Never from the engine under test.

`src/test-oracles/rd084/candidates.oracle.test.ts` re-checks the numbers stated below.

## Adopted in the second pass

| Source | Where | What it proves |
|---|---|---|
| Fannie Mae MF Guide §1103 | `act360/fanniemae-mf-1103` | Actual/360 accrual on the month before each payment; payment at r/12, not 365/360-bumped; full-precision aggregate |
| MSRB Rule G-33(e) and its 1982 interpretation | `msrb-g33-30-360/*` | The G-33 30/360 day count (16 and 76 days); no February rule |

## Candidates for P1.2

These were read at source and verified by the oracle. They are not encoded yet, because P1.2 must
first translate their payment numbers into dated events.

| Source (original) | Evidence | Status | P1.2 use |
|---|---|---|---|
| **MoneyVox**, "tableau d'amortissement" (https://www.moneyvox.fr/credit/tableau-amortissement.php; consumer-finance publisher, not a lender) | €10,000, 5%, 12 months, insurance 0.35% a year on the initial capital: all 48 published cells reproduce (round each row, half-up, final row trued up, flat €2.92 insurance) | Strong candidate | A fixed cash-paid component (economic kind `insurance`) that leaves principal and interest untouched; final-payment true-up |
| **ProEducate "ARM Payment Caps"** PDF (https://www.proeducate.com/courses/Finance/PaymentCap.pdf), a 2014 republication of a consumer site; mortgagemath calls it a regulatory example, which it is not | $65,000 at 10% → 12%, 7.5% payment cap: all six printed figures reproduce with round-each rows ($570.42; $64,638.72; $667.30; $613.20; $65,059.62; $420.90 negative amortization) | Candidate. The figures are self-consistent, but the provenance is weak; the likely original is the Federal Reserve CHARM booklet, not yet found | Payment cap (`previous-payment-factor` 1.075), negative amortization |
| **Reg Z Appendix H, Sample H-14** (12 CFR 1026, eCFR; regulator) | $10,000, a 1-year ARM, 15 annual rows (rate, payment, remaining balance) | **Narrowed.** No reading reproduces all 30 cells (best 27). Recasting every year matches all 15 balances but gives $106.72 in 1992, 1994 and 1995 where H-14 prints $106.73. Recasting only on a rate change matches every payment but not the balances from 1992 on. The sample shows a payment that stays level when recomputation lands a cent lower, a rule the text does not state | Use the 15 balances and the 1982–1991 payments only, with the gap documented; never claim the full table |
| **CFPB interest-only sample Loan Estimate** | $211,000, 4%: IO payment $703.33 | Single anchor (per mortgagemath; original not re-read) | IO phase payment |
| **FHLBB *Review*, March 1935, Direct-Reduction Plan A** (FRASER) | $3,000, 6%, $30 a month, 138 payments plus a 139th of $29.27 | Original not yet read | `contractual-fixed` payment with `continue-until-paid` final payment |
| **Goldstein et al., *Finite Mathematics* 12e §10.3–10.4** | Row-level schedule; a 5/1 ARM (5.7% → 7.2%) | Original not yet read (publisher sample chapter) | Carry-precision rows; rate change with recast |
| **RBC accelerated bi-weekly** (calculator) | $350,000, 5% j2, bi-weekly payment of $1,017.81 | Calculator output only | Split-monthly derivation; note it uses 26 abstract periods, whereas RD-084 uses real 14-day dates |

## Rejected or withdrawn

| Item | Why |
|---|---|
| ISDA 1998 memo, ISDA-method figure for 15 Jul 2003 – 15 Jan 2004 (£504.11) | Contradicts the memo's own rule (the rule gives £504.00); excluded, and the other seven figures kept (`actact/SOURCES.md`) |
| P1.1 `au-daily/fortnightly-monthly-charge` | Assumed three things that are not Figura's behavior: a charge boundary of [previous, C), accrual on the drawdown day, and every repayment before the accrual. Replaced by `figura-order-fortnightly-monthly-charge` |
| P1.1 claim that MSRB G-33 has a last-day-of-February rule | It came from search summaries; the official text has no such rule. Withdrawn |
| mortgagemath `DayCount.THIRTY_360` as 30/360 evidence | It is `annual rate / 12` per payment period with no date arithmetic, so it cannot back a date-sensitive 30/360 |
| mortgagemath's rejected textbook sources (LibreTexts, OpenStax, Pima, Las Positas, Cagliari, nl.wikipedia, Vestergaard, Chase) | One-cent to five-dollar divergences recorded in its `docs/future-work.md`; not pursued |
