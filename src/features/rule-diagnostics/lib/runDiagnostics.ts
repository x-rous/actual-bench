import type {
  CheckContext,
  CheckFn,
  DiagnosticReport,
  Finding,
  Severity,
  WorkingSet,
} from "../types";
import {
  rulePartSignatures,
  ruleSignature,
  workingSetSignature,
} from "./ruleSignature";

// Registered checks, ordered cheapest → most expensive. The CHECKS array is
// exposed so tests and other phases can replace it; production code mutates
// it at import time via addCheck() in the check modules.
const registered: CheckFn[] = [];

export const CHECKS: readonly CheckFn[] = registered;

export function registerCheck(check: CheckFn): void {
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

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function compareFindings(a: Finding, b: Finding): number {
  const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severityDelta !== 0) return severityDelta;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  const aId = a.affected[0]?.id ?? "";
  const bId = b.affected[0]?.id ?? "";
  if (aId === bId) return 0;
  return aId < bId ? -1 : 1;
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

  const sorted = all.sort(compareFindings);

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
