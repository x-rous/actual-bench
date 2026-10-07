# Assets & Debt: the loan simulator

Developer notes for the loan pages (`src/features/assets-debt/`). A loan is simulated first and
tracked in Actual second. Simulating never saves anything and never reads or writes Actual.

## Two states

- **`SimulationState`** (`lib/simulatorModel.ts`) holds only what changes the calculation: amount,
  term, start date, rates, repayment frequency, the calculation profile, phases, fees and costs,
  offsets (as placeholders), event assumptions and revolving terms. It has no Actual account,
  category, lender pattern, engine choice or drift tolerance.
- **`TrackingState`** holds the Actual side: name, kind, direction, accounts, sign convention,
  lender pattern (no default), component destinations and categories, the offset-to-account map,
  monitoring settings and the status.

`simulationToModel` builds the engine's model from the simulation alone, through the same
`modelFromDetail` builder the server uses (`src/lib/assets-debt/model/buildModel.ts`), so a saved
loan projects exactly as it was simulated. `statesToSaveInput` joins both states into the existing
save input; saving goes through the unchanged revision rules.

An empty simulator opens with a useful sample: 500,000 over 20 years at 5.4%, paid monthly. Its
`SIMULATOR_DEFAULT_PROFILE` derives a level payment from the nominal annual rate divided by the
payment frequency, while interest accrues daily on Actual/365 Fixed and is charged with each
repayment after that day's accrual. It recalculates the payment on a rate change and adjusts the
last payment to clear the loan. It describes a calculation shape, not any lender. Reset restores
this sample after confirmation when meaningful input would be lost.

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
sentence is announced once per settled result. When optional event assumptions exist, the worker
also projects an otherwise identical loan with those assumptions removed. Contractual rate changes
remain in both projections. That baseline powers the
interest-saved/added and time-saved/added summary without duplicating financial logic in the UI. In
development the duration is logged with `console.debug`.

## Results

All figures come from engine output through pure functions:

- `lib/results.ts`: the four headline figures, deltas against the saved loan, and chart series (a
  series with no values is dropped);
- `lib/schedule.ts`: All events, Monthly and Yearly rows. It adds the engine's own movements (never
  payment minus interest), so each row reconciles opening to closing and the three views total the
  same. Payment number is a repayment sequence; the period label separately reports elapsed loan
  year/month and the calendar period. Optional columns appear only when they hold values. The Rate
  column comes from the engine's rate diagnostics ("Multiple" when a period mixes rates).
  "Principal" becomes "Debt reduction" when interest is charged on its own cadence.

The chart (`components/chart/`) is the only code that imports Recharts, loaded lazily with
`next/dynamic`; `eslint.config.mjs` rejects a Recharts import anywhere else. Its visible legend is
also the series control, and each line differs by both semantic colour and dash pattern. The custom
tooltip and every other amount display are currency-agnostic. Calendar labels are human-readable,
the balance and cumulative-interest axes are named and start at zero, dated rate changes use amber
dotted markers, and the final payoff is marked explicitly. The text summary preserves exact rate and
payoff dates for readers who do not use the visual chart.

Offset lines use `projection@2`'s effective-dated `offsetStates`. The daily engine applies an
authoritative snapshot first (observed over assumed), then all deposits, then all withdrawals for
each account and date. React groups and formats those state points; it does not replay offset events.
Because offset deltas are state changes rather than loan cash-flow events, they do not create rows or
repayment totals in the amortization schedule.

## Where each setting lives

- **Left configuration rail:** bordered fieldsets for Loan, Interest, Repayments, Offset account,
  and Fees and other costs. Each legend has an accessible explanation of its fields. Feature
  enablement uses switches; disabled dependent controls are hidden. Interest-only periods live
  with Interest, and blank optional contract/offset fields are labelled explicitly.
- **Right results column, below the chart:** Events, their calculated impact, add actions and one
  chronological table containing assumption events and contractual rate changes; then the
  amortization schedule. Rate rows reuse the Interest rate-period editor and remain separate from
  assumptions. Extra payment and Redraw/withdrawal each offer the loan or an active offset account;
  the offset choices create account-scoped deposits or withdrawals and may repeat. Set absolute
  offset balance remains a separately labelled snapshot/reset. An offset withdrawal above the
  available modelled balance stops for review instead of being capped or making the balance
  negative. Neither surface extends beneath the left settings rail.
- **Dialogs:** rate changes, individual extra repayments/redraws/fees/repayment changes/offset
  balance changes, recurring fees and costs, and interest-only periods.
- **Step 1 toolbar:** read-only calculation explanation, calculation-method editing and reset appear
  in that order before the primary Set up tracking in Actual action. Existing-loan save/discard/
  archive actions remain separate, and only the new-loan workflow displays the three-step marker.
- **Calculation method drawer:** every profile convention, including timing, same-day placements and
  precision, in a responsive two-column layout. It opens from the left at up to 820px, keeps the
  workspace visible without backdrop blur, and scrolls vertically without horizontal overflow.
- **Tracking setup:** everything Actual-specific.

`lib/fieldCoverage.test.ts` pins this: every config path and every saved column has a named
control or a stated reason, and the test fails when one loses its home.
