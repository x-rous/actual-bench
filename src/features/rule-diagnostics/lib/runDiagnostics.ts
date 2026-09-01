import type {
  CheckContext,
  CheckFn,
  DiagnosticReport,
  Finding,
  WorkingSet,
} from "../types";
import {
  rulePartSignatures,
  ruleSignature,
  workingSetSignature,
} from "./ruleSignature";
import { rankFindings } from "./ranking";

// Registered checks, ordered cheapest → most expensive. The CHECKS array is
// exposed so tests and other phases can replace it; production code mutates
// it at import time via registerCheck() in the check modules.
const registered: CheckFn[] = [];

export const CHECKS: readonly CheckFn[] = registered;

/**
 * Add a check to the registry, or replace the one already standing under that
 * name.
 *
 * Registration happens as a side effect of importing a check module, and in
 * development that import runs again on every hot reload — with a *new* function
 * object each time, so identity cannot tell the two apart. Appending blindly
 * meant the registry grew a fresh copy of every check per reload, and the report
 * then carried each finding as many times as the page had been rebuilt: one rule
 * reported seven times, which reads as seven problems.
 *
 * Keying on the function's name replaces the stale copy with the reloaded one,
 * which is also what the developer editing it wants. An anonymous check has no
 * key to replace and is simply appended.
 */
export function registerCheck(check: CheckFn): void {
  const name = check.name;
  if (name) {
    const existing = registered.findIndex((entry) => entry.name === name);
    if (existing !== -1) {
      registered[existing] = check;
      return;
    }
  }
  registered.push(check);
}

/** Reset the registry — tests only. */
export function __resetChecks(): void {
  registered.length = 0;
}

function buildContext(ws: WorkingSet): CheckContext {
  const partSignatures = new Map<string, string[]>();
  const ruleSignatures = new Map<string, string>();
  const rulesByPartition = new Map<string, typeof ws.rules>();
  const scheduleLinkedRuleIds = new Set<string>();

  for (const rule of ws.rules) {
    partSignatures.set(rule.id, rulePartSignatures(rule));
    ruleSignatures.set(rule.id, ruleSignature(rule));
    const key = `${rule.stage}|${rule.conditionsOp}`;
    const bucket = rulesByPartition.get(key);
    if (bucket) bucket.push(rule);
    else rulesByPartition.set(key, [rule]);
    if (rule.actions.some((a) => a.op === "link-schedule")) {
      scheduleLinkedRuleIds.add(rule.id);
    }
  }

  // fullDuplicateRuleIds — pre-compute so near-duplicate check can exclude them.
  const bySignature = new Map<string, string[]>();
  for (const [ruleId, sig] of ruleSignatures.entries()) {
    if (scheduleLinkedRuleIds.has(ruleId)) continue;
    const bucket = bySignature.get(sig);
    if (bucket) bucket.push(ruleId);
    else bySignature.set(sig, [ruleId]);
  }
  const fullDuplicateRuleIds = new Set<string>();
  for (const bucket of bySignature.values()) {
    if (bucket.length >= 2) {
      for (const id of bucket) fullDuplicateRuleIds.add(id);
    }
  }

  return {
    partSignatures,
    ruleSignatures,
    rulesByPartition,
    scheduleLinkedRuleIds,
    fullDuplicateRuleIds,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run every registered diagnostic check against the given working set.
 * Pure and deterministic: identical input → byte-identical findings.
 */
export async function runDiagnostics(ws: WorkingSet): Promise<DiagnosticReport> {
  const ctx = buildContext(ws);
  const all: Finding[] = [];

  for (const check of registered) {
    await yieldToEventLoop();
    const findings = check(ws, ctx);
    for (const f of findings) all.push(f);
  }

  // Severity first, then what acting on each finding is worth — see
  // `ranking.ts`. Deterministic: identical input still gives byte-identical
  // output, which is what staleness detection depends on.
  const sorted = rankFindings(all, ws.rules);

  const summary = { error: 0, warning: 0, info: 0, total: sorted.length };
  for (const f of sorted) {
    summary[f.severity] += 1;
  }

  return {
    runAt: new Date().toISOString(),
    findings: sorted,
    summary,
    workingSetSignature: workingSetSignature(ws.rules),
    ruleCount: ws.rules.length,
  };
}
