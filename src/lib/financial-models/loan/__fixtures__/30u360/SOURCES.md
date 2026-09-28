# 30U/360: reference sources and gate record

status: gated
convention: 30u-360
reviewed: 2026-09-29

The gate (tasks T035) requires: an exact named, versioned algorithm; its end-of-month rules; an
authoritative published source read at source; and at least one independent fixture. **It is not
met.** The convention is not implemented and not selectable. See
`../daycount/THIRTY_U_360.md` for the candidate algorithms and what would close the gate.

## Candidate primary source (not read at source)

- **MSRB Rule G-33(e), "Day Counting"** (Municipal Securities Rulemaking Board). A US regulator
  rule that defines a 30/360 day count with day-31 and last-day-of-February adjustments.
  https://www.msrb.org/Rules-and-Interpretations/MSRB-Rules/General/Rule-G-33 returned HTTP 403 to
  every fetch from this environment (direct, through a fetch tool, and via the Internet Archive,
  which rate-limited). Search-engine summaries of the rule text were seen but are not a verified
  source and were not encoded.
- SEC Release 34-77316 Exhibit 5 (the 2016 G-33 amendment) was read in full; it amends section
  (b) only and states "(c) – (e) No changes", so it does not contain the day-count text.

## Secondary sources (not coverage)

- **OpenGamma Strata** (Apache-2.0), `StandardDayCounts.java` and `DayCountTest.java`
  (retrieved 2026-09-29). A reference implementation, not a standard. It shows the naming
  ambiguity directly: its "30U/360" applies the February rule only when the schedule uses an
  end-of-month convention and otherwise behaves as "30/360 ISDA", while "30U/360 EOM" always
  applies it, and it maps the names "30/360 US", "Bond Basis", "ISMA-30/360" and "30/360 SIA" all
  to the flag-dependent "30U/360".
- Wikipedia and glossary sites (cbonds) summarise the SIA rules; not used.
