import type { SqliteDatabase } from "@/lib/app-db/types";
import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import { getEffectiveDebtAnchor } from "@/lib/app-db/debtAnchorRepository";
import { getDebtDetail } from "./debtConfigService";
import { projectStoredDebt } from "./projectionService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";
import type { PostingOutputSnapshot } from "./snapshot";
import { settledPaymentOf } from "./repaymentAlignment";

export type LoanSummary = {
  forecastFrom: string;
  paymentsMade: number;
  totalPayments: number;
  next: { date: string; amountMinor: number } | null;
  /** Confirmed posting history only, not scheduled interest or a lifetime total. Minor units. */
  interestToDateMinor: number;
  totalInterestMinor: number;
  calculatedBalanceMinor: number;
  payoffDate: string | null;
  regularRepaymentMinor: number | null;
  dueSoonMinor: number;
  dueSoonCount: number;
};

/** Compact overview payload: forecast facts and confirmed history have separate sources. */
export function summarizeStoredLoan(db: SqliteDatabase, id: string, input: { today: string; offsetHistories?: OffsetHistorySnapshot[] }) {
  const detail = getDebtDetail(db, id);
  if (!detail) return { ok: false as const, notFound: true as const };
  const anchor = getEffectiveDebtAnchor(db, id);
  const projected = projectStoredDebt(db, id, { from: "0001-01-01", to: `${Number(input.today.slice(0, 4)) + 60}-12-31`, resolution: "events", offsetHistories: input.offsetHistories }, detail);
  if (!projected.ok) return projected;
  if (!projected.projection.ok) return { ok: false as const, blocked: { code: "invalid-config", message: projected.projection.blocked.map((item) => item.message).join(" ") } };
  const events = projected.projection.events;
  const paidOff = detail.paidOff && detail.paidOff.paidDate <= input.today ? detail.paidOff : null;
  const remaining = paidOff ? [] : events.filter((event) => event.date > input.today);
  const payments = remaining.filter((event) => event.eventType === "repayment" || event.eventType === "final-payment");
  const confirmed = new Map<string, PostingOutputSnapshot>();
  let chargeInterest = 0;
  const postings = listSubjectPostings(db, "debt", id).sort((a, b) => (a.appliedAt ?? a.updatedAt).localeCompare(b.appliedAt ?? b.updatedAt));
  for (const posting of postings) {
    if (posting.status !== "applied" || posting.reversalOf) continue;
    const output = JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
    if (posting.postingKind === "interest-charge" && output.kind === "create") chargeInterest += output.operations.filter((operation) => operation.date <= input.today && operation.economicKind === "interest").reduce((sum, operation) => sum + Math.abs(operation.amountMinor), 0);
    if (posting.postingKind === "interest-link" && output.kind === "claim" && !output.release) chargeInterest += output.rows.filter((row) => row.date <= input.today).reduce((sum, row) => sum + Math.abs(row.amountMinor), 0);
    const paid = settledPaymentOf(output);
    if (paid && paid.date <= input.today && (posting.postingKind === "repayment-split" || posting.postingKind === "repayment-link")) {
      const paymentId = output.kind === "link" ? output.sourceBefore.parentId ?? paid.paymentId : paid.paymentId;
      // Linking a split's principal to a lender row confirms the same repayment; its split still
      // supplies interest figures. A later approved split adjustment replaces the original figures.
      if (output.kind !== "link" || !confirmed.has(paymentId)) confirmed.set(paymentId, output);
    }
  }
  let interest = chargeInterest;
  for (const output of confirmed.values()) {
    if ((output.kind === "claim" || output.kind === "adjust-split") && output.recordedSplit) interest += output.recordedSplit.interestMinor;
    else if ("components" in output) interest += output.components.filter((component) => component.kind === "interest").reduce((sum, component) => sum + component.amountMinor, 0);
  }
  const soon = new Date(Date.parse(`${input.today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const due = payments.filter((payment) => payment.date <= soon);
  const forecastInterest = remaining.reduce((sum, event) => sum + event.interestMinor, 0);
  const summary: LoanSummary = {
    forecastFrom: anchor?.anchorDate ?? projected.model.terms.openingDate,
    paymentsMade: confirmed.size,
    totalPayments: confirmed.size + payments.length,
    next: payments[0] ? { date: payments[0].date, amountMinor: -payments[0].cashMovementMinor } : null,
    interestToDateMinor: interest,
    totalInterestMinor: interest + forecastInterest,
    calculatedBalanceMinor: paidOff ? 0 : events.filter((event) => event.date <= input.today).at(-1)?.balanceAfterMinor ?? anchor?.principalMinor ?? projected.model.terms.openingPrincipalMinor,
    payoffDate: paidOff?.paidDate ?? events.find((event) => event.balanceBeforeMinor > 0 && event.balanceAfterMinor === 0 && event.eventType !== "interest-charge")?.date ?? null,
    regularRepaymentMinor: payments[0] ? -payments[0].cashMovementMinor : null,
    dueSoonMinor: due.reduce((sum, event) => sum - event.cashMovementMinor, 0), dueSoonCount: due.length,
  };
  return { ok: true as const, summary };
}
