import type { Rule } from "@/types/entities";
import type { CheckContext, WorkingSet } from "../../types";
import { overSpecificImportMatch } from "./overSpecificImportMatch";

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
    conditions: partial.conditions ?? [
      { field: "imported_payee", op: "oneOf", value: MARKET_BOYS },
    ],
    actions: partial.actions ?? [{ field: "payee", op: "set", value: "p-1" }],
  };
}

function ws(rules: Rule[]): WorkingSet {
  return {
    rules,
    entityMaps: {
      payees: { "p-1": { entity: { id: "p-1", name: "Market Boys" } } },
      categories: {},
      accounts: {},
      categoryGroups: {},
      schedules: {},
    },
    entityExists: {
      payees: new Set(["p-1"]),
      categories: new Set(),
      accounts: new Set(),
      categoryGroups: new Set(),
    },
  };
}

function context(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    partSignatures: new Map(),
    ruleSignatures: new Map(),
    rulesByPartition: new Map(),
    scheduleLinkedRuleIds: new Set(),
    fullDuplicateRuleIds: new Set(),
    ...overrides,
  };
}

describe("overSpecificImportMatch", () => {
  it("reports a rename rule that has grown into a list of bank strings", () => {
    const findings = overSpecificImportMatch(ws([rule({ id: "r1" })]), context());

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_OVERSPECIFIC_IMPORT_MATCH");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("MARKET BOYS PTY LTD");
    expect(findings[0].affected[0].id).toBe("r1");
  });

  it("quotes the strings, and says how many it did not quote", () => {
    const many = [
      ...MARKET_BOYS,
      "MARKET BOYS PTY LTD Perth Value Date: 01/02/2026",
      "MARKET BOYS PTY LTD Hobart Value Date: 02/02/2026",
    ];
    const findings = overSpecificImportMatch(
      ws([rule({ id: "r1", conditions: [{ field: "imported_payee", op: "oneOf", value: many }] })]),
      context()
    );

    expect(findings[0].details).toHaveLength(5);
    expect(findings[0].details?.at(-1)).toBe("…and 1 more");
  });

  it("leaves a schedule's own rule alone", () => {
    const findings = overSpecificImportMatch(
      ws([rule({ id: "r1" })]),
      context({ scheduleLinkedRuleIds: new Set(["r1"]) })
    );

    expect(findings).toEqual([]);
  });

  it("says nothing about a rule that already matches on a pattern", () => {
    const findings = overSpecificImportMatch(
      ws([
        rule({
          id: "r1",
          conditions: [{ field: "imported_payee", op: "contains", value: "MARKET BOYS" }],
        }),
      ]),
      context()
    );

    expect(findings).toEqual([]);
  });

  it("orders findings by rule id, so two runs read the same", () => {
    const findings = overSpecificImportMatch(
      ws([rule({ id: "r2" }), rule({ id: "r1" })]),
      context()
    );

    expect(findings.map((f) => f.affected[0].id)).toEqual(["r1", "r2"]);
  });
});
