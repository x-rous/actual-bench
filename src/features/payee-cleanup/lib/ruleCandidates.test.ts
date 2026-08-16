import {
  analyzeFutureResolution,
  buildCandidates,
  candidateStems,
  buildNormalizationRule,
  classifyRelatedRules,
  exactNameCoverage,
  normalizePatternText,
  rankCandidates,
  scoreCandidate,
  type ImportedTextRow,
} from "./ruleCandidates";
import type { Rule } from "@/types/entities";
import type { PayeeCleanupCandidate } from "../types";

function payee(id: string, name = id): PayeeCleanupCandidate {
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
    },
  };
}

function row(
  text: string,
  payeeId: string | null,
  transactionCount = 1,
  field: ImportedTextRow["field"] = "imported_payee",
  payeeName: string | null = null
): ImportedTextRow {
  return { field, text, payeeId, payeeName, transactionCount };
}

describe("buildCandidates", () => {
  it("anchors every pattern on the reduced stem", () => {
    // A pattern built from a raw name would match exactly one transaction.
    const candidates = buildCandidates("WOOLWORTHS", "imported_payee");
    expect(candidates.map((c) => c.value)).toEqual([
      "^WOOLWORTHS\\b",
      "\\bWOOLWORTHS\\b",
      "WOOLWORTHS",
    ]);
  });

  it("tolerates the punctuation the stem normalized away", () => {
    // The stem is `TEMU COM`; the text it must match is `TEMU.COM`. A literal
    // space here means every merchant with a dot, slash or ampersand in its
    // name silently gets no rule at all.
    const [anchored] = buildCandidates("TEMU COM PARRAMATTA", "imported_payee");
    expect(new RegExp(anchored.value, "i").test("TEMU.COM PARRAMATTA NS AUS")).toBe(
      true
    );
  });

  it("escapes regex metacharacters in a merchant name", () => {
    const [first] = buildCandidates("M.O.F", "imported_payee");
    expect(first.value).toBe("^M\\.O\\.F\\b");
    expect(() => new RegExp(first.value)).not.toThrow();
  });

  it("refuses a stem too short to be discriminating", () => {
    expect(buildCandidates("AB", "imported_payee")).toEqual([]);
  });
});

describe("scoreCandidate", () => {
  const rows = [
    row("WOOLWORTHS 0183", "p1", 47),
    row("WOOLWORTHS 0291", "p2", 23),
    row("WOOLWORTHS MOBILE 12", "other", 9),
    row("TESCO 4821", "other2", 5),
  ];
  const cluster = new Set(["p1", "p2"]);

  it("counts this payee's transactions as expected", () => {
    const [anchored] = buildCandidates("WOOLWORTHS", "imported_payee");
    const score = scoreCandidate(anchored, rows, cluster);

    expect(score.expectedMatches).toBe(70);
  });

  it("counts other payees' transactions as unexpected, with examples", () => {
    // `WOOLWORTHS MOBILE` is a different business; a rule that swallows it is
    // worse than no rule.
    const [anchored] = buildCandidates("WOOLWORTHS", "imported_payee");
    const score = scoreCandidate(anchored, rows, cluster);

    expect(score.unexpectedMatches).toBe(9);
    expect(score.unexpectedExamples[0].text).toBe("WOOLWORTHS MOBILE 12");
  });

  it("ignores rows from the other source field", () => {
    const notesRows = [row("WOOLWORTHS 0183", "p1", 47, "notes")];
    const [anchored] = buildCandidates("WOOLWORTHS", "imported_payee");
    expect(scoreCandidate(anchored, notesRows, cluster).expectedMatches).toBe(0);
  });

  it("scores a pattern that cannot compile as matching nothing", () => {
    const broken = {
      field: "imported_payee" as const,
      op: "matches" as const,
      value: "([",
      description: "broken",
    };
    expect(scoreCandidate(broken, rows, cluster).expectedMatches).toBe(0);
  });

  it("attributes a row by payee NAME when the id does not line up", () => {
    // A grouped query can return either shape. Mis-attributing a payee's own
    // transactions as someone else's makes a perfectly safe rule look
    // dangerous — which is exactly how it looked in testing.
    const [anchored] = buildCandidates("WOOLWORTHS", "imported_payee");
    const named = [row("WOOLWORTHS 0183", null, 47, "imported_payee", "WOOLWORTHS 0183")];
    const score = scoreCandidate(
      anchored,
      named,
      new Set(["p1"]),
      new Set(["WOOLWORTHS 0183"])
    );

    expect(score.expectedMatches).toBe(47);
    expect(score.unexpectedMatches).toBe(0);
  });

  it("ignores a row that belongs to no payee at all", () => {
    // Counting it against the rule reports a conflict with a payee that does
    // not exist.
    const [anchored] = buildCandidates("WOOLWORTHS", "imported_payee");
    const orphaned = [row("WOOLWORTHS 9999", null, 12)];
    expect(scoreCandidate(anchored, orphaned, cluster).unexpectedMatches).toBe(0);
  });

  it("names the payee an unexpected match belongs to", () => {
    const [anchored] = buildCandidates("WOOLWORTHS", "imported_payee");
    const rival = [row("WOOLWORTHS MOBILE", "other", 9, "imported_payee", "Woolworths Mobile")];
    const score = scoreCandidate(anchored, rival, cluster);

    expect(score.unexpectedExamples[0].payeeName).toBe("Woolworths Mobile");
  });

  it("matches case-insensitively, because import text is not upper-cased", () => {
    const [anchored] = buildCandidates("WOOLWORTHS", "imported_payee");
    const mixed = [row("Woolworths 0183", "p1", 5)];
    expect(scoreCandidate(anchored, mixed, cluster).expectedMatches).toBe(5);
  });
});

describe("rankCandidates", () => {
  const base = {
    candidate: { field: "imported_payee" as const, op: "contains" as const, value: "X", description: "" },
    unexpectedExamples: [],
    matchedTexts: 1,
  };

  it("puts safety first, whatever else a pattern does well", () => {
    // A rule that steals another payee's transactions loses to one that catches
    // less but catches only this payee.
    const ranked = rankCandidates([
      { ...base, expectedMatches: 500, unexpectedMatches: 3 },
      { ...base, expectedMatches: 20, unexpectedMatches: 0 },
    ]);
    expect(ranked[0].expectedMatches).toBe(20);
  });

  it("prefers the pattern that catches more, among safe ones", () => {
    const ranked = rankCandidates([
      { ...base, expectedMatches: 20, unexpectedMatches: 0 },
      { ...base, expectedMatches: 80, unexpectedMatches: 0 },
    ]);
    expect(ranked[0].expectedMatches).toBe(80);
  });

  it("prefers the narrowest pattern when the rest ties", () => {
    const anchored = {
      ...base,
      candidate: { field: "imported_payee" as const, op: "matches" as const, value: "^X\\b", description: "" },
      expectedMatches: 20,
      unexpectedMatches: 0,
    };
    const broad = { ...base, expectedMatches: 20, unexpectedMatches: 0 };
    expect(rankCandidates([broad, anchored])[0]).toBe(anchored);
  });
});

describe("candidateStems", () => {
  it("offers the final name as well as the reduced stem", () => {
    // A cluster reduced to `HUNGRY JACKS MELBOURNE` whose final name is
    // `Hungry Jacks` must be able to propose a rule catching `HUNGRY JACKS` —
    // the narrower stem would miss every import from a different suburb.
    expect(candidateStems("HUNGRY JACKS MELBOURNE", "Hungry Jacks")).toEqual([
      "HUNGRY JACKS MELBOURNE",
      "HUNGRY JACKS",
    ]);
  });

  it("does not repeat itself when they agree", () => {
    expect(candidateStems("WOOLWORTHS", "Woolworths")).toEqual(["WOOLWORTHS"]);
  });

  it("drops a stem too short to discriminate", () => {
    expect(candidateStems("A", "Ab")).toEqual([]);
  });
});

describe("exactNameCoverage", () => {
  it("counts imports the surviving name already resolves", () => {
    const rows = [row("Woolworths", "p1", 30), row("WOOLWORTHS 0183", "p2", 5)];
    expect(exactNameCoverage("Woolworths", rows)).toEqual({
      covered: 1,
      transactionCount: 30,
    });
  });

  it("ignores the notes field, which Actual does not match names against", () => {
    const rows = [row("Woolworths", "p1", 30, "notes")];
    expect(exactNameCoverage("Woolworths", rows).covered).toBe(0);
  });
});

describe("classifyRelatedRules", () => {
  function rule(id: string, parts: Partial<Rule>): Rule {
    return {
      id,
      stage: "default",
      conditionsOp: "and",
      conditions: [],
      actions: [],
      ...parts,
    };
  }

  it("recognises a rule that already resolves this payee text", () => {
    const existing = rule("r1", {
      conditions: [{ field: "imported_payee", op: "contains", value: "WOOLWORTHS" }],
      actions: [{ field: "payee", op: "set", value: "p1" }],
    });
    const [related] = classifyRelatedRules([existing], new Set(["p1"]), "WOOLWORTHS");

    expect(related.kind).toBe("payee-resolution");
    expect(related.interaction).toBe("already-resolves");
  });

  it("treats a category rule referencing the payee as compatible", () => {
    // It is unaffected by the merge and does not compete with a new rule.
    const existing = rule("r2", {
      conditions: [{ field: "payee", op: "is", value: "p1" }],
      actions: [{ field: "category", op: "set", value: "c1" }],
    });
    const [related] = classifyRelatedRules([existing], new Set(["p1"]), "WOOLWORTHS");

    expect(related.kind).toBe("category-or-other-action");
    expect(related.interaction).toBe("compatible");
  });

  it("recognises a oneOf rule that already resolves this payee text", () => {
    // An `imported_payee oneOf [...]` rule carries an array. Reading only string
    // values classified it as a conflict and proposed a second rule for a
    // merchant already handled — the rule sprawl this ordering exists to stop.
    const existing = rule("r4", {
      conditions: [
        {
          field: "imported_payee",
          op: "oneOf",
          value: ["WOOLWORTHS 0183", "WOOLWORTHS 0291"],
        },
      ],
      actions: [{ field: "payee", op: "set", value: "p1" }],
    });
    const [related] = classifyRelatedRules([existing], new Set(["p1"]), "WOOLWORTHS");

    expect(related.interaction).toBe("already-resolves");
  });

  it("ignores rules with nothing to do with this cluster", () => {
    const unrelated = rule("r3", {
      conditions: [{ field: "imported_payee", op: "contains", value: "TESCO" }],
      actions: [{ field: "payee", op: "set", value: "other" }],
    });
    expect(classifyRelatedRules([unrelated], new Set(["p1"]), "WOOLWORTHS")).toEqual([]);
  });
});

describe("analyzeFutureResolution", () => {
  const members = [payee("p1", "WOOLWORTHS 0183"), payee("p2", "WOOLWORTHS 0291")];

  it("recommends a safe rule and marks it selectable", () => {
    const result = analyzeFutureResolution({
      stem: "WOOLWORTHS",
      finalName: "Woolworths",
      members,
      rows: [row("WOOLWORTHS 0183", "p1", 47), row("WOOLWORTHS 0291", "p2", 23)],
      rules: [],
    });

    expect(result.recommended?.expectedMatches).toBe(70);
    expect(result.recommended?.unexpectedMatches).toBe(0);
    expect(result.safeToPreselect).toBe(true);
    expect(result.skipReason).toBeNull();
  });

  it("does not preselect a rule that would catch other payees", () => {
    // RD-078 §17: a rule with unexplained unexpected matches must not be
    // preselected.
    const result = analyzeFutureResolution({
      stem: "WOOLWORTHS",
      finalName: "Woolworths",
      members,
      rows: [
        row("WOOLWORTHS 0183", "p1", 5),
        row("WOOLWORTHS MOBILE", "other", 40),
      ],
      rules: [],
    });

    expect(result.safeToPreselect).toBe(false);
  });

  it("skips the rule when every past import already matches the surviving name", () => {
    const result = analyzeFutureResolution({
      stem: "WOOLWORTHS",
      finalName: "Woolworths",
      members,
      rows: [row("Woolworths", "p1", 100)],
      rules: [],
    });

    expect(result.skipReason).toBe("already-resolved-by-name");
    expect(result.recommended).toBeNull();
  });

  it("still proposes a rule for the variants exact-name matching would miss", () => {
    // Most of the history matching by name is not a reason to skip — what
    // matters is whether anything is left over that would create a new payee
    // again on the next import.
    const result = analyzeFutureResolution({
      stem: "WOOLWORTHS",
      finalName: "Woolworths",
      members,
      rows: [row("Woolworths", "p1", 100), row("WOOLWORTHS 0183", "p2", 2)],
      rules: [],
    });

    expect(result.skipReason).toBeNull();
    expect(result.recommended).not.toBeNull();
  });

  it("skips the rule when an existing rule already does the job", () => {
    const result = analyzeFutureResolution({
      stem: "WOOLWORTHS",
      finalName: "Woolworths",
      members,
      rows: [row("WOOLWORTHS 0183", "p1", 47)],
      rules: [
        {
          id: "r1",
          stage: "default",
          conditionsOp: "and",
          conditions: [{ field: "imported_payee", op: "contains", value: "WOOLWORTHS" }],
          actions: [{ field: "payee", op: "set", value: "p1" }],
        },
      ],
    });

    expect(result.skipReason).toBe("existing-rule-covers-it");
    expect(result.recommended).toBeNull();
  });

  it("prefers a broader pattern from the final name when it is still safe", () => {
    // The user renamed the cluster to `Hungry Jacks`; the rule should catch
    // that, not just the suburb the reduction happened to leave behind.
    const result = analyzeFutureResolution({
      stem: "HUNGRY JACKS MELBOURNE",
      finalName: "Hungry Jacks",
      members: [payee("p1", "Hungry Jacks Melbourne"), payee("p2", "Hungry Jacks Sydney")],
      rows: [
        row("HUNGRY JACKS MELBOURNE 12", "p1", 4),
        row("HUNGRY JACKS SYDNEY 88", "p2", 6),
      ],
      rules: [],
    });

    expect(result.recommended?.candidate.value).toBe("^HUNGRY[^A-Za-z0-9]*JACKS\\b");
    expect(result.recommended?.expectedMatches).toBe(10);
  });

  it("uses the pattern the user typed instead of the generated ones", () => {
    const result = analyzeFutureResolution({
      stem: "HUNGRY JACKS MELBOURNE",
      finalName: "Hungry Jacks",
      members: [payee("p1", "Hungry Jacks Melbourne")],
      rows: [row("HUNGRY JACKS MELBOURNE 12", "p1", 4)],
      rules: [],
      override: { field: "imported_payee", text: "HUNGRY JACKS" },
    });

    expect(result.matchText).toBe("HUNGRY JACKS");
    expect(result.recommended?.candidate.value).toBe("^HUNGRY[^A-Za-z0-9]*JACKS\\b");
  });

  it("distinguishes 'nothing matched' from 'everything caught others'", () => {
    // Telling a user "no pattern catches this without catching others" when in
    // truth nothing matched at all sends them hunting for a conflict that does
    // not exist.
    const nothing = analyzeFutureResolution({
      stem: "ZZZ WIDGETS",
      finalName: "Zzz Widgets",
      members,
      rows: [row("SOMETHING ELSE", "other", 3)],
      rules: [],
    });
    expect(nothing.skipReason).toBe("no-matching-pattern");

    const unsafe = analyzeFutureResolution({
      stem: "WOOLWORTHS",
      finalName: "Woolworths",
      members,
      rows: [row("WOOLWORTHS 0183", "p1", 1), row("WOOLWORTHS MOBILE", "other", 40)],
      rules: [],
    });
    expect(unsafe.recommended).not.toBeNull();
    expect(unsafe.safeToPreselect).toBe(false);
  });

  it("considers the notes field as well as the imported payee", () => {
    // Where a bank puts the merchant in the memo, a rule that can only read
    // imported_payee has nothing to match on.
    const result = analyzeFutureResolution({
      stem: "WOOLWORTHS",
      finalName: "Woolworths",
      members,
      rows: [row("WOOLWORTHS 0183", "p1", 47, "notes")],
      rules: [],
    });

    expect(result.recommended?.candidate.field).toBe("notes");
  });
});

describe("pattern text normalization", () => {
  it("collapses repeated whitespace in text the user typed", () => {
    // Splitting raw text on a single space produced an empty segment, so the
    // pattern gained two adjacent `[^A-Za-z0-9]*` quantifiers — ambiguous, and
    // quadratic to backtrack over a long run of separators.
    expect(normalizePatternText("HUNGRY  JACKS")).toBe("HUNGRY JACKS");
    expect(buildCandidates(normalizePatternText("HUNGRY  JACKS"), "imported_payee")[0]
      .value).toBe("^HUNGRY[^A-Za-z0-9]*JACKS\\b");
  });
});

describe("buildNormalizationRule", () => {
  it("builds a rule using native primitives, targeting the surviving payee", () => {
    const rule = buildNormalizationRule(
      {
        field: "imported_payee",
        op: "matches",
        value: "^WOOLWORTHS\\b",
        description: "",
      },
      "target-1",
      "rule-1"
    );

    expect(rule.conditions).toEqual([
      { field: "imported_payee", op: "matches", value: "^WOOLWORTHS\\b", type: "string" },
    ]);
    expect(rule.actions).toEqual([
      { field: "payee", op: "set", value: "target-1", type: "id" },
    ]);
    expect(rule.stage).toBe("default");
  });
});
