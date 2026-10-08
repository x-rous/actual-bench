# RD-084 reference oracle

Test-only reference calculations for the Assets & Debt engine. Fixture expected values under
`src/lib/financial-models/loan/__fixtures__/` come from a cited publication or from this oracle,
never from the engine being tested.

## Why it is separate

A shared bug cannot pass both sides if the two sides share no code:

- ESLint (`eslint.config.mjs`) refuses any import from `src/test-oracles/rd084/**` into
  `src/lib/financial-models/**`, by alias or relative path, and the reverse.
- `importGuard.test.ts` repeats the check without ESLint.
- The techniques differ on purpose. The engine uses fixed-point decimals, civil-day formulas and
  Newton roots. The oracle uses exact rationals, `Date.UTC` day by day, and bisection.

## What it checks

`oracle.test.ts` first reproduces published figures (the ISDA 1998 memo, Unloan, the York
University j2 guide), and then requires every fixture's `expected.csv` to equal what the oracle
computes. A hand-edited or engine-generated expected value therefore fails here.

## Rules

- Never import from `src/lib/financial-models/`.
- Keep it slow and obvious. Clarity beats speed here.
- A new convention gets its oracle formula from the spec or a cited source, with the citation in a
  comment.
