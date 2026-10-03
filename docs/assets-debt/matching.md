# Assets & Debt: repayment matching and backtests

RD-084 P1.4 adds deterministic, read-only matching between modelled debt periods and existing
Actual transactions. It does not post transactions, edit categories or splits, create Actual rules,
learn categories, accept reconciliation drift or start automation.

## Boundary and data flow

The interactive Rules page reads each named source account once for an inclusive, bounded date
window through `getTransport(connection).listTransactionsForSync()`. Direct and HTTP modes therefore
use the same normalized transaction contract, including explicit split-child ids and conservative
cleared, reconciled, provenance and transfer metadata.

Active Direct credentials and runtime state stay in the browser. The browser sends only the bounded,
normalized snapshots to `/api/assets-debt/debts/[id]/backtest`. The server validates that every row
belongs to its declared account and window, rebuilds expected periods from the stored debt revision,
evaluates the rule and caches the display result. The cache is invalidated whenever the rule changes
and is never trusted as an enablement decision.

## Matching DSL v1

Conditions and proposal actions use strict, versioned `rd084.debt-match-conditions` and
`rd084.debt-match-actions` envelopes. Unknown versions or identifiers block only that rule. Text is
normalized with Unicode NFKC, trimmed, whitespace-collapsed and case-folded. Amounts remain integer
minor units; basis-point tolerances use an exact integer inequality rather than floating point.

Enabled rules require the Bench-marker and posting-link exclusions, structural amount/date and
entity evidence, and a fresh backtest without ambiguous or unsafe periods. P1.4 does not execute an
enabled rule; the flag is retained for later policy-gated automation work.

Each expected period is classified as:

- `missing`: no candidate;
- `unique`: exactly one independently claimable candidate;
- `multiple`: more than one possible candidate, requiring Review;
- `unsafe`: a matched row has incomplete split metadata, represents only part of the payment or is
  otherwise unsafe to claim automatically.

Several funding rows are never grouped by subset search. An external row equal only to the model's
`Other funds` amount does not complete an offset-funded repayment. Split parents are never claimed;
stable children can be claimed independently.

## Persistence and versioning

Schema v42 adds `debt_match_rules` and `debt_transaction_links`. Claim identity is scoped by
`(budget_sync_id, actual_transaction_id, role)` for every role except `evidence-only`, allowing the
same Actual id in different budgets and distinct children from one split parent. The composite
debt/budget foreign key prevents cross-budget links.

There is deliberately no `posting_id` or `posting` link source in v42. Those arrive with the v44
posting table. P1.4 does not modify the calculation engine, debt config format, projection contract
or historical engine versions.
