# 30U/360: freeze record (gate open)

**Status: not frozen. Not implemented. Not selectable.** (tasks T035 / T041, FR-038, FR-215)

FR-038 requires "`30u-360` (an explicitly named, versioned US 30/360 algorithm)". Before any code,
the gate asks for the exact named algorithm, its end-of-month rules, an authoritative published
source read at source, and at least one independent fixture. On 2026-09-29 the first and third
could not be satisfied, so no algorithm was chosen and nothing was implemented. A configuration
naming `30u-360` is rejected as unsupported and Blocks only that debt.

## The ambiguity

All of these are called "30/360" or "US 30/360" somewhere. Each counts
`360 × (Y2 − Y1) + 30 × (M2 − M1) + (D2 − D1)` after adjusting D1 and D2, and they differ only in
the adjustments:

| Variant | D1 adjustment | D2 adjustment |
|---|---|---|
| 30/360 ISDA ("Bond Basis", ISDA 2006 §4.16(f)) | 31 → 30 | 31 → 30 only if D1 (after adjusting) is 30 |
| 30/360 US with February rule (SIA; MSRB G-33(e) per search summaries) | last day of Feb → 30; then 31 → 30 | if D1 and D2 are both the last day of Feb → 30; 31 → 30 only if D1 is 30 |
| 30/360 PSA | last day of any month → 30 | (as ISDA) |
| OpenGamma Strata "30U/360" | February rule only when the schedule uses an end-of-month convention; otherwise 30/360 ISDA | as the chosen branch |

The February rule matters: from 28 February 2023 to 31 March 2023, 30/360 ISDA counts 33 days
and the February-rule variant counts 30.

## What closes the gate

1. **Owner decision:** which variant `30u-360@1` means. The candidate that best fits "US" and
   "explicitly named" is the MSRB G-33(e) rule set, which applies the February rule
   unconditionally (Strata's "30U/360 EOM").
2. **Source read at source:** the text of MSRB Rule G-33(e) from msrb.org (blocked from this
   environment with HTTP 403; a browser download works) or the SIA *Standard Securities
   Calculation Methods*. Record it in `__fixtures__/30u360/SOURCES.md`.
3. **Independent fixture:** at least one published worked example (or oracle rows from the
   verified text), covering 31st and end-of-February starts and ends, under `__fixtures__/30u360/`.
4. Then T041 implements exactly that variant as `daycount-30u-360@1` and registers it; the
   registry test makes it selectable only once its fixture passes.

Candidate and secondary sources seen are listed in `__fixtures__/30u360/SOURCES.md`.
