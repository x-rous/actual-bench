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

import { findRuleGaps, findRenameRuleFor, sharedStem } from "./ruleGaps";
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
  it("uses an exact list when the import text is stable", () => {
    // Actual's own idiom, and it cannot misfire.
    const gaps = findRuleGaps(
      inputs({
        rows: [row("NETFLIX.COM 4821", "p1"), row("NETFLIX.COM 4822", "p1")],
      })
    );

    const proposal = gaps[0].proposal;
    expect(proposal.shape).toBe("one-of");
    if (proposal.shape !== "one-of") throw new Error("wrong shape");
    expect(proposal.texts).toEqual(["NETFLIX.COM 4821", "NETFLIX.COM 4822"]);
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

  it("proposes nothing when the text neither repeats nor shares a stem", () => {
    // No honest rule exists, so the payee does not appear at all.
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

describe("sharedStem", () => {
  it("returns the stem when every variant reduces to it", () => {
    expect(sharedStem(["WOOLWORTHS 0183", "WOOLWORTHS 0291"])).toBe("WOOLWORTHS");
  });

  it("returns null when they reduce to different things", () => {
    expect(sharedStem(["WOOLWORTHS 0183", "COLES 0559"])).toBeNull();
  });

  it("returns null for a stem too short to build a rule from", () => {
    expect(sharedStem(["A 1", "A 2"])).toBeNull();
  });
});
