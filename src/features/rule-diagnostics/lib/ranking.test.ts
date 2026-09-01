import type { Rule } from "@/types/entities";
import { buildFinding } from "./findingMessages";
import { rankFindings } from "./ranking";
import type { Finding } from "../types";

function rule(partial: Partial<Rule> & { id: string }): Rule {
  return {
    id: partial.id,
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [{ field: "payee", op: "is", value: "p-1" }],
    actions: partial.actions ?? [{ field: "category", op: "set", value: "c-1" }],
  };
}

function ref(id: string) {
  return { id, summary: `rule ${id}` };
}

function family(ids: string[]): Finding {
  return buildFinding("RULE_NEAR_DUPLICATE_FAMILY", ids.map(ref), {
    stage: "default",
    varying: 2,
  });
}

describe("rankFindings", () => {
  it("puts errors above warnings above info", () => {
    const info = family(["r1", "r2"]);
    const warning = buildFinding("RULE_EMPTY_ACTIONS", [ref("r3")]);
    const error = buildFinding("RULE_IMPOSSIBLE_CONDITIONS", [ref("r4")]);
    const rules = ["r1", "r2", "r3", "r4"].map((id) => rule({ id }));

    const ranked = rankFindings([info, warning, error], rules);

    expect(ranked.map((f) => f.severity)).toEqual(["error", "warning", "info"]);
  });

  it("puts a family of six above a family of two at the same severity", () => {
    const small = family(["a1", "a2"]);
    const large = family(["b1", "b2", "b3", "b4", "b5", "b6"]);
    const rules = [...small.affected, ...large.affected].map((r) => rule({ id: r.id }));

    const ranked = rankFindings([small, large], rules);

    expect(ranked[0].affected).toHaveLength(6);
  });

  it("prefers the rule that carries more findings", () => {
    // r-busy has two findings; r-quiet has one. Same severity, same size.
    const busyA = buildFinding("RULE_EMPTY_ACTIONS", [ref("r-busy")]);
    const busyB = buildFinding("RULE_NOOP_ACTIONS", [ref("r-busy")]);
    const quiet = buildFinding("RULE_NOOP_ACTIONS", [ref("r-quiet")]);
    const rules = ["r-busy", "r-quiet"].map((id) => rule({ id }));

    const ranked = rankFindings([quiet, busyA, busyB], rules);

    expect(ranked[0].affected[0].id).toBe("r-busy");
  });

  it("prefers a pre-stage rule, because everything downstream sees its writes", () => {
    const pre = buildFinding("RULE_EMPTY_ACTIONS", [ref("r-pre")]);
    const post = buildFinding("RULE_EMPTY_ACTIONS", [ref("r-post")]);
    const rules = [
      rule({ id: "r-pre", stage: "pre" }),
      rule({ id: "r-post", stage: "post" }),
    ];

    const ranked = rankFindings([post, pre], rules);

    expect(ranked[0].affected[0].id).toBe("r-pre");
  });

  it("prefers the broader claim when everything else ties", () => {
    const wide = buildFinding("RULE_EMPTY_ACTIONS", [ref("r-wide")]);
    const narrow = buildFinding("RULE_EMPTY_ACTIONS", [ref("r-narrow")]);
    const rules = [
      rule({
        id: "r-wide",
        conditions: [{ field: "payee", op: "oneOf", value: ["a", "b", "c", "d"] }],
      }),
      rule({ id: "r-narrow" }),
    ];

    const ranked = rankFindings([narrow, wide], rules);

    expect(ranked[0].affected[0].id).toBe("r-wide");
  });

  it("is stable — equal findings come out in the same order every run", () => {
    const findings = ["r1", "r2", "r3"].map((id) =>
      buildFinding("RULE_EMPTY_ACTIONS", [ref(id)])
    );
    const rules = ["r1", "r2", "r3"].map((id) => rule({ id }));

    const forward = rankFindings(findings, rules);
    const backward = rankFindings([...findings].reverse(), rules);

    expect(backward.map((f) => f.affected[0].id)).toEqual(forward.map((f) => f.affected[0].id));
  });

  it("ranks a finding whose rules are gone without throwing", () => {
    const orphan = buildFinding("RULE_EMPTY_ACTIONS", [ref("missing")]);
    expect(() => rankFindings([orphan], [])).not.toThrow();
  });
});
