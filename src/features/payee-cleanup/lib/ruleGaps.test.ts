/**
 * Records every backtest, so the exclusion-order test can prove the expensive
 * step is not reached for a payee a cheap test already ruled out.
 */
const scoreCalls: string[] = [];
jest.mock("./ruleCandidates", () => {
  const actual: typeof import("./ruleCandidates") =
    jest.requireActual("./ruleCandidates");
  return {
    ...actual,
    scoreCandidate: (...args: Parameters<typeof actual.scoreCandidate>) => {
      scoreCalls.push(args[0].value);
      return actual.scoreCandidate(...args);
    },
  };
});

import { findRuleGaps, findRenameRuleFor, commonTokenRun } from "./ruleGaps";
import type { RuleGapInputs } from "./ruleGaps";
import type { ImportedTextRow } from "./ruleCandidates";
import type { PayeeCleanupCandidate } from "../types";
import type { Rule } from "@/types/entities";

function payee(
  id: string,
  name: string,
  overrides: Partial<PayeeCleanupCandidate["metadata"]> = {}
): PayeeCleanupCandidate {
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
      ...overrides,
    },
  };
}

function row(
  text: string,
  payeeId: string | null,
  transactionCount = 5,
  field: ImportedTextRow["field"] = "imported_payee"
): ImportedTextRow {
  return { field, text, payeeId, transactionCount, payeeName: null };
}

function rule(parts: Partial<Rule>): Rule {
  return {
    id: "r1",
    stage: "default",
    conditionsOp: "and",
    conditions: [],
    actions: [],
    ...parts,
  };
}

function inputs(overrides: Partial<RuleGapInputs> = {}): RuleGapInputs {
  return {
    candidates: [payee("p1", "Netflix")],
    rows: [row("NETFLIX.COM 4821", "p1")],
    rules: [],
    transactionCounts: new Map([["p1", 5]]),
    clusteredPayeeIds: new Set(),
    ...overrides,
  };
}

describe("who needs a rule", () => {
  it("proposes one for a curated payee whose imports no longer match its name", () => {
    // The whole point: Actual resolves by name, so `NETFLIX.COM 4821` will not
    // find the payee now called `Netflix` — it will create a duplicate.
    const gaps = findRuleGaps(inputs());

    expect(gaps).toHaveLength(1);
    expect(gaps[0].payee.name).toBe("Netflix");
    expect(gaps[0].proposal.shape).toBe("one-of");
    expect(gaps[0].safe).toBe(true);
  });

  it("ignores a payee whose imports already equal its name", () => {
    // Actual resolves these itself. This exclusion is expected to remove the
    // large majority of payees on a curated budget.
    expect(
      findRuleGaps(
        inputs({
          candidates: [payee("p1", "Netflix")],
          rows: [row("Netflix", "p1")],
        })
      )
    ).toEqual([]);
  });

  it("ignores a payee whose imports match its name in a different case", () => {
    // `getPayeeByName` folds case, so `NETFLIX` resolves to `Netflix`.
    expect(
      findRuleGaps(
        inputs({
          candidates: [payee("p1", "Netflix")],
          rows: [row("NETFLIX", "p1")],
        })
      )
    ).toEqual([]);
  });

  it("ignores a payee an existing rule already sets", () => {
    expect(
      findRuleGaps(
        inputs({
          rules: [
            rule({
              conditions: [
                { field: "imported_payee", op: "contains", value: "NETFLIX" },
              ],
              actions: [{ field: "payee", op: "set", value: "p1" }],
            }),
          ],
        })
      )
    ).toEqual([]);
  });

  it("ignores a payee with no import history at all", () => {
    // Hand-created payees have nothing for a rule to match on.
    expect(findRuleGaps(inputs({ rows: [] }))).toEqual([]);
  });

  it("ignores a payee below the transaction floor", () => {
    expect(
      findRuleGaps(
        inputs({ transactionCounts: new Map([["p1", 1]]) })
      )
    ).toEqual([]);
  });

  it("ignores transfer and tombstoned payees", () => {
    expect(
      findRuleGaps(
        inputs({ candidates: [payee("p1", "Netflix", { transferAccountId: "a1" })] })
      )
    ).toEqual([]);
    expect(
      findRuleGaps(inputs({ candidates: [payee("p1", "Netflix", { tombstone: true })] }))
    ).toEqual([]);
  });

  it("ignores a payee already being merged, whose merge carries its own rule", () => {
    // Listing it here would offer the same rule from two places, with
    // independently editable text.
    expect(
      findRuleGaps(inputs({ clusteredPayeeIds: new Set(["p1"]) }))
    ).toEqual([]);
  });

  it("fails closed when transaction counts have not loaded", () => {
    // Guessing would put one-off payees in front of the user.
    expect(findRuleGaps(inputs({ transactionCounts: undefined }))).toEqual([]);
  });

  it("ranks by the transactions the rule would have assigned", () => {
    const gaps = findRuleGaps(
      inputs({
        candidates: [payee("p1", "Netflix"), payee("p2", "Spotify")],
        rows: [row("NETFLIX.COM 4821", "p1"), row("SPOTIFY AB 991", "p2")],
        transactionCounts: new Map([
          ["p1", 4],
          ["p2", 40],
        ]),
      })
    );
    expect(gaps.map((g) => g.payee.name)).toEqual(["Spotify", "Netflix"]);
  });
});

describe("exclusion order", () => {
  it("never backtests a payee an earlier, cheaper test excluded", () => {
    // The regex backtest is the only expensive step here. A payee that is
    // ineligible, already merged, already ruled, resolved by name, or below the
    // floor must never reach it — otherwise opening the tab costs a full history
    // scan per payee in the budget.
    const rows = Array.from({ length: 40 }, (_, i) => row(`ACME STORE 0${180 + i}`, "p1", 1));

    const excluded: Partial<RuleGapInputs>[] = [
      { candidates: [payee("p1", "Acme", { tombstone: true })] },
      { candidates: [payee("p1", "Acme", { transferAccountId: "a1" })] },
      { clusteredPayeeIds: new Set(["p1"]) },
      { transactionCounts: new Map([["p1", 1]]) },
    ];

    for (const override of excluded) {
      scoreCalls.length = 0;
      findRuleGaps(
        inputs({
          candidates: [payee("p1", "Acme")],
          rows,
          transactionCounts: new Map([["p1", 40]]),
          ...override,
        })
      );
      expect(scoreCalls).toHaveLength(0);
    }
  });

  it("does backtest a payee that survives every cheap test", () => {
    // The positive control: the guard above must not be passing because the
    // backtest never runs at all.
    scoreCalls.length = 0;
    findRuleGaps(
      inputs({
        candidates: [payee("p1", "Acme")],
        rows: Array.from({ length: 40 }, (_, i) => row(`ACME STORE 0${180 + i}`, "p1", 1)),
        transactionCounts: new Map([["p1", 40]]),
      })
    );
    expect(scoreCalls.length).toBeGreaterThan(0);
  });
});

describe("rule shape", () => {
  it("uses an exact list when the same literal text arrives every time", () => {
    // Actual's own idiom, and it cannot misfire.
    const gaps = findRuleGaps(inputs({ rows: [row("NETFLIX.COM 4821", "p1", 9)] }));

    const proposal = gaps[0].proposal;
    expect(proposal.shape).toBe("one-of");
    if (proposal.shape !== "one-of") throw new Error("wrong shape");
    expect(proposal.texts).toEqual(["NETFLIX.COM 4821"]);
  });

  it("uses a pattern as soon as the text varies, however few texts there are", () => {
    // Three texts each carrying their own date are not "stable" — they will
    // never recur, so an exact list of them would catch nothing in future. This
    // is the case that made the old distinct-count heuristic wrong.
    const gaps = findRuleGaps(
      inputs({
        candidates: [payee("p1", "Al Etihad Credit Bureau")],
        rows: [
          row("#API Etihad Credit Bureau", "p1", 4, "notes"),
          row("#2026-05 Etihad Credit Bureau", "p1", 1, "notes"),
          row("-84 IRR (FX rate: #2026-02 ETIHAD CREDIT BUREAU DUBAI UAE)", "p1", 1, "notes"),
        ],
        transactionCounts: new Map([["p1", 6]]),
      })
    );

    const proposal = gaps[0].proposal;
    expect(proposal.shape).toBe("matches");
    if (proposal.shape !== "matches") throw new Error("wrong shape");
    // A plain substring, because one is enough here: a pattern is kept for text
    // whose punctuation varies, not used for its own sake.
    expect(proposal.candidate.op).toBe("contains");
    expect(proposal.candidate.value).toBe("ETIHAD CREDIT BUREAU");
    expect(proposal.score.expectedMatches).toBe(6);
  });

  it("uses a pattern when the text varies but shares a stem", () => {
    // An exact list could never keep up with a changing store number.
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`WOOLWORTHS 0${180 + i}`, "p1", 3)
    );
    const gaps = findRuleGaps(
      inputs({
        candidates: [payee("p1", "Woolworths Metro")],
        rows,
        transactionCounts: new Map([["p1", 18]]),
      })
    );

    const proposal = gaps[0].proposal;
    expect(proposal.shape).toBe("matches");
    if (proposal.shape !== "matches") throw new Error("wrong shape");
    expect(proposal.candidate.value).toMatch(/WOOLWORTHS/);
  });

  it("proposes nothing when the text neither repeats nor shares a core", () => {
    // No honest rule exists, so the payee does not appear at all. A one-off
    // string is as dead as a varying one: an exact list of it catches the
    // transaction already on record and nothing ever again.
    const rows = [
      row("ONE OFF ALPHA", "p1", 1),
      row("SOMETHING ELSE BRAVO", "p1", 1),
      row("THIRD THING CHARLIE", "p1", 1),
      row("FOURTH DELTA", "p1", 1),
    ];
    expect(
      findRuleGaps(inputs({ rows, transactionCounts: new Map([["p1", 4]]) }))
    ).toEqual([]);
  });

  it("falls back to notes when the bank puts its text there", () => {
    const gaps = findRuleGaps(
      inputs({ rows: [row("DIRECT DEBIT 8837", "p1", 5, "notes")] })
    );
    expect(gaps[0].proposal.field).toBe("notes");
  });
});

describe("extending an existing rename rule", () => {
  const renameRule = rule({
    id: "rename-1",
    stage: "pre",
    conditions: [
      { field: "imported_payee", op: "oneOf", value: ["NETFLIX.COM 4821"] },
    ],
    actions: [{ field: "payee", op: "set", value: "p1" }],
  });

  it("finds the payee's own rename rule", () => {
    expect(findRenameRuleFor([renameRule], "p1")?.id).toBe("rename-1");
    expect(findRenameRuleFor([renameRule], "p2")).toBeNull();
  });

  it("adds the missing text to that rule rather than creating a second one", () => {
    // Actual's defence against one rule per merchant: `updatePayeeRenameRule`
    // merges into the existing `oneOf` list.
    const gaps = findRuleGaps(
      inputs({
        rows: [row("NETFLIX.COM 4821", "p1"), row("NETFLIX.COM 9002", "p1")],
        rules: [renameRule],
      })
    );

    const proposal = gaps[0].proposal;
    if (proposal.shape !== "one-of") throw new Error("wrong shape");
    expect(proposal.extendsRule?.id).toBe("rename-1");
    // Only what is missing — restating what the rule already does is noise.
    expect(proposal.texts).toEqual(["NETFLIX.COM 9002"]);
  });

  it("proposes nothing when the rule already covers every text", () => {
    expect(
      findRuleGaps(inputs({ rows: [row("NETFLIX.COM 4821", "p1")], rules: [renameRule] }))
    ).toEqual([]);
  });
});

describe("when a human should look", () => {
  it("refuses to call a pattern safe when it would catch another payee", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => row(`COLES 0${180 + i}`, "p1", 3)),
      row("COLES EXPRESS 991", "p2", 7),
    ];
    const gaps = findRuleGaps(
      inputs({
        candidates: [payee("p1", "Coles Supermarket")],
        rows,
        transactionCounts: new Map([["p1", 18]]),
      })
    );

    expect(gaps[0].safe).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/also catch/i);
  });

  it("warns when two payees genuinely receive identical text", () => {
    // No rule can tell them apart, so the user has to be told rather than
    // handed a rule that will steal transactions.
    const gaps = findRuleGaps(
      inputs({
        rows: [row("PAYPAL *TRANSFER", "p1"), row("PAYPAL *TRANSFER", "p2")],
      })
    );

    expect(gaps[0].safe).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/same text/i);
  });

  it("does not trust a pattern backtested over a truncated history", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`WOOLWORTHS 0${180 + i}`, "p1", 3)
    );
    const gaps = findRuleGaps(
      inputs({
        candidates: [payee("p1", "Woolworths Metro")],
        rows,
        transactionCounts: new Map([["p1", 18]]),
        truncated: true,
      })
    );

    expect(gaps[0].safe).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/most recent imports/i);
  });

  it("still trusts an exact list over a truncated history", () => {
    // An exact string does not rest on having seen the whole history: it either
    // equals the text or it does not.
    const gaps = findRuleGaps(inputs({ truncated: true }));
    expect(gaps[0].safe).toBe(true);
  });

  it("flags an existing rule that sets a different payee for the same text", () => {
    const gaps = findRuleGaps(
      inputs({
        rules: [
          rule({
            conditions: [
              { field: "imported_payee", op: "contains", value: "NETFLIX" },
            ],
            actions: [{ field: "payee", op: "set", value: "someone-else" }],
          }),
        ],
      })
    );

    expect(gaps[0].safe).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/different payee/i);
  });
});

describe("a condition the user typed", () => {
  const etihad = () =>
    inputs({
      candidates: [payee("p1", "Al Etihad Credit Bureau")],
      rows: [
        row("#API Etihad Credit Bureau", "p1", 4, "notes"),
        row("#2026-05 Etihad Credit Bureau", "p1", 1, "notes"),
      ],
      transactionCounts: new Map([["p1", 5]]),
    });

  it("replaces the proposal and re-scores it", () => {
    const gaps = findRuleGaps({
      ...etihad(),
      overrides: new Map([
        ["p1", { field: "notes" as const, op: "matches" as const, value: "ETIHAD" }],
      ]),
    });

    const proposal = gaps[0].proposal;
    if (proposal.shape !== "matches") throw new Error("wrong shape");
    expect(proposal.candidate.value).toBe("ETIHAD");
    expect(proposal.edited).toBe(true);
    // Re-scored against the real history rather than carried over.
    expect(proposal.score.expectedMatches).toBe(5);
  });

  it("keeps the payee listed when the pattern matches nothing, and says so", () => {
    // Dropping it would remove the only place the mistake can be fixed.
    const gaps = findRuleGaps({
      ...etihad(),
      overrides: new Map([
        ["p1", { field: "notes" as const, op: "matches" as const, value: "NOTHING" }],
      ]),
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].safe).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/nothing in your import history/i);
  });

  it("reports a pattern that will not compile rather than silently matching nothing", () => {
    const gaps = findRuleGaps({
      ...etihad(),
      overrides: new Map([
        ["p1", { field: "notes" as const, op: "matches" as const, value: "ETIHAD(" }],
      ]),
    });

    expect(gaps[0].safe).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/not valid/i);
  });

  it("warns, rather than refusing, when the user widens it onto another payee", () => {
    // Consistent with the suggestions tab: it drops out of the safe set but the
    // user can still go ahead.
    const base = etihad();
    const gaps = findRuleGaps({
      ...base,
      rows: [...base.rows, row("SOMETHING ETIHAD ELSE", "p2", 3, "notes")],
      overrides: new Map([
        ["p1", { field: "notes" as const, op: "contains" as const, value: "ETIHAD" }],
      ]),
    });

    expect(gaps[0].safe).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/also catch/i);
  });
});

describe("a rule that already sets this payee", () => {
  const rbTexts: [string, number][] = [
    ["#2026-08 R AND B DUBAI 784", 3],
    ["#2026-02 R AND B DUBAI", 2],
    ["#2025-12 (SM-PAY)- R AND B DUBAI 784", 2],
    ["R&B", 1],
    ["#2026-07 R AND B DUBAI ARE", 1],
  ];

  const rbInputs = (rules: Rule[]) =>
    inputs({
      candidates: [payee("p1", "R&B Fashion")],
      rows: rbTexts.map(([text, n]) => row(text, "p1", n, "notes")),
      rules,
      transactionCounts: new Map([["p1", 9]]),
    });

  const existing = rule({
    id: "rb-rule",
    conditions: [{ field: "notes", op: "contains", value: "R AND B" }],
    actions: [{ field: "payee", op: "set", value: "p1" }],
  });

  it("does not ask for a rule the payee already has", () => {
    // The payee is called `R&B Fashion` and its imports read `R AND B DUBAI`, so
    // neither shares a word with the other. Comparing the rule against the
    // payee's *name* found nothing and reported a rule as missing that was
    // sitting right there.
    expect(findRuleGaps(rbInputs([existing]))).toEqual([]);
  });

  it("does not claim that rule sets a different payee", () => {
    // It sets this one. Saying otherwise sends the user looking for a conflict
    // that does not exist.
    const gaps = findRuleGaps(
      rbInputs([
        rule({
          id: "rb-partial",
          conditions: [{ field: "notes", op: "contains", value: "R AND B DUBAI ARE" }],
          actions: [{ field: "payee", op: "set", value: "p1" }],
        }),
      ])
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0].cautions.join(" ")).not.toMatch(/different payee/i);
  });

  it("shows a rule that covers only part of the history, and how much", () => {
    const gaps = findRuleGaps(
      rbInputs([
        rule({
          id: "rb-partial",
          conditions: [{ field: "notes", op: "contains", value: "R AND B DUBAI ARE" }],
          actions: [{ field: "payee", op: "set", value: "p1" }],
        }),
      ])
    );

    expect(gaps[0].existingRules.map((r) => r.rule.id)).toEqual(["rb-partial"]);
    expect(gaps[0].existingRules[0].covered).toBe(1);
    expect(gaps[0].cautions.join(" ")).toMatch(/catches 1 of these 9/i);
  });

  it("will not be ruled out by a rule it cannot fully check", () => {
    // A rule that also tests an amount says nothing this page can verify, so it
    // is shown but never used to hide the payee.
    const gaps = findRuleGaps(
      rbInputs([
        rule({
          id: "rb-amount",
          conditions: [
            { field: "notes", op: "contains", value: "R AND B" },
            { field: "amount", op: "is", value: 500 },
          ],
          actions: [{ field: "payee", op: "set", value: "p1" }],
        }),
      ])
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0].existingRules[0].fullyChecked).toBe(false);
    expect(gaps[0].cautions.join(" ")).toMatch(/cannot check/i);
  });

  it("understands an `or` rule whose conditions cover different fields", () => {
    // `notes contains CAREEM or imported payee contains CAREEM` catches every
    // one of the payee's imports, but only one of its two conditions applies to
    // any given row. Treating the other as unreadable said the rule could not be
    // checked, and the payee was listed as needing the rule it already had.
    const careem = inputs({
      candidates: [payee("p1", "Careem")],
      rows: [
        row("#API CAREEM RIDE", "p1", 9, "notes"),
        row("#2024-10 CAREEM HALA RIDE Dubai ARE", "p1", 7, "notes"),
        row("CAREEM RIDE", "p1", 4, "imported_payee"),
      ],
      rules: [
        rule({
          id: "careem",
          conditionsOp: "or",
          conditions: [
            { field: "notes", op: "contains", value: "CAREEM" },
            { field: "imported_payee", op: "contains", value: "CAREEM" },
          ],
          actions: [{ field: "payee", op: "set", value: "p1" }],
        }),
      ],
      transactionCounts: new Map([["p1", 20]]),
    });

    expect(findRuleGaps(careem)).toEqual([]);
  });

  it("does not propose the rule the payee already has", () => {
    // The core was derived from every text the payee had, including the text the
    // existing rule already catches — so it landed on the same words and offered
    // `notes contains GOOGLE MICROSOFT APPS` beside a rule reading exactly that.
    const onedrive = inputs({
      candidates: [payee("p1", "Microsoft OneDrive")],
      rows: [
        row("#2025-07 Google Microsoft Apps Mountain View CA", "p1", 1, "notes"),
        row("#2025-06 Google Microsoft Apps Mountain View CA", "p1", 1, "notes"),
        row("#2025-05 Google Microsoft Apps Mountain View CA", "p1", 1, "notes"),
        row("#2025-04 Google Microsoft Apps Mountain View CA", "p1", 1, "notes"),
      ],
      rules: [
        rule({
          id: "onedrive",
          conditions: [
            { field: "notes", op: "contains", value: "GOOGLE MICROSOFT APPS" },
          ],
          actions: [{ field: "payee", op: "set", value: "p1" }],
        }),
      ],
      transactionCounts: new Map([["p1", 4]]),
    });

    expect(findRuleGaps(onedrive)).toEqual([]);
  });

  it("proposes something for the text an existing rule misses", () => {
    // The useful half: a rule that covers most of a payee should leave behind
    // only what it does not catch, and the proposal should address that.
    const gaps = findRuleGaps(
      inputs({
        candidates: [payee("p1", "Microsoft OneDrive")],
        rows: [
          row("#2025-07 Google Microsoft Apps Mountain View CA", "p1", 1, "notes"),
          row("#2025-06 Google Microsoft Apps Mountain View CA", "p1", 1, "notes"),
          row("#2025-05 ONEDRIVE SUBSCRIPTION REDMOND", "p1", 4, "notes"),
          row("#2025-04 ONEDRIVE SUBSCRIPTION REDMOND", "p1", 4, "notes"),
        ],
        rules: [
          rule({
            id: "onedrive",
            conditions: [
              { field: "notes", op: "contains", value: "GOOGLE MICROSOFT APPS" },
            ],
            actions: [{ field: "payee", op: "set", value: "p1" }],
          }),
        ],
        transactionCounts: new Map([["p1", 10]]),
      })
    );

    const proposal = gaps[0].proposal;
    if (proposal.shape !== "matches") throw new Error("wrong shape");
    // Derived from the text the existing rule leaves behind, not from all of it.
    expect(proposal.candidate.value).toMatch(/ONEDRIVE/);
    expect(proposal.candidate.value).not.toMatch(/GOOGLE/);
  });

  it("does not let a rule it cannot read in full remove the payee's text", () => {
    // The same reasoning as refusing to be ruled out by such a rule: if it was
    // not trusted to hide the payee, it must not quietly empty the evidence
    // either, which would hide the payee just as effectively.
    const gaps = findRuleGaps(
      inputs({
        rules: [
          rule({
            conditionsOp: "and",
            conditions: [
              { field: "imported_payee", op: "contains", value: "NETFLIX" },
              { field: "amount", op: "is", value: 500 },
            ],
            actions: [{ field: "payee", op: "set", value: "p1" }],
          }),
        ],
      })
    );

    expect(gaps).toHaveLength(1);
  });

  it("is not confused by a rule on one text field when the payee uses both", () => {
    // The index holds one row per field, so a `notes` condition has nothing to
    // say about an `imported_payee` row — the transaction behind it may well
    // have matching notes. Reading that as "cannot check this rule" left a payee
    // listed whose rule already caught 170 of its 182 transactions.
    const noon = inputs({
      candidates: [payee("p1", "Noon Minutes")],
      rows: [
        row("#2026-02 Noon Minutes DUBAI ARE", "p1", 17, "notes"),
        row("#2025-10 NOON Minutes DUBAI DXB", "p1", 16, "notes"),
        row("NOON Minutes DUBAI DXB", "p1", 10, "imported_payee"),
      ],
      rules: [
        rule({
          id: "noon",
          conditions: [{ field: "notes", op: "contains", value: "NOON Minutes" }],
          actions: [{ field: "payee", op: "set", value: "p1" }],
        }),
      ],
      transactionCounts: new Map([["p1", 43]]),
    });

    expect(findRuleGaps(noon)).toEqual([]);
  });

  it("does not trust an `and` rule it cannot read in full", () => {
    // The opposite reasoning: a condition that cannot be read might be the one
    // that fails, so the count is an upper bound and cannot hide a payee.
    const gaps = findRuleGaps(
      inputs({
        rules: [
          rule({
            conditionsOp: "and",
            conditions: [
              { field: "imported_payee", op: "contains", value: "NETFLIX" },
              { field: "amount", op: "is", value: 500 },
            ],
            actions: [{ field: "payee", op: "set", value: "p1" }],
          }),
        ],
      })
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0].existingRules[0].fullyChecked).toBe(false);
  });

  it("still hides a payee whose rule matches on the imported payee field", () => {
    const gaps = findRuleGaps(
      inputs({
        rules: [
          rule({
            conditions: [
              { field: "imported_payee", op: "matches", value: "^NETFLIX" },
            ],
            actions: [{ field: "payee", op: "set", value: "p1" }],
          }),
        ],
      })
    );
    expect(gaps).toEqual([]);
  });
});

describe("commonTokenRun", () => {
  it("finds the merchant inside text that reduces to different stems", () => {
    expect(
      commonTokenRun([
        "#API Etihad Credit Bureau",
        "#2026-05 Etihad Credit Bureau",
        "-84 IRR (FX rate: #2026-02 ETIHAD CREDIT BUREAU DUBAI UAE)",
      ])
    ).toBe("ETIHAD CREDIT BUREAU");
  });

  it("survives an outlier that shares almost nothing", () => {
    // One import written differently must not collapse the core to a fragment.
    // Nine `LVL UP FITNESS CTR` imports and one `LVLUP FITNESS` share only
    // `FITNESS`, which is far too little to hang a rule on.
    expect(
      commonTokenRun(
        [
          "#2025-07 LVL UP FITNESS CTR DUBAI UAE",
          "#2025-06 (SM-PAY)- LVL UP FITNESS CTR DUBAI UAE",
          "#2024-11 LVL UP fitness center Dubai DXB",
          "#2023-02 LVLUP FITNESS DUBAI",
        ],
        [2, 3, 3, 1]
      )
      // The run itself still carries the trailing location; trimming it back to
      // `LVL UP FITNESS` is the ladder's job, covered below.
    ).toBe("LVL UP FITNESS CTR DUBAI UAE");
  });

  it("weights by transactions, not by distinct string", () => {
    // A one-off oddity should not outvote text that arrives every month.
    expect(
      commonTokenRun(
        ["ACME COFFEE HOUSE 01", "ACME COFFEE HOUSE 02", "SOMETHING ELSE ENTIRELY"],
        [40, 40, 1]
      )
    ).toBe("ACME COFFEE HOUSE");
  });

  it("will not let one dominant string define the whole run", () => {
    // Otherwise the core swallows that string's own date.
    expect(
      commonTokenRun(
        ["#2024-06 READY SET GO KIDS AMUS DUBAI ARE", "#2024-09 READY SET GO KIDS DUBAI ARE"],
        [9, 5]
      )
    ).toBe("READY SET GO KIDS");
  });

  it("requires the words to be adjacent", () => {
    // The pattern joins words with "any run of non-alphanumerics", which only
    // means anything if they were next to each other.
    expect(commonTokenRun(["ALPHA ONE BRAVO WORD", "ALPHA TWO BRAVO WORD"])).toBe(
      "BRAVO WORD"
    );
  });

  it("returns null when the texts share nothing", () => {
    expect(commonTokenRun(["WOOLWORTHS 0183", "COLES 0559"])).toBeNull();
  });

  it("refuses a core too short to hang a rule on", () => {
    expect(commonTokenRun(["THE ALPHA", "THE BRAVO"])).toBeNull();
    expect(commonTokenRun(["EMIRATES ALPHA", "EMIRATES BRAVO"])).toBe("EMIRATES");
    // A whole short merchant is evidence, not a truncation.
    expect(commonTokenRun(["COLES 0183", "COLES 0291"])).toBe("COLES");
  });
});

describe("keeping the condition simple (real cases)", () => {
  function gapsFor(
    name: string,
    texts: [string, number][],
    others: ImportedTextRow[] = []
  ) {
    const rows = texts.map(([text, n]) => row(text, "p1", n, "notes"));
    const total = texts.reduce((sum, [, n]) => sum + n, 0);
    return findRuleGaps(
      inputs({
        candidates: [payee("p1", name)],
        rows: [...rows, ...others],
        transactionCounts: new Map([["p1", total]]),
      })
    );
  }

  function condition(gaps: ReturnType<typeof findRuleGaps>) {
    const proposal = gaps[0]?.proposal;
    if (!proposal) return "none";
    return proposal.shape === "one-of"
      ? `oneOf ${JSON.stringify(proposal.texts)}`
      : `${proposal.candidate.op} ${proposal.candidate.value}`;
  }

  it("catches the merchant, not each dated import", () => {
    // Listing six dated strings catches the transactions already on record and
    // nothing ever again.
    expect(
      condition(
        gapsFor("Level Up Fitness", [
          ["#2025-07 LVL UP FITNESS CTR DUBAI UAE", 2],
          ["#2025-07 (SM-PAY)- LVL UP FITNESS CTR DUBAI UAE", 2],
          ["#2025-06 (SM-PAY)- LVL UP FITNESS CTR DUBAI UAE", 3],
          ["#2024-11 LVL UP fitness center Dubai DXB", 3],
          ["#2023-02 LVLUP FITNESS DUBAI", 1],
        ])
      )
    ).toBe("contains LVL UP FITNESS");
  });

  it("drops a subscription price the sample made look permanent", () => {
    // All three imports are identical apart from the month, so nothing in the
    // data says where the merchant ends — and a rule carrying the price breaks
    // the day the price changes.
    expect(
      condition(
        gapsFor("Google Storage", [
          ["#2024-07 Google Storage Mountain View CA SAR10.99", 1],
          ["#2024-06 Google Storage Mountain View CA SAR10.99", 1],
          ["#2024-05 Google Storage Mountain View CA SAR10.99", 1],
        ])
      )
    ).toBe("contains GOOGLE STORAGE");
  });

  it("keeps a boundary the imports actually demonstrated", () => {
    // `AMUS` in one import and `DUBAI` in another show where the name ends, so
    // trimming further would throw away evidence.
    expect(
      condition(
        gapsFor("Ready Set Go", [
          ["#2024-06 READY SET GO KIDS AMUS DUBAI ARE", 9],
          ["#2024-09 READY SET GO KIDS DUBAI ARE", 5],
          ["#2024-11 READY SET GO KIDS DUBAI ARE", 1],
        ])
      )
    ).toBe("contains READY SET GO KIDS");
  });

  it("is not defeated by a reference number welded to the merchant", () => {
    // `EMIRATES62385176881` is a different token from `EMIRATES`, which used to
    // mean the payee's imports shared nothing at all.
    expect(
      condition(
        gapsFor("Emirates Airlines", [
          ["#2024-08 EMIRATES DUBAI ARE", 2],
          ["#2026-08 EMIRATES", 1],
          ["#2025-03 EMIRATES DUBAI ARE", 1],
          ["#2025-03 EMIRATES62385176881-2 DUBAI ARE", 1],
          ["#2024-09 EMIRATES62378111182-2 DUBAI ARE", 1],
        ])
      )
    ).toBe("contains EMIRATES");
  });

  it("keeps a longer core when a shorter one would reach another payee", () => {
    // The trimming is bounded by the backtest, not by taste.
    expect(
      condition(
        gapsFor(
          "Google Storage",
          [
            ["#2024-07 Google Storage Mountain View CA SAR10.99", 1],
            ["#2024-06 Google Storage Mountain View CA SAR10.99", 1],
          ],
          [row("GOOGLE ADS IRELAND", "p2", 12, "notes")]
        )
      )
    ).toBe("contains GOOGLE STORAGE");
  });
});
