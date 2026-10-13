import { createStore } from "zustand/vanilla";
import { parseIsoDate, daysBetween } from "@/lib/financial-models/calendar/dates";
import { generateId } from "@/lib/uuid";
import { membershipSchema, allocationSchema, activityClassificationSchema, cardInputSchema, cardSchema, statementFactsSchema, statementSchema, type Card, type Statement, type OpeningPosition, type Membership, type Workspace } from "./models";

import type { ActivitySnapshot } from "./activity";
import { paymentEvidence } from "./activity";
import { statementReview, sumMinor, membershipOwner, movedMemberships, type StatementMove } from "./statements";
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
  classify: (budget: string, cardId: string, expectedRevision: number, snapshot: ActivitySnapshot, input: unknown) => void;
  register: (input: unknown) => Card;
  updateCard: (budget: string, cardId: string, expectedRevision: number, input: unknown) => void;
  recordOpeningStatement: (budget: string, cardId: string, expectedRevision: number, input: unknown) => Statement;
  correctStatement: (budget: string, statementId: string, expectedRevision: number, input: unknown, reason: string) => void;
};
export const EMPTY_WORKSPACE: Workspace = { cards: [], statements: [], corrections: [], memberships: [], allocations: [], classifications: [] };

export function openingPosition(workspace: Workspace, cardId: string): OpeningPosition | null {
  const anchor = workspace.statements.find((s) => s.cardId === cardId && s.openingAnchor);
  return anchor ? { cardId, statementId: anchor.id, date: anchor.closingDate, balanceMinor: anchor.officialBalanceMinor } : null;
}

function requireRevision(record: { revision: number } | undefined, expected: number) {
  if (!record) throw new Error("This record is no longer available in the active budget");
  if (record.revision !== expected) throw new Error("This record changed. Reopen the editor to review the latest values; your draft has not been saved.");
  if (!Number.isSafeInteger(expected + 1)) throw new Error("Record revision exceeds the supported range");
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
        const memberships = movedMemberships(statement!, workspace, snapshot, parsed, moves);
        const review = statementReview(statement!, workspace, snapshot, memberships);
        if (review.duplicate) throw new Error("A transaction cannot belong to two statements");
        if (verify && !review.canVerify) throw new Error("Confirm bank facts, resolve cutoff decisions and match the balance with continuous source coverage before verifying");
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
        if (snapshot.issues.length || snapshot.accountId !== card!.accountId || !row || paymentEvidence(row, snapshot) !== "confirmed") throw new Error("Only a confirmed card-side transfer can be allocated");
        const input = raw.map((entry) => allocationSchema.parse(entry));
        if (input.some((entry) => entry.cardId !== cardId || entry.transactionId !== transactionId || entry.fingerprint !== row.fingerprint || entry.provenance !== "manual" || !entry.reason)) throw new Error("Review the payment and give an allocation reason");
        const allocations = [...workspace.allocations.filter((entry) => !(entry.cardId === cardId && entry.transactionId === transactionId)), ...input];
        const candidate = { ...workspace, allocations };
        const ledger = repaymentLedger(card!, candidate, snapshot);
        if (ledger.issues.some((issue) => issue.includes(transactionId))) throw new Error("Allocation exceeds this payment or its eligible debt origins");
        if (input.length && sumMinor(input.map((entry) => entry.amountMinor)) > row.amountMinor) throw new Error("Allocation exceeds this payment");
        write(budget, { ...candidate, cards: workspace.cards.map((entry) => entry.id === cardId ? { ...entry, revision: expected + 1 } : entry) }, input.length ? "Payment allocation saved" : "Oldest-first allocation restored");
      },
      classify(budget, cardId, expected, snapshot, raw) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        requireRevision(card, expected);
        const input = activityClassificationSchema.parse(raw);
        const row = snapshot.rows.find((entry) => entry.id === input.transactionId);
        if (input.cardId !== cardId || snapshot.accountId !== card!.accountId || !row || row.fingerprint !== input.fingerprint || (row.transferId && (row.amountMinor >= 0 || !["cash-advance", "other"].includes(input.kind)))) throw new Error("This activity changed or is a transfer; refresh and review it");
        if ((input.kind === "refund" && row.amountMinor <= 0) || (["purchase", "cash-advance", "interest", "fee"].includes(input.kind) && row.amountMinor >= 0)) throw new Error("Classification must match the transaction amount direction");
        write(budget, { ...workspace,
          classifications: [...workspace.classifications.filter((entry) => !(entry.cardId === cardId && entry.transactionId === row.id)), input],
          cards: workspace.cards.map((entry) => entry.id === cardId ? { ...entry, revision: expected + 1 } : entry),
        }, "Activity classification saved");
      },
      register(raw) {
        const input = cardInputSchema.parse(raw);
        const workspace = read(input.budgetSyncId);
        if (workspace.cards.some((card) => card.accountId === input.accountId)) throw new Error("This account is already registered");
        const card = cardSchema.parse({ ...input, id: generateId(), revision: 1 });
        write(input.budgetSyncId, { ...workspace, cards: [...workspace.cards, card] });
        return card;
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
          corrections: workspace.corrections.filter((entry) => entry.statementId !== statementId),
          allocations: workspace.allocations.filter((entry) => entry.originId !== statementId),
          cards: workspace.cards.map((entry) => entry.id === statement!.cardId ? { ...entry, revision: entry.revision + 1 } : entry),
        }, "Saved statement deleted; Actual transactions unchanged");
      },
      correctStatement(budget, statementId, expected, raw, reason) {
        const workspace = read(budget);
        const current = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(current, expected);
        if (!reason.trim() || reason.trim().length > 500) throw new Error("Give a correction reason of 1–500 characters");
        const facts = statementFactsSchema.parse(raw);
        if (workspace.statements.some((entry) => entry.cardId === current!.cardId && entry.id !== statementId && entry.closingDate === facts.closingDate)) throw new Error("Another statement already uses this closing date");
        if (workspace.statements.some((entry) => entry.cardId === current!.cardId && entry.id !== statementId && !(entry.closingDate < facts.periodStart || entry.periodStart > facts.closingDate))) throw new Error("Statement periods must not overlap");
        const card = workspace.cards.find((entry) => entry.id === current!.cardId)!;
        if (current!.openingAnchor && workspace.statements.some((entry) => entry.cardId === current!.cardId && entry.id !== statementId && entry.closingDate < facts.closingDate)) throw new Error("Delete earlier saved statements before moving the opening date forward.");
        if (!current!.openingAnchor && card.firstTrackedStatementDate && facts.closingDate < card.firstTrackedStatementDate) throw new Error("This statement is before the first tracked statement");
        const updated = statementSchema.parse({ ...current, ...facts, revision: expected + 1, verification: "needs-review", lifecycle: "recorded", bankConfirmed: true, reviewedSnapshot: null, openingAnchor: current!.openingAnchor || facts.closingDate === card.firstTrackedStatementDate });
        write(budget, { ...workspace, cards: workspace.cards.map((entry) => entry.id === card.id ? { ...entry, revision: entry.revision + 1, firstTrackedStatementDate: current!.openingAnchor ? facts.closingDate : entry.firstTrackedStatementDate } : entry), statements: workspace.statements.map((entry) => entry.id === statementId ? updated : entry.cardId === current!.cardId && entry.closingDate > current!.closingDate ? { ...entry, revision: entry.revision + 1, verification: "needs-review" as const, lifecycle: "recorded" as const, reviewedSnapshot: null } : entry), corrections: [...workspace.corrections, { id: generateId(), statementId, before: current!, after: updated, reason: reason.trim(), recordedAt: new Date().toISOString() }] });
      },
    };
  });
}

// Shared across client route navigation, but discarded when this tab reloads.
export const creditCardStore = createCreditCardStore();
