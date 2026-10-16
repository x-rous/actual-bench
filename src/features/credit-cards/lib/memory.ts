import { financingCostKind, isTrackingTransfer, planOwnsTrackingRow, trackingBalance, trackingRowIndex, trackingTransferMatches } from "./planTracking";
import { createStore } from "zustand/vanilla";
import { parseIsoDate, daysBetween } from "@/lib/financial-models/calendar/dates";
import { generateId } from "@/lib/uuid";
import { repaymentPlanSchema, planLinkSchema, membershipSchema, allocationSchema, activityClassificationSchema, cardInputSchema, cardSchema, statementFactsSchema, statementSchema, type Card, type Statement, type OpeningPosition, type Membership, type Workspace } from "./models";

import type { ActivitySnapshot } from "./activity";
import { paymentEvidence } from "./activity";
import { statementReview, sumMinor, membershipOwner, movedMemberships, type StatementMove } from "./statements";
import { refundEvidenceSignature, planProjection, planSchedule, planSources } from "./plans";
import { repaymentLedger } from "./repayments";

export type CreditCardState = {
  workspaces: Readonly<Record<string, Workspace>>;
  undoHistory: Readonly<Record<string, Workspace[]>>;
  notices: Readonly<Record<string, string>>;
  undo: (budget: string) => void;
  resetReview: (budget: string, statementId: string, expectedRevision: number) => void;
  deleteStatement: (budget: string, statementId: string, expectedRevision: number) => void;
  recordStatement: (budget: string, cardId: string, expectedRevision: number, input: unknown, bankConfirmed: boolean) => Statement;
  saveReview: (budget: string, statementId: string, expectedRevision: number, snapshot: ActivitySnapshot, input: Membership[], verify: boolean, moves?: StatementMove[]) => void;
  allocate: (budget: string, cardId: string, expectedRevision: number, snapshot: ActivitySnapshot, transactionId: string, input: unknown[]) => void;
  savePlan: (budget: string, cardId: string, expectedRevision: number, snapshot: ActivitySnapshot, input: unknown, links: unknown[]) => void;
  classifyMany: (budget: string, cardId: string, expectedRevision: number, snapshot: ActivitySnapshot, inputs: unknown[]) => void;
  deletePlan: (budget: string, planId: string, expectedPlanRevision: number, expectedCardRevision: number, snapshot?: ActivitySnapshot) => void;
  classify: (budget: string, cardId: string, expectedRevision: number, snapshot: ActivitySnapshot, input: unknown) => void;
  register: (input: unknown) => Card;
  updateCard: (budget: string, cardId: string, expectedRevision: number, input: unknown) => void;
  deleteCard: (budget: string, cardId: string, expectedRevision: number) => void;
  recordOpeningStatement: (budget: string, cardId: string, expectedRevision: number, input: unknown) => Statement;
  correctStatement: (budget: string, statementId: string, expectedRevision: number, input: unknown) => void;
};
export const EMPTY_WORKSPACE: Workspace = { cards: [], statements: [], memberships: [], allocations: [], classifications: [] };

export function openingPosition(workspace: Workspace, cardId: string): OpeningPosition | null {
  const anchor = workspace.statements.find((s) => s.cardId === cardId && s.openingAnchor);
  return anchor ? { cardId, statementId: anchor.id, date: anchor.closingDate, balanceMinor: anchor.officialBalanceMinor } : null;
}

function requireRevision(record: { revision: number } | undefined, expected: number) {
  if (!record) throw new Error("This record is no longer available in the active budget");
  if (record.revision !== expected) throw new Error("This record changed. Reopen the editor to review the latest values; your draft has not been saved.");
  if (!Number.isSafeInteger(expected + 1)) throw new Error("Record revision exceeds the supported range");
}

function checkedClassification(card: Card, cardId: string, workspace: Workspace, snapshot: ActivitySnapshot, raw: unknown) {
        const input = activityClassificationSchema.parse(raw);
        const row = snapshot.rows.find((entry) => entry.id === input.transactionId);
        if (input.cardId !== cardId || snapshot.accountId !== card.accountId || !row || row.fingerprint !== input.fingerprint) throw new Error("This activity changed; refresh and review it");
        if (input.kind === "payment" && (!row.transferId || row.amountMinor <= 0 || isTrackingTransfer(row, snapshot, workspace))) throw new Error("Only an incoming external Actual transfer can be a payment");
        if ((["refund", "cashback", "other-credit", "interest-refund", "fee-refund", "dispute-credit", "plan-conversion"].includes(input.kind) && row.amountMinor <= 0) || (["purchase", "cash-advance", "money-transfer", "interest", "fee", "plan-instalment", "dispute-adjustment", "other-charge"].includes(input.kind) && row.amountMinor >= 0)) throw new Error("Classification must match the transaction amount direction");
        if (input.kind !== "fee" && input.feeSubtype != null) throw new Error("Fee subtype is only valid for a fee");
        const planLink = workspace.planLinks?.find((link) => link.transactionId === row.id);
        if (planLink && ["conversion-credit", "instalment-billed", "combined-instalment", "principal-release"].includes(planLink.role) && ["interest", "fee", "interest-refund", "fee-refund", "payment"].includes(input.kind)) throw new Error("Change the principal plan link before classifying it as a cost or payment");
        if (workspace.plans?.some((plan) => planSources(plan).some((source) => source.transactionId === row.id) && plan.status === "active") && !["purchase", "cash-advance", "money-transfer", "balance-transfer"].includes(input.kind)) throw new Error("Close or review the attached plan before changing its original charge type");
        return input;
}

/** One immutable working set per budget. No persistence middleware or storage adapter. */
export function createCreditCardStore() {
  return createStore<CreditCardState>((set, get) => {
    const read = (budget: string) => get().workspaces[budget] ?? EMPTY_WORKSPACE;
    const write = (budget: string, workspace: Workspace, notice = "Changes saved") => set((state) => ({
      workspaces: { ...state.workspaces, [budget]: workspace },
      undoHistory: { ...state.undoHistory, [budget]: [...(state.undoHistory[budget] ?? []).slice(-19), read(budget)] },
      notices: { ...state.notices, [budget]: notice },
    }));
    return {
      workspaces: {}, undoHistory: {}, notices: {},
      undo(budget) {
        const history = get().undoHistory[budget] ?? [];
        const previous = history.at(-1);
        if (!previous) return;
        const current = read(budget);
        // Undo must not make an old editor revision valid again (ABA prevention).
        const restored: Workspace = { ...previous,
          cards: previous.cards.map((card) => ({ ...card, revision: Math.max(card.revision, current.cards.find((entry) => entry.id === card.id)?.revision ?? 0) + 1 })),
          plans: (previous.plans ?? []).map((plan) => ({ ...plan, revision: Math.max(plan.revision, current.plans?.find((entry) => entry.id === plan.id)?.revision ?? 0) + 1 })),
          statements: previous.statements.map((statement) => ({ ...statement, revision: Math.max(statement.revision, current.statements.find((entry) => entry.id === statement.id)?.revision ?? 0) + 1 })),
        };
        set((state) => ({ workspaces: { ...state.workspaces, [budget]: restored }, undoHistory: { ...state.undoHistory, [budget]: history.slice(0, -1) }, notices: { ...state.notices, [budget]: "Last change undone" } }));
      },
      recordStatement(budget, cardId, expected, raw, bankConfirmed) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        requireRevision(card, expected);
        const facts = statementFactsSchema.parse(raw);
        if (workspace.statements.some((entry) => entry.cardId === cardId && entry.closingDate === facts.closingDate)) throw new Error("A statement already uses this closing date");
        if (workspace.statements.some((entry) => entry.cardId === cardId && !(entry.closingDate < facts.periodStart || entry.periodStart > facts.closingDate))) throw new Error("Statement periods must not overlap. Correct the existing statement instead.");
        const firstTrackedStatementDate = card!.firstTrackedStatementDate ?? workspace.statements.find((entry) => entry.cardId === cardId && entry.openingAnchor)?.closingDate ?? facts.closingDate;
        if (facts.closingDate < firstTrackedStatementDate) throw new Error("This statement is before the first tracked statement. Change the tracking start in Settings first.");
        const openingAnchor = bankConfirmed && facts.closingDate === firstTrackedStatementDate;
        const statement = statementSchema.parse({ ...facts, id: generateId(), cardId, revision: 1, lifecycle: "recorded", verification: "recorded", coverage: "unknown", openingAnchor, bankConfirmed });
        write(budget, { ...workspace, cards: workspace.cards.map((entry) => entry.id === cardId ? { ...entry, revision: expected + 1, firstTrackedStatementDate,
          ...(bankConfirmed && entry.closingDay === null ? { closingDay: parseIsoDate(facts.closingDate).day, dueRule: daysBetween(facts.closingDate, facts.dueDate) <= 90 ? { kind: "days-after-close" as const, days: daysBetween(facts.closingDate, facts.dueDate) } : entry.dueRule } : {}),
        } : entry), statements: [...workspace.statements, statement] }, bankConfirmed ? "Bank statement saved" : "Estimated statement saved");
        return statement;
      },
      saveReview(budget, statementId, expected, snapshot, input, verify, moves = []) {
        const workspace = read(budget);
        const statement = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(statement, expected);
        const card = workspace.cards.find((entry) => entry.id === statement!.cardId)!;
        if (snapshot.accountId !== card.accountId) throw new Error("Activity belongs to a different card");
        const parsed = input.map((entry) => membershipSchema.parse(entry));
        if (new Set(parsed.map((entry) => entry.transactionId)).size !== parsed.length) throw new Error("Duplicate transaction decisions");
        for (const entry of parsed) {
          const row = snapshot.rows.find((row) => row.id === entry.transactionId);
          if (entry.statementId !== statementId || entry.cardId !== card.id || !row || row.fingerprint !== entry.fingerprint) throw new Error("Activity changed. Review the new source before saving.");
          if (entry.provenance === "manual" && !entry.reason.trim()) throw new Error("Give a reason for your statement decision");
        }
        if (new Set(moves.map((move) => move.transactionId)).size !== moves.length) throw new Error("Choose one destination per transaction");
        for (const move of moves) {
          const target = workspace.statements.find((entry) => entry.id === move.targetStatementId);
          requireRevision(target, move.expectedTargetRevision);
          if (target!.id === statementId || target!.cardId !== card.id || !target!.bankConfirmed) throw new Error("Choose another confirmed statement for this card");
          const row = snapshot.rows.find((entry) => entry.id === move.transactionId);
          if (!row || !parsed.some((entry) => entry.transactionId === row.id && entry.fingerprint === row.fingerprint)) throw new Error("Review the transaction before moving it");
          if (membershipOwner(statement!, row.id, workspace)) throw new Error("Release the transaction from its owning statement first");
          if (!statementReview(target!, workspace, snapshot).coverage) throw new Error("Load the destination statement’s complete transaction history before moving");
        }
        let memberships = movedMemberships(statement!, workspace, snapshot, parsed, moves);
        let review = statementReview(statement!, workspace, snapshot, memberships);
        if (review.duplicate) throw new Error("A transaction cannot belong to two statements");
        if (verify && !review.canVerify) throw new Error("Confirm bank facts, resolve cutoff decisions and match the balance with continuous source coverage before verifying");
        if (verify) {
          // Freeze the actual bill, including automatic/tagged inclusions at close.
          // Later candidates can remain unbilled without changing this matched set.
          const frozen = review.memberships.filter((entry) => entry.decision !== "review").map((entry) => ({ ...entry, provenance: "manual" as const, reason: entry.reason || "Matched to the bank statement" }));
          const ids = new Set(frozen.map((entry) => entry.transactionId));
          memberships = [...memberships.filter((entry) => entry.statementId !== statementId || !ids.has(entry.transactionId)), ...frozen];
          review = statementReview(statement!, workspace, snapshot, memberships);
        }
        const updated = statementSchema.parse({ ...statement, revision: expected + 1,
          verification: verify ? "verified" : review.unresolved ? "needs-review" : "membership-reviewed",
          lifecycle: verify ? "finalized" : "recorded", reviewedSnapshot: review.signature,
          coverage: review.coverage ? "bounded" : "incomplete" });
        write(budget, { ...workspace, memberships, statements: workspace.statements.map((entry) => entry.id === statementId ? updated : moves.some((move) => move.targetStatementId === entry.id) ? { ...entry, revision: entry.revision + 1, verification: "needs-review" as const, lifecycle: "recorded" as const, reviewedSnapshot: null } : entry) }, moves.length ? "Decisions and statement moves saved; review destination statements" : verify ? "Statement verified" : "Statement decisions saved");
      },
      allocate(budget, cardId, expected, snapshot, transactionId, raw) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        requireRevision(card, expected);
        const row = snapshot.rows.find((entry) => entry.id === transactionId);
        if (snapshot.issues.length || snapshot.accountId !== card!.accountId || !row || paymentEvidence(row, snapshot, workspace) !== "confirmed") throw new Error("Only a confirmed card-side transfer can be allocated");
        const input = raw.map((entry) => allocationSchema.parse(entry));
        if (input.some((entry) => entry.cardId !== cardId || entry.transactionId !== transactionId || entry.fingerprint !== row.fingerprint || entry.provenance !== "manual" || !entry.reason)) throw new Error("Review the payment and give an allocation reason");
        const allocations = [...workspace.allocations.filter((entry) => !(entry.cardId === cardId && entry.transactionId === transactionId)), ...input];
        const candidate = { ...workspace, allocations };
        const ledger = repaymentLedger(card!, candidate, snapshot);
        if (ledger.issues.some((issue) => issue.includes(transactionId))) throw new Error("Allocation exceeds this payment or its eligible debt origins");
        if (input.length && sumMinor(input.map((entry) => entry.amountMinor)) > row.amountMinor) throw new Error("Allocation exceeds this payment");
        write(budget, { ...candidate, cards: workspace.cards.map((entry) => entry.id === cardId ? { ...entry, revision: expected + 1 } : entry) }, input.length ? "Payment allocation saved" : "Oldest-first allocation restored");
      },
      savePlan(budget, cardId, expected, snapshot, raw, rawLinks) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        requireRevision(card, expected);
        const input = repaymentPlanSchema.parse(raw);
        const existing = workspace.plans?.find((entry) => entry.id === input.id);
        if (existing) requireRevision(existing, input.revision);
        else if (input.revision !== 1) throw new Error("New plans must start at revision one");
        if (snapshot.issues.length || snapshot.accountId !== card!.accountId || input.cardId !== cardId) throw new Error("Refresh this card's Actual activity before saving");
        const sourceRefs = input.sourceTransactions ?? (input.transactionId && input.fingerprint ? [{ transactionId: input.transactionId, fingerprint: input.fingerprint }] : []);
        if (new Set(sourceRefs.map((source) => source.transactionId)).size !== sourceRefs.length) throw new Error("Choose each original transaction once");
        const sources = sourceRefs.map((source) => {
          const row = snapshot.rows.find((entry) => entry.id === source.transactionId);
          if (!row || row.fingerprint !== source.fingerprint || row.amountMinor >= 0 || financingCostKind(row, card!, workspace)) throw new Error("The original Actual charge changed; refresh and review it");
          if (workspace.plans?.some((plan) => plan.id !== input.id && (plan.transactionId === row.id || plan.sourceTransactions?.some((entry) => entry.transactionId === row.id))) || workspace.planLinks?.some((link) => link.planId !== input.id && link.transactionId === row.id)) throw new Error("This transaction already belongs to another plan");
          return row;
        });
        const opening = input.tracking?.opening ?? input.opening;
        if (input.sourceMode === "existing" || input.sourceMode === undefined && opening) {
          if (!opening) throw new Error("Enter the remaining principal and tracking start date");
        } else {
          if (!sources.length && !input.reference?.trim()) throw new Error("Choose original transactions or enter a balance/cash/transfer reference");
          if (sources.length && (input.amountMinor > sumMinor(sources.map((row) => -row.amountMinor)) || sources.some((row) => row.date > input.startDate))) throw new Error("Plan amount/date must fit the original charges");
        }
        if (opening && (opening.date > snapshot.to || opening.date < input.startDate || opening.principalMinor > input.amountMinor)) throw new Error("Opening principal must be within the plan amount and dated between plan start and today");
        if (input.tracking) {
          const account = snapshot.accounts?.find((entry) => entry.id === input.tracking!.accountId);
          if (!account?.offBudget || account.closed) throw new Error("Choose an available off-budget tracking account");
          if (input.tracking.tag && workspace.plans?.some((entry) => entry.id !== input.id && entry.tracking?.accountId === input.tracking!.accountId && entry.tracking.tag === input.tracking!.tag)) throw new Error("Each optional plan hashtag must be unique within its tracking account");
        }
        const links = rawLinks.map((entry) => planLinkSchema.parse(entry));
        if (new Set(links.map((entry) => entry.transactionId)).size !== links.length) throw new Error("Each Actual posting may be linked once");
        const index = trackingRowIndex(snapshot);
        const pairedIds = new Set<string>();
        for (const link of links) {
          const posting = index.get(link.transactionId);
          const trackerEntry = posting?.accountId === input.tracking?.accountId;
          if (posting && (pairedIds.has(posting.id) || posting.transferId && pairedIds.has(posting.transferId))) throw new Error("Link only one side of each principal transfer");
          if (posting) pairedIds.add(posting.id);
          if (link.planId !== input.id || !posting || posting.fingerprint !== link.fingerprint || (!trackerEntry && posting.accountId !== card!.accountId) || sources.some((row) => row.id === posting.id) || posting.date < input.startDate) throw new Error("Review the linked posting: source, date or account is invalid");
          const cost = financingCostKind(posting, card!, { ...workspace, planLinks: links });
          if (cost && (posting.transferId || trackerEntry || ["instalment-billed", "combined-instalment", "principal-release"].includes(link.role))) throw new Error("Financing costs must be separate expenses; only principal transfers may reduce the plan account");
          if (trackerEntry && link.role !== "adjustment") throw new Error("A plan-account entry is linked as an adjustment; link the card side for billed instalments");
          if (posting.transferId && !trackingTransferMatches(posting, input, snapshot)) throw new Error("Review this transfer's configured plan account and reciprocal link");
          if ((["conversion-credit", "refund"].includes(link.role) && posting.amountMinor <= 0) || (["instalment-billed", "combined-instalment", "principal-release"].includes(link.role) && posting.amountMinor >= 0)) throw new Error("Posting role must match its amount direction");
          if (["instalment-billed", "combined-instalment"].includes(link.role) && link.instalment !== null && link.instalment > input.months) throw new Error("Choose a valid instalment number");
          if (!["instalment-billed", "combined-instalment"].includes(link.role) && link.instalment !== null) throw new Error("Only billed instalments have an instalment number");
          if (workspace.planLinks?.some((other) => other.planId !== input.id && (other.transactionId === posting.id || other.transactionId === posting.transferId)) || workspace.plans?.some((plan) => plan.id !== input.id && (plan.transactionId === posting.id || plan.sourceTransactions?.some((source) => source.transactionId === posting.id)))) throw new Error("This Actual entry belongs to another plan");
        }
        if (existing?.tracking) {
          const previous = trackingBalance(existing, snapshot, snapshot.to, workspace.planLinks);
          const changedAccount = existing.tracking.accountId !== input.tracking?.accountId;
          const losesAssignment = (snapshot.trackingAccounts?.find((account) => account.accountId === existing.tracking!.accountId)?.rows ?? []).some((row) => row.date <= snapshot.to && (!existing.tracking!.opening || row.date > existing.tracking!.opening.date) && planOwnsTrackingRow(existing, row, snapshot, workspace.planLinks) && !planOwnsTrackingRow(input, row, snapshot, links));
          if ((!previous || previous.signedMinor < 0) && (changedAccount || losesAssignment)) throw new Error("Move or reassign remaining plan principal before removing its account or entry assignments");
        }
        const billed = links.filter((link) => ["instalment-billed", "combined-instalment"].includes(link.role));
        if (input.refundReview) {
          const signature = refundEvidenceSignature(links);
          if (input.refundReview.signature !== signature) throw new Error("Review the current refund evidence before confirming treatment");
          if (input.refundReview.treatment === "cancelled" && input.status !== "cancelled") throw new Error("Confirm the cancelled plan status");
          const remaining = input.refundReview.remaining;
          const unbilled = Array.from({ length: input.months }, (_, index) => index + 1).filter((index) => !billed.some((link) => link.instalment === index));
          if (input.refundReview.treatment === "revised") {
            const schedule = planSchedule(input, card!, links);
            if (!planProjection(input, card!).calculated || schedule.some((entry, index) => index > 0 && entry.date <= schedule[index - 1].date)) throw new Error("Revised dates must follow the billed schedule; use supported plan terms");
          }
          if (input.refundReview.treatment === "revised" && (remaining.length !== unbilled.length || new Set(remaining.map((entry) => entry.index)).size !== remaining.length || remaining.some((entry) => !unbilled.includes(entry.index) || entry.date <= input.startDate) || [...remaining].sort((a, b) => a.index - b.index).some((entry, index, rows) => index > 0 && entry.date <= rows[index - 1].date))) throw new Error("Enter a dated total for every unbilled instalment; billed history cannot be revised");
        }
        const saved = { ...input, revision: existing ? existing.revision + 1 : 1 };
        write(budget, { ...workspace, plans: [...(workspace.plans ?? []).filter((entry) => entry.id !== saved.id), saved], planLinks: [...(workspace.planLinks ?? []).filter((entry) => entry.planId !== saved.id), ...links], cards: workspace.cards.map((entry) => entry.id === cardId ? { ...entry, revision: expected + 1 } : entry) }, "Repayment plan saved");
      },
      classify(budget, cardId, expected, snapshot, raw) { get().classifyMany(budget, cardId, expected, snapshot, [raw]); },
      classifyMany(budget, cardId, expected, snapshot, raw) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        requireRevision(card, expected);
        if (!raw.length) throw new Error("Select transactions to classify");
        const inputs = raw.map((entry) => checkedClassification(card!, cardId, workspace, snapshot, entry));
        const ids = new Set(inputs.map((entry) => entry.transactionId));
        if (ids.size !== inputs.length) throw new Error("Each transaction may be classified once");
        write(budget, { ...workspace, classifications: [...workspace.classifications.filter((entry) => entry.cardId !== cardId || !ids.has(entry.transactionId)), ...inputs], cards: workspace.cards.map((entry) => entry.id === cardId ? { ...entry, revision: expected + 1 } : entry) }, inputs.length === 1 ? "Activity classification saved" : `${inputs.length} transactions classified`);
      },
      deletePlan(budget, planId, expectedPlan, expectedCard, snapshot) {
        const workspace = read(budget);
        const plan = workspace.plans?.find((entry) => entry.id === planId);
        requireRevision(plan, expectedPlan);
        const card = workspace.cards.find((entry) => entry.id === plan!.cardId);
        requireRevision(card, expectedCard);
        if (plan!.tracking) {
          const remaining = snapshot && trackingBalance(plan!, snapshot, snapshot.to, workspace.planLinks);
          if (!remaining || remaining.signedMinor < 0) throw new Error("Move or reassign the remaining plan principal before removing this plan");
        }
        write(budget, { ...workspace, plans: workspace.plans?.filter((entry) => entry.id !== planId), planLinks: workspace.planLinks?.filter((entry) => entry.planId !== planId), cards: workspace.cards.map((entry) => entry.id === card!.id ? { ...entry, revision: expectedCard + 1 } : entry) }, "Plan metadata removed; Actual transactions unchanged");
      },
      register(raw) {
        const input = cardInputSchema.parse(raw);
        const workspace = read(input.budgetSyncId);
        if (workspace.cards.some((card) => card.accountId === input.accountId)) throw new Error("This account is already registered");
        const card = cardSchema.parse({ ...input, id: generateId(), revision: 1 });
        write(input.budgetSyncId, { ...workspace, cards: [...workspace.cards, card] });
        return card;
      },
      deleteCard(budget, cardId, expected) {
        const workspace = read(budget);
        requireRevision(workspace.cards.find((card) => card.id === cardId), expected);
        const planIds = new Set((workspace.plans ?? []).filter((plan) => plan.cardId === cardId).map((plan) => plan.id));
        write(budget, {
          ...workspace,
          cards: workspace.cards.filter((entry) => entry.id !== cardId),
          statements: workspace.statements.filter((entry) => entry.cardId !== cardId),
          memberships: workspace.memberships.filter((entry) => entry.cardId !== cardId),
          allocations: workspace.allocations.filter((entry) => entry.cardId !== cardId),
          classifications: workspace.classifications.filter((entry) => entry.cardId !== cardId),
          plans: workspace.plans?.filter((entry) => entry.cardId !== cardId),
          planLinks: workspace.planLinks?.filter((entry) => !planIds.has(entry.planId)),
        }, "Card deleted; Actual account and transactions unchanged");
      },
      updateCard(budget, cardId, expected, raw) {
        const workspace = read(budget);
        const current = workspace.cards.find((card) => card.id === cardId);
        requireRevision(current, expected);
        const input = cardInputSchema.parse(raw);
        if (input.budgetSyncId !== budget || input.accountId !== current!.accountId) throw new Error("A registered card cannot move to another budget or account");
        const saved = workspace.statements.filter((entry) => entry.cardId === cardId);
        const firstTrackedStatementDate = input.firstTrackedStatementDate ?? current!.firstTrackedStatementDate ?? saved.find((entry) => entry.openingAnchor)?.closingDate ?? null;
        if (firstTrackedStatementDate && saved.some((entry) => entry.closingDate < firstTrackedStatementDate)) throw new Error("Delete earlier saved statements before moving the tracking start forward.");
        const boundaryChanged = firstTrackedStatementDate !== current!.firstTrackedStatementDate;
        const updated = cardSchema.parse({ ...input, firstTrackedStatementDate, id: cardId, revision: expected + 1 });
        write(budget, { ...workspace, cards: workspace.cards.map((card) => card.id === cardId ? updated : card),
          statements: boundaryChanged ? workspace.statements.map((entry) => entry.cardId === cardId ? { ...entry, openingAnchor: entry.bankConfirmed && entry.closingDate === firstTrackedStatementDate, revision: entry.revision + 1, verification: "needs-review" as const, lifecycle: "recorded" as const, reviewedSnapshot: null } : entry) : workspace.statements,
          allocations: boundaryChanged ? workspace.allocations.filter((entry) => entry.cardId !== cardId) : workspace.allocations,
        });
      },
      recordOpeningStatement(budget, cardId, expected, raw) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        requireRevision(card, expected);
        const facts = statementFactsSchema.parse(raw);
        if (workspace.statements.some((entry) => entry.cardId === cardId)) throw new Error("An opening statement is already recorded for this card");
        if (card!.firstTrackedStatementDate && facts.closingDate !== card!.firstTrackedStatementDate) throw new Error("Record the configured first tracked statement as the opening anchor.");
        const statement = statementSchema.parse({ ...facts, id: generateId(), cardId, revision: 1, lifecycle: "recorded", verification: "recorded", coverage: "unknown", openingAnchor: true });
        write(budget, { ...workspace, cards: workspace.cards.map((entry) => entry.id === cardId ? { ...entry, revision: expected + 1, firstTrackedStatementDate: facts.closingDate } : entry), statements: [...workspace.statements, statement] });
        return statement;
      },
      resetReview(budget, statementId, expected) {
        const workspace = read(budget);
        const statement = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(statement, expected);
        const released = new Set(workspace.memberships.filter((entry) => entry.statementId === statementId).map((entry) => entry.transactionId));
        write(budget, { ...workspace,
          memberships: workspace.memberships.filter((entry) => entry.statementId !== statementId),
          statements: workspace.statements.map((entry) => entry.cardId === statement!.cardId && (entry.closingDate >= statement!.closingDate || workspace.memberships.some((decision) => decision.statementId === entry.id && released.has(decision.transactionId))) ? { ...entry, revision: entry.revision + 1, verification: "needs-review" as const, lifecycle: "recorded" as const, reviewedSnapshot: null, coverage: "unknown" as const } : entry),
          cards: workspace.cards.map((entry) => entry.id === statement!.cardId ? { ...entry, revision: entry.revision + 1 } : entry),
        }, "Transaction review reset; bank values retained");
      },
      deleteStatement(budget, statementId, expected) {
        const workspace = read(budget);
        const statement = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(statement, expected);
        const released = new Set(workspace.memberships.filter((entry) => entry.statementId === statementId).map((entry) => entry.transactionId));
        write(budget, { ...workspace,
          statements: workspace.statements.filter((entry) => entry.id !== statementId).map((entry) => entry.cardId === statement!.cardId && (entry.closingDate > statement!.closingDate || workspace.memberships.some((decision) => decision.statementId === entry.id && released.has(decision.transactionId))) ? { ...entry, revision: entry.revision + 1, verification: "needs-review" as const, lifecycle: "recorded" as const, reviewedSnapshot: null } : entry),
          memberships: workspace.memberships.filter((entry) => entry.statementId !== statementId),
          allocations: workspace.allocations.filter((entry) => entry.originId !== statementId),
          cards: workspace.cards.map((entry) => entry.id === statement!.cardId ? { ...entry, revision: entry.revision + 1 } : entry),
        }, "Saved statement deleted; Actual transactions unchanged");
      },
      correctStatement(budget, statementId, expected, raw) {
        const workspace = read(budget);
        const current = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(current, expected);
        const facts = statementFactsSchema.parse(raw);
        if (workspace.statements.some((entry) => entry.cardId === current!.cardId && entry.id !== statementId && entry.closingDate === facts.closingDate)) throw new Error("Another statement already uses this closing date");
        if (workspace.statements.some((entry) => entry.cardId === current!.cardId && entry.id !== statementId && !(entry.closingDate < facts.periodStart || entry.periodStart > facts.closingDate))) throw new Error("Statement periods must not overlap");
        const card = workspace.cards.find((entry) => entry.id === current!.cardId)!;
        if (current!.openingAnchor && workspace.statements.some((entry) => entry.cardId === current!.cardId && entry.id !== statementId && entry.closingDate < facts.closingDate)) throw new Error("Delete earlier saved statements before moving the opening date forward.");
        if (!current!.openingAnchor && card.firstTrackedStatementDate && facts.closingDate < card.firstTrackedStatementDate) throw new Error("This statement is before the first tracked statement");
        const updated = statementSchema.parse({ ...current, ...facts, totalPaymentDueMinor: facts.totalPaymentDueMinor, revision: expected + 1, verification: "needs-review", lifecycle: "recorded", bankConfirmed: true, reviewedSnapshot: null, openingAnchor: current!.openingAnchor || facts.closingDate === card.firstTrackedStatementDate });
        write(budget, { ...workspace, cards: workspace.cards.map((entry) => entry.id === card.id ? { ...entry, revision: entry.revision + 1, firstTrackedStatementDate: current!.openingAnchor ? facts.closingDate : entry.firstTrackedStatementDate } : entry), statements: workspace.statements.map((entry) => entry.id === statementId ? updated : entry.cardId === current!.cardId && entry.closingDate > current!.closingDate ? { ...entry, revision: entry.revision + 1, verification: "needs-review" as const, lifecycle: "recorded" as const, reviewedSnapshot: null } : entry) });
      },
    };
  });
}

// Shared across client route navigation, but discarded when this tab reloads.
export const creditCardStore = createCreditCardStore();
