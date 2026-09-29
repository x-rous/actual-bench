# 30/360: freeze record

**Status:** the algorithm is frozen as `msrb-g33-30-360` and fixture-backed. It is **not
implemented and not selectable** until someone decides that RD-084 loans need it (tasks T035 done;
T041 open).

## Why not "30U/360"

The names "30/360", "30/360 US", "30U/360", "Bond Basis" and "30/360 SIA" are applied to
different algorithms. They differ in how they treat the 31st and the last day of February:

| Variant | D1 | D2 | Feb 28 2023 → Mar 31 2023 |
|---|---|---|---|
| **MSRB G-33(e)** (verified) | 31 → 30 | 31 → 30 if D1 is 30 or 31 | **33** |
| Strata "30/360 ISDA", or "30U/360" without an end-of-month flag | 31 → 30 | 31 → 30 if D1 (after adjusting) is 30 | 33 |
| Strata "30U/360 EOM" (the SIA February rule) | last day of Feb → 30, then 31 → 30 | both last day of Feb → 30; 31 → 30 if D1 is 30 | 30 |
| 30/360 PSA | last day of any month → 30 | as ISDA | 30 |

The first two rows always give the same count. Checking D1 ∈ {30, 31} before adjusting D1 is the
same test as checking D1 = 30 after adjusting it. That equivalence is established from Strata's
code, a secondary source; the ISDA text itself was not read. The February variants differ, so a
generic "30U/360" identifier would be ambiguous. RD-084 names the convention after its verified
source.

## `msrb-g33-30-360` (algorithm, version 1)

Source: MSRB Rule G-33(e)(ii), read verbatim on 2026-09-29 (see
`__fixtures__/msrb-g33-30-360/SOURCES.md`).

```text
days = (Y2 − Y1) × 360 + (M2 − M1) × 30 + (D2 − D1)
  if D2 = 31 and D1 ∈ {30, 31}: D2 = 30
  if D1 = 31:                   D1 = 30
year fraction = days / 360
```

- **Start and end dates:** the period includes its first day and excludes its last day, as the rule
  states.
- **31st rules:** exactly the two above.
- **February:** no adjustment. The last day of February (28 or 29) is used as written. The rule does
  not mention February, and RD-084 does not invent a rule for it.
- **Fixtures:**
  - `msrb-interpretations-1982` (reference): the MSRB's own worked counts, 16 and 76 days;
  - `month-end-rules` (synthetic): computed by the independent oracle from the verified text.

## Is it relevant to RD-084 loans?

These are two separate questions:

- **A. Is the algorithm well defined and backed by fixtures?** Yes.
- **B. Do RD-084 users need it for loans?** Not shown.
  - G-33 regulates municipal-securities dealer calculations, not loans.
  - Fannie Mae's Multifamily Guide 204.02B names a "30/360 interest calculation method" for loans
    ("a 30-day month and a 360-day year") but does not say how the 31st or February is treated.
  - For regular monthly periods, every 30/360 variant charges exactly 1/12 of a year per month.
    RD-084 already does that without any day count: a `nominal-simple-periodic` quote at
    12 payments a year gives r/12 per payment.

  The variants differ only for part periods, such as a first stub period, a payoff in the middle of
  a month, or a rate change mid-period. No loan source seen so far says which variant applies to
  those.

## What would expose it

1. An owner decision that a loan contract needs a date-sensitive 30/360. The best evidence would be a
   lender document naming its part-period rule.
2. T041 implements `daycount-msrb-g33-30-360@1` exactly as written above, and registers it as
   selectable once both fixtures pass through the engine.
3. G-33 defines counts for periods, not for single days, so `accrual` other than `per-period` stays
   unsupported (`checkProfileSupport`).

A lender whose part-period rule differs from G-33 would need its own named convention. It must not
be forced into this one.
