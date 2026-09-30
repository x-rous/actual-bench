# Assets & Debt: the loan simulator

Developer notes for the loan pages (`src/features/assets-debt/`). A loan is simulated first and
tracked in Actual second. Simulating never saves anything and never reads or writes Actual.

## Two states

- **`SimulationState`** (`lib/simulatorModel.ts`) holds only what changes the calculation: amount,
  term, start date, rates, repayment frequency, the calculation profile, phases, fees and costs,
  offsets (as placeholders), extra transactions and revolving terms. It has no Actual account,
  category, lender pattern, engine choice or drift tolerance.
- **`TrackingState`** holds the Actual side: name, kind, direction, accounts, sign convention,
  lender pattern (no default), component destinations and categories, the offset-to-account map,
  monitoring settings and the status.

`simulationToModel` builds the engine's model from the simulation alone, through the same
`modelFromDetail` builder the server uses (`src/lib/assets-debt/model/buildModel.ts`), so a saved
loan projects exactly as it was simulated. `statesToSaveInput` joins both states into the existing
save input; saving goes through the unchanged revision rules.

The five-input default is `SIMULATOR_DEFAULT_PROFILE`: level payment, interest for each repayment
period at the nominal rate divided by payments per year, monthly repayments, the payment
recalculated on a rate change, and a true-up final payment. It describes a calculation shape, not
any lender.

## Day-by-day interest

`dailyEngineReason` runs the period-by-period engine and reports what it cannot represent (an
offset, an event between repayment dates, a rate change part-way through a period, an irregular
first period). The simulator then asks "This feature needs day-by-day interest calculation" before
applying the change; `switchToDayByDay` changes only the interest method. Nothing switches silently.

The calculation-method drawer also offers a dated cash-flow level payment for lenders that solve
the payment over the real daily-accrual schedule (for example, unequal Actual/360 month lengths).
That method requires a compatible day-by-day profile and stores config format v2; conventional
payment-frequency annuities remain config v1 and retain their existing arithmetic.

Extra repayments entered in the simulator are "up to" amounts on a normal amortizing loan. If an
occurrence pays the remaining charged debt, it is capped and shown at the amount actually applied;
later occurrences with nothing to pay do not create rows. The recurrence itself is kept intact so
a later redraw or capitalized fee can make a later occurrence relevant. Imported/observed cash is
not silently capped.

For an irregular first period, the term counts scheduled repayments from the first repayment date
unless the user supplies an explicit contractual maturity. More options exposes that maturity for
every term loan, not only balloons. It also exposes an optional **Contractual repayment amount**:
entering one selects the distinct `contractual-fixed` derivation; it does not silently replace an
annuity while leaving the result labelled derived.

## Live projection

`useLiveProjection` debounces input by 200 ms (typing only), then runs the projection through a
`ProjectionRunner` (`lib/projectionRunner.ts`):

- in the browser, a module Web Worker (`workers/projection.worker.ts`), because a 30-year daily loan
  with offsets and extras takes several hundred milliseconds (T199); a newer request terminates a
  busy worker, so the latest input always wins;
- in tests, `createSyncRunner`, injected through `ProjectionRunnerContext`.

The previous results stay on screen, marked as calculating, until the new ones settle; the headline
sentence is announced once per settled result. In development the duration is logged with
`console.debug`.

## Results

All figures come from engine output through pure functions:

- `lib/results.ts`: the four headline figures, deltas against the saved loan, and chart series (a
  series with no values is dropped);
- `lib/schedule.ts`: All events, Monthly and Yearly rows. It adds the engine's own movements (never
  payment minus interest), so each row reconciles opening to closing and the three views total the
  same. Optional columns appear only when they hold values. The Rate column comes from the engine's
  rate diagnostics ("Multiple" when a period mixes rates). "Principal" becomes "Debt reduction" when
  interest is charged on its own cadence.

The chart (`components/chart/`) is the only code that imports Recharts, loaded lazily with
`next/dynamic`; `eslint.config.mjs` rejects a Recharts import anywhere else.

## Where each setting lives

- **On the main surface:** the five inputs, then feature switches (interest-only, offset, fees,
  revolving terms, and under More options the first repayment date, contractual maturity,
  contractual repayment amount and balloon).
- **Dialogs:** rate changes, extra transactions (extra repayments, redraws, fees, repayment changes,
  offset balance changes), fees and costs, interest-only periods.
- **Calculation method drawer:** every profile convention, including timing, same-day placements and
  precision.
- **Tracking setup:** everything Actual-specific.

`lib/fieldCoverage.test.ts` pins this: every config path and every saved column has a named
control or a stated reason, and the test fails when one loses its home.
