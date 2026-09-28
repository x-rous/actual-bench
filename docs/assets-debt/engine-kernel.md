# Assets & Debt: calculation kernel

Developer reference for the pure calculation layer behind debt automation
(`src/lib/financial-models/`). This covers the foundation: money, calendar, day counts,
rates, repayment derivation, the calculation profile and the fixture policy. The loan
engines that build on it are documented separately when they land.

## Boundaries

`src/lib/financial-models/` is pure. It may not import the app database, the Actual
transport, the automation engine, credentials, providers, routes, React or Next.
`no-restricted-imports` in `eslint.config.mjs` enforces this, so any result can be
reproduced from its recorded inputs alone. Actual write mechanics (split updates,
transfer links, settle timing) belong to the write path, never here.

## Money kernel (`money/`, `money-kernel@1`)

- `Dec = { int: bigint, scale: number }`, meaning `int × 10^-scale`. You build one from a
  decimal string (`dec("0.0449")`) or from integer minor units (`fromMinor`), never from a
  JavaScript number with a fraction.
- `add`, `sub` and `mul` are exact. `div`, `powInt` and `nthRoot` take an explicit scale;
  `div` and `powInt` also take a rounding mode, and round exactly once.
- `nthRoot` is an exact integer Newton root **truncated** at the requested scale. The
  same inputs always give the same digits.
- Rounding modes (`money/rounding.ts`) are symmetric about zero:
  - `half-up`: ties go away from zero.
  - `half-even`: ties go to the even digit.
  - `up`: away from zero.
  - `down`: toward zero (truncate).
- `WORKING_SCALE = 30` is the default intermediate precision. A calculation profile can
  choose full, currency or fixed-N intermediate precision (FR-046).
- `toMinor` converts to integer minor units and throws outside the safe-integer range.
  Rounding happens only where the profile says it does.

## Calendar (`calendar/`, `calendar@1`, `schedule@1`)

- Dates are `YYYY-MM-DD` strings. Arithmetic uses integer day numbers (Hinnant's civil
  algorithms), never `Date`, so time zones cannot shift a result.
- Periods are half-open: `daysBetween(a, b)` counts `a` but not `b`.
- Month arithmetic keeps the anchor day and clamps it in short months
  (`clamp-to-last-calendar-day`, the FR-049 default). For example, 31 Jan steps to
  29 Feb 2024 and then to 31 Mar.
- Weekly and fortnightly schedules step exactly 7 or 14 days, so a year can hold 53
  weekly or 27 fortnightly dates. Monthly, quarterly and annual schedules count from the
  first date.

## Day counts (`loan/daycount/`)

A convention returns whole-day segments over an integer denominator. The year fraction
is then an exact fraction, and interest rounds once (`periodInterest`).

| Identifier | Rule | Version | Selectable |
|---|---|---|---|
| `actual-365-fixed` | actual days / 365, also on 29 Feb | `daycount-act365f@1` | yes |
| `actual-actual-calendar` | each day / its own year's length (ISDA method) | `daycount-actact-calendar@1` | yes |
| `actual-360` | actual days / 360 | `daycount-act360@1` | yes |
| `monthly-30-360-actual-day-allocation` | each month = 1/12 year, spread over its actual days | `daycount-monthly-alloc@1` | **no** (no verified source) |
| `30u-360` | not implemented | none | **no** (gated; see `loan/daycount/THIRTY_U_360.md`) |

Implemented is not the same as selectable. `daycount/registry.ts` declares which
conventions are selectable, and `registry.test.ts` checks that claim against the
evidence: the family's `SOURCES.md` must say `status: verified`, and every fixture in the
family must pass through the engine. The config parser rejects an unselectable
convention as `unsupported-config`, which blocks only that debt. Every recorded
day-count version can be resolved by id (`resolveDayCountVersion`).

## Rates (`loan/rates.ts`)

- `rateOn` and `rateSegments` look up effective-dated rates with caps and floors. A date
  before every row returns `{ ok: false, code: "rate-gap" }`, which blocks the
  calculation (FR-043).
- `periodicRate(quote, r, k)` converts a quoted annual rate to the rate per repayment
  period, independent of day count (FR-037):
  - `nominal-simple-periodic`: r/k.
  - `nominal-compounded-monthly`: (1 + r/12)^(12/k) − 1.
  - `nominal-compounded-semiannual` (Canadian j2): (1 + r/2)^(2/k) − 1.
  - `annual-effective`: (1 + r)^(1/k) − 1.

  Compounded rates are formed from an exact integer ratio and rounded half-even once.

## Repayment (`loan/repayment.ts`)

Repayment frequency (how often) and derivation (how much) are separate axes, never
conflated:

- `annuity-at-payment-frequency`: level payment at the payment frequency's own rate.
- `monthly-equivalent-pro-rata`: monthly × 12 ÷ 26 or × 12 ÷ 52.
- `split-monthly`: monthly ÷ 2 or ÷ 4. Over a year this pays about one extra monthly
  payment.
- `contractual-fixed` and `lender-provided`: the amount is taken as given.

The level payment uses `P·r·(1+r)^n / ((1+r)^n − 1)`, or P ÷ n at a zero rate.

## Profile and config (`loan/profile.ts`, `loan/configSchema.ts`)

The calculation profile stores every FR-035 axis on its own. `validateProfile` refuses
contradictory combinations as `inconsistent-profile` and names the conflicting axes. For
example, daily simple accrual cannot be combined with daily capitalization, and a
split-monthly derivation needs weekly or fortnightly repayments.

`parseDebtConfig` reads `rd084.debt-config` version 1 and never throws. It returns one
of:

- `ok`;
- `unsupported-config`: a newer version, an unknown identifier, or an unselectable
  convention;
- `invalid-config`;
- `inconsistent-profile`.

Every identifier version 1 accepts is frozen in
`loan/versions.ts#DEBT_CONFIG_V1_IDENTIFIERS`, and `identifiers.test.ts` holds that
freeze. Adding an identifier means adding a config version, not editing version 1.

## Same-day order (`loan/events.ts`, `event-order@1`)

The default order within a day follows FR-047:

1. contract or rate changes;
2. external cash;
3. payments;
4. offset changes;
5. determine the balance;
6. accrue;
7. charge;
8. close.

`end-of-day`, or a lender placement, moves payments and/or offset changes to after the
accrual, but still before the charge. Events are sorted by date, then by step, then by a
stable key, so input order never matters.

## Versions (`loan/versions.ts`)

Each component has its own version (`name@n`), and every result records the full
component map. Registries are append-only: changing behavior means registering a new
version beside the old one. An unknown version returns
`unsupported-engine-version`; it never falls back to another version.

## Fixture policy

Fixtures live in `loan/__fixtures__/<family>/<fixture>/`. Each fixture has:

- `input.json`;
- `events.csv`;
- `expected.csv`;
- `source.md`, giving the id, country and currency, the source name, URL and type, the
  date it was verified, the conventions, the engine versions, and a coverage of
  `reference` or `synthetic`.

A fixture without a complete `source.md` does not load. Each family's `SOURCES.md`
records its status: `verified`, `verified-behavior`, `no-verified-source` or `gated`. It
also lists every source consulted and says why any source was not used.

Expected values come **only** from a cited publication or from the independent oracle
in `src/test-oracles/rd084/`. They never come from the engine under test:

- The oracle uses exact rationals, `Date.UTC` day walking and bisection, so it shares no
  technique with the engine.
- ESLint forbids imports between the oracle and `src/lib/financial-models` in either
  direction, and `importGuard.test.ts` repeats that check.
- `oracle.test.ts` requires the oracle to reproduce the published figures, and requires
  every `expected.csv` to equal the oracle's output.

No preset may claim to match a named lender unless a verified reference fixture backs it
(FR-050).

## Known source issues

The ISDA 1998 memo prints the ISDA-method figure for 15 Jul 2003 to 15 Jan 2004 as
184/365 (£504.11). Its own rule gives 170/365 + 14/366 (£504.00), so that row is
excluded (`__fixtures__/actact/SOURCES.md`).
