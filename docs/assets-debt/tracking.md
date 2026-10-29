# Assets & Debt: loan tracking

Loan tracking keeps a saved loan in step with the payments in Actual. It replaces the earlier Sync Repayments
workflow (matching rules, backtests, postings and reconciliation), which was removed in schema v60. Reading
and planning never write; Actual changes only when the person presses Apply, Undo split, Edit split or Save
Notes.

## Boundary and data flow

One read per refresh (`features/assets-debt/lib/trackingReads.ts`, `useLoanTracking.ts`) takes a sync, the whole
loan account, the paying side of its transfers and the payment rules' accounts in one grouped query, and the
payees once per connection. Direct and HTTP transports therefore use the same normalized transaction contract
through `getTransport(connection)`. The plan runs in the browser, so a refresh writes nothing to Bench's database.

`planTracking` (`lib/assets-debt/tracking/plan.ts`) is pure. From the loan account, the payments around it, the
person's Loan Ledger classifications and the payment rules it produces:

- the **Loan Ledger**: every loan-account row with its type, suggested or saved;
- **installments**, one per due date from the tracking start, each Recorded, Unrecorded, Check, Missing or
  Upcoming, with the proposal that would record it;
- the **events** that reach Terms & Schedule from Actual (extra principal, draws, fees, adjustments);
- the **figures** shown above Repayments (owed in Actual, what the calculation expects, the next payment);
- the **anchor**: where a projection of the rest of the loan starts.

Installments before the tracking start count as paid as contracted. A payment is a transfer into the loan account,
an existing split with one principal transfer line, or a payment-rule match; `alignPayments`
(`lib/financial-models/matching/align.ts`, the only part of the old matching code that remains) pairs payments
with due dates by date and amount, and pins from saved classifications win. Interest is allocated from what
really happened, with the same day count and charging as the engine.

### The anchor and early payments

The engine schedules every contract date strictly after its anchor. A payment made before its installment's due date
covers that installment, so restarting from the payment date would schedule it a second time. The plan therefore
reports `anchor.restartDate` (the due date of the last covered installment, otherwise the date of the last real
event) and `anchor.accruedInterestMinor` (interest accrued from the payment to that date, minor units, read at the
last real event). `inputFor` in `useLiveProjection.ts` starts the projection from `restartDate` with that interest;
what-ifs dated in the gap move to the following day. "Next payment" is the first installment after today that no
payment covers. The engine itself is unchanged.

## Payment rules

A payment rule finds repayments recorded as an expense in a bank account instead of a transfer. Rules use the shared
transaction conditions (`lib/transactions/conditions`) through `tracking/paymentRules.ts`, and are stored per loan
(`debt_payment_rules`, at most 10 per loan in the UI). A payment already split in Actual belongs to whatever its
lines say, never to a rule, and a payment a rule found that no installment took is not extra principal.

## Writes

`tracking/proposals.ts` builds proposals from the existing restructure, convert, create, restore-split and
adjust-split documents, so the shared executor (`executeOutput` in `applyService.ts`) and its verification apply
them unchanged. `features/assets-debt/lib/trackingWrites.ts` (`applyProposals`) syncs first, records each write in
`debt_writes` before touching Actual, runs the executor, finishes the journal row, and stops at the first write
that does not apply. Loan-side rows are marked cleared together at the end of a batch.

A journal row is `applying`, `applied`, `failed` or `uncertain`. A unique index allows one `applying` row per loan,
so a second tab cannot start another write. An `uncertain` or interrupted row locks further writes until the person
checks Actual and resolves it through `PATCH .../tracking/writes/[writeId]`; it is never retried automatically.
When a write applied in Actual but its journal row cannot be finished, the run stops with a message and the row
stays `applying`.

The routes are under `/api/assets-debt/debts/[id]/tracking` (`route.ts` for the bundle, `ledger`, `rules`,
`writes`, `writes/[writeId]`).

## Persistence and versioning

Schema v60 adds, to `debts`, `tracking_start_due_date`, `opening_observation_id`, `principal_note_suffix`,
`interest_note_suffix` and `missing_grace_days`; to `debt_future_assumptions`, an `enabled` switch; and the tables
`debt_ledger_entries` (classifications, keyed by budget and Actual transaction), `debt_payment_rules` and
`debt_writes`. Tracking requires an off-budget loan account. Tracking settings and switched-on events do not change a
loan's revision hash.

It drops `debt_transaction_links`, `debt_posting_leases`, `financial_postings` and `debt_match_rules`. Before
dropping, each old repayment rule that named both a source account and an exact payee becomes a payment rule
(`migrated-<old rule id>`); a rule that also limited the amount is not carried over, because a payment rule has no
amount condition. Extra payments recorded from Actual as events are deleted, since the Loan Ledger reads them from
Actual.

## Calculation limits

Engine refusals reach the person through `lib/financial-models/loan/blockMessages.ts`, which gives each a plain
sentence and a kind (day-by-day interest lifts it, the loan needs a change, or it is not supported). The server
applies the same rule when a loan or its assumptions are saved (`assertCalculable` in `debtConfigService.ts`), so a
loan that once-per-period interest cannot follow is refused and rolled back.
