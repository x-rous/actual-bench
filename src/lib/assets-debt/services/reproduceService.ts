import { getFinancialPosting, listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import { getModelRevision } from "@/lib/app-db/modelRevisionRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { CURRENT_COMPONENT_VERSIONS } from "@/lib/financial-models/loan/versions";
import { parseDebtConfig } from "@/lib/financial-models/loan/configSchema";
import { modelFromDetail } from "../model/buildModel";
import type { DebtDetail } from "./debtConfigService";
import { calculatePeriod, type ComponentLine, type PostingInputSnapshot, type PostingOutputSnapshot } from "./snapshot";

/**
 * Reproduction (RD-084 P1.6 T135; FR-182, FR-183, SC-005).
 *
 * Recomputes a posting from what was stored: its `model_revisions` snapshot,
 * its input snapshot and the engine at the recorded component versions. It
 * takes no transport and never reads Actual. The Actual ids are only shown so
 * the user can find the rows.
 */

export type ReproductionResult = {
  postingId: string;
  status: "exact-match" | "mismatch" | "not-reproducible" | "not-calculated";
  stored: ComponentLine[];
  recomputed: ComponentLine[];
  detail: string;
  continuity: "continuous" | "re-anchored" | "first" | "gap";
};

const ENGINE_KINDS = new Set(["interest-charge", "fee-charge", "repayment-split"]);

function componentsFor(postingKind: string, events: ReturnType<typeof calculatePeriod> & { ok: true }, stored: ComponentLine[]): ComponentLine[] {
  if (postingKind === "interest-charge") {
    const charge = events.events.find((e) => e.eventType === "interest-charge");
    return charge ? [{ kind: "interest", amountMinor: Math.abs(charge.interestMinor) }] : [];
  }
  if (postingKind === "fee-charge") {
    const fee = events.events.find((e) => e.eventType === "fee" && e.principalMovementMinor > 0);
    return fee ? [{ kind: "fee", amountMinor: Math.abs(fee.feesMinor) || fee.principalMovementMinor }] : [];
  }
  // repayment-split: the engine owns interest and fees; principal is the residual of the matched payment.
  const repayment = events.events.find((e) => e.eventType === "repayment" || e.eventType === "final-payment");
  if (!repayment) return [];
  const total = stored.reduce((sum, c) => sum + c.amountMinor, 0);
  const out: ComponentLine[] = [];
  const interest = Math.abs(repayment.interestMinor);
  const fees = Math.abs(repayment.feesMinor);
  for (const c of stored) {
    if (c.kind === "interest") out.push({ kind: "interest", amountMinor: interest });
    else if (c.kind === "fee") out.push({ kind: "fee", amountMinor: fees || c.amountMinor });
    else if (c.kind !== "principal") out.push({ ...c });
  }
  out.unshift({ kind: "principal", amountMinor: total - out.reduce((sum, c) => sum + c.amountMinor, 0) });
  return stored.map((c) => out.find((o) => o.kind === c.kind) ?? { kind: c.kind, amountMinor: 0 });
}

function detailFromRevision(configJson: string, subjectId: string, revision: number): DebtDetail | null {
  const snapshot = JSON.parse(configJson) as { debt: Record<string, unknown>; config: unknown; rates: Record<string, unknown>[]; offsets: Record<string, unknown>[]; assumptions: Record<string, unknown>[] };
  const config = parseDebtConfig(JSON.stringify(snapshot.config));
  if (!config.ok) return null;
  return {
    debt: { ...(snapshot.debt as object), id: subjectId, currentRevision: revision, unknownValues: [] } as unknown as DebtDetail["debt"],
    config,
    rates: snapshot.rates as unknown as DebtDetail["rates"],
    offsets: snapshot.offsets.map((o) => ({ ...o, useActualBalance: o.useActualBalance === true })) as unknown as DebtDetail["offsets"],
    assumptions: snapshot.assumptions as unknown as DebtDetail["assumptions"],
    revision: { number: revision, hash: null, createdAt: null },
    blocked: null,
  };
}

/** FR-182: stored vs recomputed, with match status. Runs with no transport at all. */
export function reproducePosting(db: SqliteDatabase, postingId: string, transport?: undefined): ReproductionResult | null {
  void transport;
  const posting = getFinancialPosting(db, postingId);
  if (!posting) return null;
  const input = JSON.parse(posting.inputSnapshotJson) as PostingInputSnapshot;
  const output = JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
  const stored = "components" in output ? output.components : [];
  const kind = typeof posting.postingKind === "string" ? posting.postingKind : posting.postingKind.unknown;
  const continuity = continuityOf(db, posting.subjectId, postingId, input);
  const base = { postingId, stored, continuity } as const;
  if (!ENGINE_KINDS.has(kind)) return { ...base, status: "not-calculated", recomputed: stored, detail: "This posting records a link, an adjustment or a reversal; its amounts come from stored evidence, not the engine." };
  const unavailable = Object.entries(posting.engineVersions).filter(([name, version]) => (CURRENT_COMPONENT_VERSIONS as Record<string, string>)[name] !== undefined && (CURRENT_COMPONENT_VERSIONS as Record<string, string>)[name] !== version);
  if (unavailable.length) {
    return { ...base, status: "not-reproducible", recomputed: [], detail: `Recorded engine versions are not callable in this build: ${unavailable.map(([n, v]) => `${n} ${v}`).join(", ")}. A documented migration is required (FR-183).` };
  }
  const revision = getModelRevision(db, "debt", posting.subjectId, posting.configRevision);
  if (!revision || revision.configHash !== input.subject.configHash) return { ...base, status: "not-reproducible", recomputed: [], detail: "The stored configuration revision is missing or does not match the posting's hash." };
  const detail = detailFromRevision(revision.configJson, posting.subjectId, posting.configRevision);
  const built = detail ? modelFromDetail(detail) : null;
  if (!built || !built.ok) return { ...base, status: "not-reproducible", recomputed: [], detail: "The stored configuration revision cannot be read by this build." };
  const result = calculatePeriod({ model: built.model, opening: input.opening, offsets: input.offsets, from: input.period.from, to: input.period.to });
  if (!result.ok) return { ...base, status: "mismatch", recomputed: [], detail: result.message };
  const recomputed = componentsFor(kind, result, stored);
  const exact = recomputed.length === stored.length && recomputed.every((c, i) => c.kind === stored[i].kind && c.amountMinor === stored[i].amountMinor);
  return { ...base, status: exact ? "exact-match" : "mismatch", recomputed, detail: exact ? "Recomputed from stored inputs at the recorded engine versions." : "The recomputed result differs from the stored one. Treat this as a defect unless a documented migration explains it." };
}

/** Continuity: consecutive engine postings share their opening unless a newer anchor explains the change. */
function continuityOf(db: SqliteDatabase, subjectId: string, postingId: string, input: PostingInputSnapshot): ReproductionResult["continuity"] {
  const applied = listSubjectPostings(db, "debt", subjectId).filter((p) => p.status === "applied" && typeof p.postingKind === "string" && ENGINE_KINDS.has(p.postingKind));
  const index = applied.findIndex((p) => p.id === postingId);
  if (index <= 0) return "first";
  const previous = JSON.parse(applied[index - 1].inputSnapshotJson) as PostingInputSnapshot;
  if (JSON.stringify(previous.opening) === JSON.stringify(input.opening)) return "continuous";
  return previous.opening.date < input.opening.date ? "re-anchored" : "gap";
}
