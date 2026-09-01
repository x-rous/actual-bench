import type { Rule } from "@/types/entities";
import type { RuleDiagnosticsDismissalRecord } from "@/lib/app-db/types";
import { buildFinding } from "./findingMessages";
import { ruleSignature } from "./ruleSignature";
import {
  applyDismissals,
  collectGarbage,
  discriminatorFor,
  dismisses,
  findingSignatures,
} from "./dismissals";
import type { Finding, FindingCode } from "../types";

function rule(id: string, payee = "p-1", category = "c-1"): Rule {
  return {
    id,
    stage: "default",
    conditionsOp: "and",
    conditions: [{ field: "payee", op: "is", value: payee }],
    actions: [{ field: "category", op: "set", value: category }],
  };
}

function byId(rules: Rule[]): Map<string, Rule> {
  return new Map(rules.map((r) => [r.id, r]));
}

function family(rules: Rule[]): Finding {
  return buildFinding(
    "RULE_NEAR_DUPLICATE_FAMILY",
    rules.map((r) => ({ id: r.id, summary: `rule ${r.id}` })),
    { stage: "default", varying: 2 }
  );
}

function record(
  overrides: Partial<RuleDiagnosticsDismissalRecord> & { ruleIds?: string[] }
): RuleDiagnosticsDismissalRecord {
  return {
    id: "d-1",
    budgetSyncId: "budget-1",
    code: "RULE_NEAR_DUPLICATE_FAMILY" as FindingCode,
    ruleIds: overrides.ruleIds ?? [],
    signatures: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("discriminatorFor", () => {
  it("keys a broad match on its field and value", () => {
    const a = discriminatorFor("RULE_BROAD_MATCH", { field: "imported_payee", value: "A" });
    const b = discriminatorFor("RULE_BROAD_MATCH", { field: "imported_payee", value: "XY" });
    expect(a).toBeDefined();
    expect(a).not.toBe(b);
  });

  it("gives structural findings no discriminator", () => {
    expect(discriminatorFor("RULE_EMPTY_ACTIONS", {})).toBeUndefined();
    expect(discriminatorFor("RULE_SHADOWED", {})).toBeUndefined();
    expect(discriminatorFor("RULE_NEAR_DUPLICATE_FAMILY", { stage: "default" })).toBeUndefined();
  });

  it("keys a missing reference on the entity, order-independently", () => {
    const a = discriminatorFor("RULE_MISSING_PAYEE", { references: ["p-9", "p-3"] });
    const b = discriminatorFor("RULE_MISSING_PAYEE", { references: ["p-3", "p-9"] });
    expect(a).toBe(b);
    expect(a).toBeDefined();
  });
});

describe("dismisses", () => {
  const r1 = rule("r1", "aldi");
  const r2 = rule("r2", "lidl");
  const rules = byId([r1, r2]);

  it("matches the same grouping by id", () => {
    const finding = family([r1, r2]);
    expect(dismisses(record({ ruleIds: ["r1", "r2"] }), finding, rules)).toBe(true);
  });

  it("survives an unrelated edit to a participant, via the id leg", () => {
    const edited = { ...r2, actions: [{ field: "notes", op: "set", value: "x" }] } as Rule;
    const finding = family([r1, edited]);
    expect(
      dismisses(record({ ruleIds: ["r1", "r2"] }), finding, byId([r1, edited]))
    ).toBe(true);
  });

  it("survives an id change with identical content, via the signature leg", () => {
    // What a save does to a staged rule: same content, a server-assigned id.
    const saved1 = { ...r1, id: "server-1" };
    const saved2 = { ...r2, id: "server-2" };
    const finding = family([saved1, saved2]);
    const stored = record({
      ruleIds: ["client-1", "client-2"],
      signatures: [ruleSignature(r1), ruleSignature(r2)],
    });
    expect(dismisses(stored, finding, byId([saved1, saved2]))).toBe(true);
  });

  it("does not silence a superset grouping the user has never seen", () => {
    const r3 = rule("r3", "coles");
    const finding = family([r1, r2, r3]);
    expect(
      dismisses(record({ ruleIds: ["r1", "r2"] }), finding, byId([r1, r2, r3]))
    ).toBe(false);
  });

  it("does not silence a different finding about the same rules", () => {
    const finding = buildFinding("RULE_DUPLICATE_GROUP", [
      { id: "r1", summary: "rule r1" },
      { id: "r2", summary: "rule r2" },
    ]);
    expect(dismisses(record({ ruleIds: ["r1", "r2"] }), finding, rules)).toBe(false);
  });

  it("does not silence the same code on a different value", () => {
    const broadA = buildFinding("RULE_BROAD_MATCH", [{ id: "r1", summary: "rule r1" }], {
      field: "imported_payee",
      value: "A",
    });
    const broadB = buildFinding("RULE_BROAD_MATCH", [{ id: "r1", summary: "rule r1" }], {
      field: "imported_payee",
      value: "XY",
    });
    const stored = record({
      code: "RULE_BROAD_MATCH",
      ruleIds: ["r1"],
      discriminator: broadA.discriminator,
    });
    expect(dismisses(stored, broadA, rules)).toBe(true);
    expect(dismisses(stored, broadB, rules)).toBe(false);
  });

  it("distinguishes [A, A] from [A, B] — multiset, not set", () => {
    const dup = rule("r1b", "aldi");
    const finding = family([r1, dup]);
    // Both members share a signature; a two-member record of one signature must
    // not match a grouping of two different rules.
    const stored = record({ ruleIds: [], signatures: [ruleSignature(r1), ruleSignature(r2)] });
    expect(dismisses(stored, finding, byId([r1, dup]))).toBe(false);
  });

  it("ignores a signature match when a participant has vanished", () => {
    const finding = family([r1, r2]);
    const stored = record({
      ruleIds: [],
      signatures: [ruleSignature(r1), ruleSignature(r2)],
    });
    // Only one participant is still in the working set, so the signature list is
    // short — a shorter list must not match by accident.
    expect(dismisses(stored, finding, byId([r1]))).toBe(false);
  });
});

describe("findingSignatures", () => {
  it("includes a counterpart, because it is part of the grouping", () => {
    const shadowed = rule("r1");
    const shadower = rule("r2");
    const finding = buildFinding(
      "RULE_SHADOWED",
      [{ id: "r1", summary: "rule r1" }],
      {},
      { id: "r2", summary: "rule r2" }
    );
    expect(findingSignatures(finding, byId([shadowed, shadower]))).toHaveLength(2);
  });
});

describe("applyDismissals", () => {
  it("splits the report and keeps the record that silenced each finding", () => {
    const r1 = rule("r1", "aldi");
    const r2 = rule("r2", "lidl");
    const dismissedFinding = family([r1, r2]);
    const other = buildFinding("RULE_EMPTY_ACTIONS", [{ id: "r3", summary: "rule r3" }]);
    const stored = record({ ruleIds: ["r1", "r2"] });

    const split = applyDismissals([dismissedFinding, other], [stored], byId([r1, r2]));

    expect(split.visible).toEqual([other]);
    expect(split.dismissed).toHaveLength(1);
    expect(split.dismissed[0].record.id).toBe("d-1");
  });

  it("returns the findings untouched when there is nothing dismissed", () => {
    const finding = buildFinding("RULE_EMPTY_ACTIONS", [{ id: "r1", summary: "rule r1" }]);
    expect(applyDismissals([finding], [], new Map()).visible).toEqual([finding]);
  });
});

describe("collectGarbage", () => {
  const r1 = rule("r1", "aldi");
  const r2 = rule("r2", "lidl");

  it("collects a record whose rules were merged away", () => {
    const merged = rule("merged", "aldi-or-lidl", "c-2");
    const stored = record({
      ruleIds: ["r1", "r2"],
      signatures: [ruleSignature(r1), ruleSignature(r2)],
    });
    expect(collectGarbage([stored], [merged])).toEqual(["d-1"]);
  });

  it("keeps a record that still matches by signature alone", () => {
    const renamedId = { ...r1, id: "r1-new" };
    const stored = record({ ruleIds: ["r1"], signatures: [ruleSignature(r1)] });
    expect(collectGarbage([stored], [renamedId])).toEqual([]);
  });

  it("keeps a record that still matches by id alone", () => {
    const edited = { ...r1, actions: [{ field: "notes", op: "set", value: "x" }] } as Rule;
    const stored = record({ ruleIds: ["r1"], signatures: [ruleSignature(r1)] });
    expect(collectGarbage([stored], [edited])).toEqual([]);
  });

  it("collects nothing when the working set is empty", () => {
    // An unloaded rule set is not an empty one — collecting here would delete
    // every decision the user has ever made.
    const stored = record({ ruleIds: ["r1"], signatures: [ruleSignature(r1)] });
    expect(collectGarbage([stored], [])).toEqual([]);
  });
});
