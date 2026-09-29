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
| `monthly-30-360-actual-day-allocation` | each month = 1/12 year, spread over its actual days | `daycount-monthly-alloc@1` | **no** (owner decision 2026-09-29: no lender or regulator source) |

**Researched, not a loan convention:** `msrb-g33-30-360` (MSRB Rule G-33(e) 30/360, no
February rule) is frozen with fixtures (`loan/daycount/THIRTY_360.md`), but by owner decision it
is not in `DayCountId`, the config vocabulary or the registry. A config naming it, or the
withdrawn generic `30u-360`, is an unknown identifier (`unsupported-config`).

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

The calculation profile stores every FR-035 axis on its own. A combination is refused only for a
stated reason, and "not built yet" is never treated as "impossible":

| Check | Meaning | Result |
|---|---|---|
| `validateProfile` | contradicts an axis's own definition (e.g. daily simple accrual capitalized daily; a split-monthly derivation paid monthly) | `inconsistent-profile` |
| `checkProfileSupport` | well-defined but not implemented (generated semi-monthly schedules in config v1; an intermediate scale beyond 30) | `unsupported-config` |
| day-count registry | no verified reference evidence (monthly allocation) | `unsupported-config` |

Nothing restricts Actual/360 to monthly payments or monthly compounding. Other libraries do,
because of where their fixtures come from, not because of the mathematics.

**Balance precision:**

- `round-each-posting` rounds the balance at each posting, and the next interest is computed on
  that rounded balance (mortgagemath's ROUND_EACH).
- `round-each-event` rounds after every event.
- `carry-full-precision` carries the unrounded interest remainder into the next period. Posted
  amounts are always whole minor units.

`carry-full-precision` (owner decision 2026-09-29) means:

- every posted or cash amount is a valid currency-unit amount;
- the configured interest and payment rounding is honored;
- any sub-minor remainder is carried separately and deterministically into the next period.

RD-084 never pretends an unpostable fractional-cent payment happened. A schedule that reduces
principal by an *unrounded* payment (mortgagemath's CARRY_PRECISION; Fannie Mae §1103's aggregate)
is a theoretical calculation. It is not offered as a mode, unless a product need and an independent
fixture justify it later.

**Interest-only** is a phase (config `phases`), never an amortization method. A whole-term
interest-only loan is one phase covering the term, plus `contractual-balloon`.

**Payment caps** (`PaymentLimit`, on rate periods) are either `absolute` (minor units) or a
`previous-payment-factor` (an exact decimal; `1.075` caps an increase at 7.5%). They are separate
from rate caps and floors, derivation and recast. Payment floors are not modelled.

**Repayment value date:** `repaymentEffectiveTiming` is `transaction-date` or `next-calendar-day`.
It shifts the date of the event. Where the event falls within that day is `eventOrder`'s job.

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

`end-of-day`, or a lender placement, moves scheduled repayments, other payments (extra
repayments, draws) and/or offset changes to after the accrual and after that day's charge (as Figura does).
Events are sorted by date, then by step, then by a stable key, so input order never matters.

Two boundaries follow from this order:

- **The charge includes its own day.** A charge on date C is taken after C's accrual, so it covers
  the days after the previous charge date up to and including C.
- **Accrual starts after the anchor.** A simulation starts from an anchor's closing state, so the
  first day to accrue is the day after the anchor.

| Behavior | Status |
|---|---|
| Steps 1–8 above, and the two boundaries | **RD-084 product default** (FR-047, `event-order@1`) |
| Repayments before the accrual (`start-of-day`) | **RD-084 product default**; configurable |
| Charge including its own day; accrual from the day after drawdown | Default, **also shown by the Figura calculator** |
| Redraws, extra repayments and offset deposits before the accrual; scheduled repayments after it and after the charge | **Figura calculator behavior** (verified from its shipped code); expressible as a placement, not the default |
| Daily interest to 5 places, charge rounded to cents, charge day clamped to the month end | **Figura calculator behavior** (method notes and code) |
| Any of the above as a lender's contractual rule | **Not established.** No lender publication was found |

Figura is a calculator. Its behavior is evidence of how it models a loan, not a universal
Australian lender rule (`loan/__fixtures__/au-daily/SOURCES.md`).

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

If a published worked example prints several values, a fixture that cites it reproduces **all**
the values it claims, or the fixture is narrowed in writing, or it is not adopted.
`loan/__fixtures__/CANDIDATES.md` lists sources that were examined but narrowed, deferred or
rejected, and records the reasons.

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

See `loan/__fixtures__/CANDIDATES.md`. It covers:

- the ISDA 1998 memo erratum;
- Reg Z H-14 (no reading reproduces all 30 printed cells);
- the withdrawn P1.1 claims about the February rule in MSRB G-33 and about the Australian daily
  fixture's boundary.

`docs/assets-debt/reference-crosswalk.md` compares this layer with mortgagemath.
