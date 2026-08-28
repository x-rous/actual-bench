import type { Rule } from "@/types/entities";
import {
  collectGeneralisations,
  collectLiteralImportConditions,
  deriveGeneralisation,
  detectOverSpecificImportMatch,
} from "./overSpecificImportMatch";

const MARKET_BOYS = [
  "MARKET BOYS PTY LTD Melbourne VI AUS Card xx4534 Value Date: 12/03/2024",
  "MARKET BOYS PTY LTD Melbourne VI AUS Card xx9166 Value Date: 24/12/2024",
  "MARKET BOYS PTY LTD Sydney Value Date: 10/11/2025",
];

function rule(partial: Partial<Rule> & { id: string }): Rule {
  return {
    id: partial.id,
    stage: partial.stage ?? "pre",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [{ field: "payee", op: "set", value: "p-1" }],
  };
}

describe("collectLiteralImportConditions", () => {
  it("reads a oneOf list written by Actual's rename prompt", () => {
    const found = collectLiteralImportConditions(
      rule({ id: "r1", conditions: [{ field: "imported_payee", op: "oneOf", value: MARKET_BOYS }] })
    );

    expect(found?.field).toBe("imported_payee");
    expect(found?.values).toEqual(MARKET_BOYS);
  });

  it("reads several `is` conditions when they are or'd", () => {
    const found = collectLiteralImportConditions(
      rule({
        id: "r1",
        conditionsOp: "or",
        conditions: MARKET_BOYS.map((value) => ({ field: "imported_payee", op: "is", value })),
      })
    );

    expect(found?.values).toEqual(MARKET_BOYS);
  });

  it("leaves several `is` conditions alone when they are and'd", () => {
    // They cannot all be true at once. That is impossibleConditions' finding,
    // and reporting the same rule as improvable as well would be noise.
    const found = collectLiteralImportConditions(
      rule({
        id: "r1",
        conditionsOp: "and",
        conditions: MARKET_BOYS.map((value) => ({ field: "imported_payee", op: "is", value })),
      })
    );

    expect(found).toBeNull();
  });

  it("ignores a rule that already matches on a pattern", () => {
    const found = collectLiteralImportConditions(
      rule({
        id: "r1",
        conditionsOp: "or",
        conditions: [
          { field: "imported_payee", op: "contains", value: "MARKET BOYS" },
          { field: "imported_payee", op: "is", value: MARKET_BOYS[0] },
        ],
      })
    );

    expect(found).toBeNull();
  });

  it("needs two distinct strings, comparing them the way Actual does", () => {
    // Actual lower-cases both sides, so these two conditions are one value.
    const found = collectLiteralImportConditions(
      rule({
        id: "r1",
        conditionsOp: "or",
        conditions: [
          { field: "imported_payee", op: "is", value: "MARKET BOYS PTY LTD" },
          { field: "imported_payee", op: "is", value: "market boys pty ltd" },
        ],
      })
    );

    expect(found).toBeNull();
  });

  it("keeps two literals that differ only in whitespace", () => {
    // Actual compares `is` with `===` on the lower-cased text and does not trim,
    // so these are two different strings to the rule engine. Merging them made
    // the backtest read a history row as already matched when the rule does not
    // match it, which hides a conflict.
    const found = collectLiteralImportConditions(
      rule({
        id: "r1",
        conditionsOp: "or",
        conditions: [
          { field: "imported_payee", op: "is", value: "NIMBUS STORAGE 03" },
          { field: "imported_payee", op: "is", value: "NIMBUS STORAGE 03 " },
        ],
      })
    );

    expect(found?.values).toEqual(["NIMBUS STORAGE 03", "NIMBUS STORAGE 03 "]);
  });

  it("reads notes as well as imported_payee", () => {
    const found = collectLiteralImportConditions(
      rule({
        id: "r1",
        conditionsOp: "or",
        conditions: [
          { field: "notes", op: "is", value: "NIMBUS STORAGE 03/24" },
          { field: "notes", op: "is", value: "NIMBUS STORAGE 04/24" },
        ],
      })
    );

    expect(found?.field).toBe("notes");
  });

  it("carries the conditions a rewrite would replace, and only those", () => {
    const found = collectLiteralImportConditions(
      rule({
        id: "r1",
        conditions: [
          { field: "imported_payee", op: "oneOf", value: MARKET_BOYS },
          { field: "amount", op: "isbetween", value: { num1: 1, num2: 2 } },
        ],
      })
    );

    expect(found?.conditions).toHaveLength(1);
    expect(found?.conditions[0].op).toBe("oneOf");
  });
});

describe("deriveGeneralisation", () => {
  it("finds the merchant inside dated card text", () => {
    const derived = deriveGeneralisation(MARKET_BOYS, "imported_payee");
    expect(derived?.stem).toBe("MARKET BOYS PTY LTD");
  });

  it("offers only rewrites that still catch every string listed today", () => {
    // The rewrite replaces the list, so anything it misses is a match the user
    // silently loses.
    const derived = deriveGeneralisation(MARKET_BOYS, "imported_payee");
    expect(derived?.candidates.length).toBeGreaterThan(0);
    for (const candidate of derived?.candidates ?? []) {
      for (const value of MARKET_BOYS) {
        const text = value.toLowerCase();
        const matched =
          candidate.op === "contains"
            ? text.includes(candidate.value.toLowerCase())
            : new RegExp(candidate.value.toLowerCase()).test(text);
        expect(matched).toBe(true);
      }
    }
  });

  it("returns nothing when the strings share no merchant", () => {
    expect(
      deriveGeneralisation(["ACME HARDWARE STORE", "ZENITH TRAVEL AGENCY"], "imported_payee")
    ).toBeNull();
  });

  it("returns nothing when the strings differ only in spacing", () => {
    // Actual collapses neither, but its matcher lower-cases and compares text;
    // these two show nothing about what varies from import to import.
    expect(
      deriveGeneralisation(["NIMBUS STORAGE", "NIMBUS  STORAGE"], "imported_payee")
    ).toBeNull();
  });

  it("will not build a rule out of a card number", () => {
    // The only run these share is digits, which names a card and not a merchant,
    // so there is no honest rewrite and none is offered.
    expect(
      deriveGeneralisation(["4319 88 ACME HARDWARE", "4319 88 ZENITH TRAVEL"], "imported_payee")
    ).toBeNull();
  });

  it("keeps a stem the values all share rather than the majority run", () => {
    const values = [
      "PAPER MOON CAFE MELBOURNE Card xx1",
      "PAPER MOON CAFE MELBOURNE Card xx2",
      "PAPER MOON CAFE SYDNEY Card xx3",
    ];
    const derived = deriveGeneralisation(values, "imported_payee");
    expect(derived?.stem).toBe("PAPER MOON CAFE");
  });
});

describe("collectGeneralisations", () => {
  it("offers one form per stem, and no more than three stems", () => {
    // Nine variations of one sentence is not a choice, it is a puzzle - and
    // buildCandidates labels its flexible regex `contains "<stem>"` as well, so
    // three of them read identically.
    const options = collectGeneralisations(MARKET_BOYS, "imported_payee");

    expect(options.length).toBeLessThanOrEqual(3);
    expect(new Set(options.map((option) => option.stem)).size).toBe(options.length);
    // Where a literal `contains` covers every value, the regexes catch the same
    // text and only cost readability.
    expect(options.every((option) => option.candidate.op === "contains")).toBe(true);
  });

  it("keeps the regex form when punctuation stops a literal match from covering the values", () => {
    const options = collectGeneralisations(
      ["GOOGLE*MICROSOFT APPS 03/24", "GOOGLE MICROSOFT APPS 04/24"],
      "imported_payee"
    );

    expect(options.length).toBeGreaterThan(0);
    expect(options[0].candidate.op).toBe("matches");
  });

  it("offers shorter stems as alternatives, longest first", () => {
    const options = collectGeneralisations(MARKET_BOYS, "imported_payee");

    expect(options[0].stem).toBe("MARKET BOYS PTY LTD");
    expect(options.map((option) => option.stem)).toEqual([
      "MARKET BOYS PTY LTD",
      "MARKET BOYS PTY",
      "MARKET BOYS",
    ]);
  });
});

describe("detectOverSpecificImportMatch", () => {
  it("reports the RD-088 example end to end", () => {
    const detected = detectOverSpecificImportMatch(
      rule({ id: "r1", conditions: [{ field: "imported_payee", op: "oneOf", value: MARKET_BOYS }] })
    );

    expect(detected?.stem).toBe("MARKET BOYS PTY LTD");
    expect(detected?.values).toHaveLength(3);
  });

  it("says nothing about a rule with a single exact string", () => {
    // One string cannot show what varies, so there is no evidence for a stem.
    expect(
      detectOverSpecificImportMatch(
        rule({ id: "r1", conditions: [{ field: "imported_payee", op: "is", value: MARKET_BOYS[0] }] })
      )
    ).toBeNull();
  });

  it("does not care what the rule does, only what it matches", () => {
    // A rule setting a category off dated strings is broken the same way.
    const detected = detectOverSpecificImportMatch(
      rule({
        id: "r1",
        actions: [{ field: "category", op: "set", value: "c-1" }],
        conditions: [{ field: "imported_payee", op: "oneOf", value: MARKET_BOYS }],
      })
    );

    expect(detected?.stem).toBe("MARKET BOYS PTY LTD");
  });
});
