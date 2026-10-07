# Fixture month-end-rules

id: msrb-g33-30-360-month-end-rules
country: US
currency: USD
source-name: Independent oracle (src/test-oracles/rd084) applying the verified text of MSRB Rule G-33(e)(ii)
source-url: https://www.msrb.org/Rules-and-Interpretations/MSRB-Rules/General/Rule-G-33
source-type: synthetic-oracle
verified: 2026-09-29
conventions: msrb-g33-30-360
engine-versions: none (convention not implemented)
coverage: synthetic

Each row exercises one sentence of the rule: D1 = 31 becomes 30; D2 = 31 becomes 30 only when D1
is 30 or 31 (so 15 Mar to 31 Mar is 16); and February has no special treatment, so 28 Feb 2023 to
31 Mar 2023 is 33 days and 28 Feb 2023 to 1 Mar 2023 is 3. A variant with a last-day-of-February
rule (Strata's "30U/360 EOM") gives 30 and 1 for those two rows; that difference is why the
convention is named after its source, not "30U/360".
