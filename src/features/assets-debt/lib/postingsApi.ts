import type { AccountDirectory, MatchingHistorySnapshot } from "@/lib/assets-debt/actual/ledgerPort";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { PlanningNotice } from "@/lib/assets-debt/services/planner/common";
import type { FollowedExtraPayment, UnscheduledPayment } from "@/lib/assets-debt/services/extraPaymentService";
import type { PaymentOption, PostingView } from "@/lib/assets-debt/services/proposalService";
import type { ReproductionResult } from "@/lib/assets-debt/services/reproduceService";
import type { RowSnapshot } from "@/lib/assets-debt/services/snapshot";
import type { ApplyTicketView, ExecutorOutcome } from "@/lib/assets-debt/services/applyService";
import { request } from "./debtsApi";

/**
 * Client for the RD-084 P1.6 posting routes. Preview, decline, Undo and
 * reproduce never write to Actual. `approveAndApply` is the user's explicit
 * Apply: it returns the server's ticket, which the apply hook alone hands to
 * the browser executor.
 */

export type PreviewBody = {
  from: string;
  to: string;
  snapshots: MatchingHistorySnapshot[];
  accountDirectory: AccountDirectory;
  transferPayees: Record<string, string>;
  capabilities: { canRestructure: boolean; canVerifyTransferLinks: boolean };
  offsetHistories?: OffsetHistorySnapshot[];
  loanAccountRows?: Array<{ id: string; date: string; amountMinor: number }>;
  followExtraPayments?: boolean;
  readRanges?: Array<{ accountId: string; from: string; to: string }>;
  comparison?: { comparisonDate: string; actualBalanceMinor: number } | null;
  parameters?: { openingAdjustmentCategoryId?: string | null; adjustmentCategoryId?: string | null; actualBalanceAtOnboardingMinor?: number | null };
};

export type PreviewResponse = { ok: true; postings: PostingView[]; notices: PlanningNotice[]; driftMaterial: boolean; driftExplained?: boolean; unscheduled?: UnscheduledPayment[]; followedExtraPayments?: FollowedExtraPayment[]; paymentOptions?: PaymentOption[]; repaymentChoices?: Array<{ key: string; paymentId: string }>; changedInActual?: Array<{ postingId: string; periodKey: string; detail: string }>; reconciliation?: unknown };

const debtUrl = (id: string) => `/api/assets-debt/debts/${encodeURIComponent(id)}`;
const postingUrl = (id: string) => `/api/assets-debt/postings/${encodeURIComponent(id)}`;

export const previewPostings = (debtId: string, body: PreviewBody) =>
  request<PreviewResponse>(`${debtUrl(debtId)}/preview`, { method: "POST", body: JSON.stringify(body) });

export const listPostings = (debtId: string) => request<{ postings: PostingView[] }>(`${debtUrl(debtId)}/postings`).then((r) => r.postings);

export const approveAndApply = (postingId: string, fresh: RowSnapshot[]) =>
  request<{ ticket: ApplyTicketView }>(`${postingUrl(postingId)}/apply`, { method: "POST", body: JSON.stringify({ action: "apply", fresh }) }).then((r) => r.ticket);

/** Apply a claim (writes nothing to Actual) in one call: approval, preflight and the recorded outcome. */
export const approveAndRecordClaim = (postingId: string, fresh: RowSnapshot[]) =>
  request<{ posting: PostingView }>(`${postingUrl(postingId)}/apply`, { method: "POST", body: JSON.stringify({ action: "record-claim", fresh }) }).then((r) => r.posting);

export const beginCompleteLink = (postingId: string) =>
  request<{ ticket: ApplyTicketView }>(`${postingUrl(postingId)}/apply`, { method: "POST", body: JSON.stringify({ action: "complete-link" }) }).then((r) => r.ticket);

export type OutcomeBody = ExecutorOutcome | { status: "not-found"; reason: { code: string; text: string } };

export const recordOutcome = (postingId: string, outcome: OutcomeBody) =>
  request<{ posting: PostingView }>(`${postingUrl(postingId)}/outcome`, { method: "POST", body: JSON.stringify(outcome) }).then((r) => r.posting);

export const declinePosting = (postingId: string) =>
  request<{ posting: PostingView }>(`${postingUrl(postingId)}/decline`, { method: "POST", body: "{}" }).then((r) => r.posting);

/** The user's edit of a proposed split's interest (T291); returns the new Review proposal. */
export const overrideSplit = (postingId: string, body: { interestMinor: number; reason: string | null }) =>
  request<{ posting: PostingView }>(`${postingUrl(postingId)}/override`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.posting);

export const proposeReversal = (postingId: string, body: { accountDirectory: AccountDirectory; transferPayees: Record<string, string> }) =>
  request<{ posting: PostingView }>(`${postingUrl(postingId)}/reverse`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.posting);

/** "Unsplit" a recorded split already in Actual (a Review proposal on its row). */
export const proposeUnsplit = (postingId: string, body: { accountDirectory: AccountDirectory; transferPayees: Record<string, string> }) =>
  request<{ posting: PostingView }>(`${postingUrl(postingId)}/unsplit`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.posting);

export const reproducePosting = (postingId: string) =>
  request<{ reproduction: ReproductionResult }>(`${postingUrl(postingId)}/reproduce`, { method: "POST", body: "{}" }).then((r) => r.reproduction);
