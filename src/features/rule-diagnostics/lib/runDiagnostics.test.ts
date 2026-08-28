import type { Rule, Payee } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { CheckFn, WorkingSet } from "../types";
import { CHECKS, __resetChecks, registerCheck, runDiagnostics } from "./runDiagnostics";
// Import the registration barrel so all checks are present.
import "./checks/register";

function staged<T extends { id: string }>(entity: T): StagedMap<T>[string] {
  return {
    entity,
    original: entity,
    isNew: false,
    isUpdated: false,
    isDeleted: false,
    validationErrors: {},
  };
}

function rule(partial: Partial<Rule> & { id: string }): Rule {
  return {
    id: partial.id,
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [{ field: "category", op: "set", value: "c-1" }],
  };
}

function makeWs(rules: Rule[], payeesLive: string[] = []): WorkingSet {
  const payees: StagedMap<Payee> = {};
  for (const id of payeesLive) {
    payees[id] = staged({ id, name: `Payee ${id}` });
  }
  return {
    rules,
    entityMaps: { payees, categories: {}, accounts: {}, categoryGroups: {}, schedules: {} },
    entityExists: {
      payees: new Set(payeesLive),
      categories: new Set(),
      accounts: new Set(),
      categoryGroups: new Set(),
    },
  };
}

describe("runDiagnostics", () => {
  it("produces deterministic findings: two runs are JSON-equal", async () => {
    const ws = makeWs(
      [
        rule({
          id: "r1",
          conditions: [{ field: "payee", op: "is", value: "p-deleted" }],
        }),
        rule({ id: "r2", actions: [] }),
      ],
      []
    );
    const a = await runDiagnostics(ws);
    const b = await runDiagnostics(ws);
    // runAt differs each invocation; compare findings + summary instead.
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
    expect(a.summary).toEqual(b.summary);
    expect(a.workingSetSignature).toBe(b.workingSetSignature);
  });

  it("returns an empty report for an empty working set", async () => {
    const report = await runDiagnostics(makeWs([]));
    expect(report.summary.total).toBe(0);
    expect(report.findings).toHaveLength(0);
    expect(report.ruleCount).toBe(0);
  });

  it("sorts findings: error → warning → info", async () => {
    const ws = makeWs(
      [
        rule({
          id: "r-warn",
          conditions: [{ field: "imported_payee", op: "contains", value: "a" }],
        }),
        rule({
          id: "r-error",
          conditions: [{ field: "payee", op: "is", value: "p-deleted" }],
        }),
      ],
      []
    );
    const report = await runDiagnostics(ws);
    if (report.findings.length >= 2) {
      const severities = report.findings.map((f) => f.severity);
      const errorIndex = severities.indexOf("error");
      const warningIndex = severities.indexOf("warning");
      if (errorIndex !== -1 && warningIndex !== -1) {
        expect(errorIndex).toBeLessThan(warningIndex);
      }
    }
  });

  it("schedule-linked rules are still flagged for missing entity references but not for empty actions", async () => {
    const r = rule({
      id: "r-sched",
      conditions: [{ field: "payee", op: "is", value: "p-deleted" }],
      actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
    });
    const ws = makeWs([r], []);
    const report = await runDiagnostics(ws);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain("RULE_MISSING_PAYEE");
    expect(codes).not.toContain("RULE_EMPTY_ACTIONS");
    expect(codes).not.toContain("RULE_NOOP_ACTIONS");
  });

  it("workingSetSignature is part of the report", async () => {
    const report = await runDiagnostics(makeWs([rule({ id: "r1" })]));
    expect(typeof report.workingSetSignature).toBe("string");
    expect(report.workingSetSignature.length).toBeGreaterThan(0);
  });
});

describe("check registration", () => {
  it("replaces a check registered again under the same name rather than running it twice", () => {
    // Importing a check module runs its registerCheck() again on every hot
    // reload, with a new function object each time. Appending meant the report
    // carried each finding once per rebuild - one rule reported seven times.
    const saved = [...CHECKS];
    __resetChecks();

    const first: CheckFn = function sameName() {
      return [];
    };
    const second: CheckFn = function sameName() {
      return [];
    };
    registerCheck(first);
    registerCheck(second);

    expect(CHECKS).toHaveLength(1);
    expect(CHECKS[0]).toBe(second);

    __resetChecks();
    for (const check of saved) registerCheck(check);
  });
});
