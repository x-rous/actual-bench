import { createStore } from "zustand/vanilla";
import { generateId } from "@/lib/uuid";
import type { ActivityRow, ActivitySnapshot } from "../activity";
import { billingDaysFrom, trackingStart } from "../cycles";
import { formatCardDate } from "../displayDates";
import { PLAN_ELIGIBLE_KINDS } from "../derive/families";
import { currentPlanEntry } from "../derive/indexes";
import { isPlanAccountTransfer, planAccountIds, rowIndex } from "../derive/planAccounts";
import { activityKind } from "../derive/types";
import {
  cardInputSchema,
  cardSchema,
  limitChangeSchema,
  decisionSchema,
  EMPTY_WORKSPACE,
  planEntrySchema,
  planSchema,
  statementFactsSchema,
  statementSchema,
  TRANSACTION_TYPES,
  type Card,
  type Decision,
  type PlanEntry,
  type RepaymentPlan,
  type Statement,
  type TransactionType,
  type Workspace,
} from "../models";
import {
  CreditCardConflictError,
  diffWorkspaces,
  inverseChanges,
  isEmptyChangeSet,
  type ChangeSet,
} from "@/lib/credit-cards/changes";
import { httpPersistence, memoryPersistence, type CreditCardPersistence } from "./persistence";
import { draftDecisions, statementReview, sumMinor, type StatementMove } from "../statements";
import { bankMatchFor } from "../derive/status";

/** One answer from statement review; "review" (undecided) is not stored. */
export type ReviewAnswer = {
  transactionId: string;
  decision: "included" | "excluded" | "review";
  bankPostingDate: string | null;
  note: string | null;
};

/** A type change: a kind sets the user's correction; null returns the row to its suggestion (FR-3). */
export type TypeChange = { transactionId: string; kind: TransactionType | null; note?: string | null };

/** Loading state of one budget's metadata. `unavailable` is never shown as an empty workspace. */
export type StorageStatus = { state: "loading" | "ready" | "unavailable"; error?: string };

/** One committed command and the change set that undoes it, guarded against what it wrote. */
type UndoEntry = { changes: ChangeSet };

export type CreditCardState = {
  workspaces: Readonly<Record<string, Workspace>>;
  status: Readonly<Record<string, StorageStatus>>;
  notices: Readonly<Record<string, string>>;
  /** Command-scoped Undo, kept for this session only (never persisted). */
  undoHistory: Readonly<Record<string, readonly UndoEntry[]>>;
  persistence: CreditCardPersistence;
  /** Reads the budget's metadata once; `force` re-reads (Retry, or after a conflict). */
  load: (budget: string, force?: boolean) => Promise<void>;
  undo: (budget: string) => Promise<void>;
  registerCard: (input: unknown) => Promise<Card>;
  /** `limitChanges` (effective date and limit) replaces the card's limit history when given; otherwise it is kept. */
  updateCard: (budget: string, cardId: string, expectedRevision: number, input: unknown,
    limitChanges?: { effectiveDate: string; limitMinor: number }[]) => Promise<void>;
  deleteCard: (budget: string, cardId: string, expectedRevision: number) => Promise<void>;
  recordStatement: (budget: string, cardId: string, input: unknown) => Promise<Statement>;
  correctStatement: (budget: string, statementId: string, expectedRevision: number, input: unknown) => Promise<void>;
  deleteStatement: (budget: string, statementId: string, expectedRevision: number) => Promise<void>;
  resetReview: (budget: string, statementId: string, expectedRevision: number) => Promise<void>;
  /** Decisions, moves and the review's staged type changes, saved as one change (D29). */
  saveReview: (
    budget: string, statementId: string, expectedRevision: number, snapshot: ActivitySnapshot, answers: ReviewAnswer[],
    moves?: StatementMove[], types?: TypeChange[],
  ) => Promise<void>;
  setTypes: (budget: string, cardId: string, snapshot: ActivitySnapshot, changes: TypeChange[]) => Promise<void>;
  savePlan: (budget: string, expectedRevision: number | null, snapshot: ActivitySnapshot, plan: unknown, entries: unknown[]) => Promise<void>;
  deletePlan: (budget: string, planId: string, expectedRevision: number) => Promise<void>;
  setPlanAccounts: (budget: string, accountIds: string[]) => Promise<void>;
};

export { EMPTY_WORKSPACE };

function requireRevision(record: { revision: number } | undefined, expected: number): asserts record {
  if (!record) throw new Error("This record is no longer available in the active budget");
  if (record.revision !== expected) {
    throw new Error("This record changed. Reopen it to review the latest values; your draft has not been saved.");
  }
  if (!Number.isSafeInteger(expected + 1)) throw new Error("Record revision exceeds the supported range");
}

const bump = <T extends { revision: number }>(record: T): T => ({ ...record, revision: record.revision + 1 });

function overlaps(statements: readonly Statement[], cardId: string, periodStart: string, closingDate: string, except?: string) {
  return statements.some((entry) => entry.cardId === cardId && entry.id !== except
    && !(entry.closingDate < periodStart || entry.periodStart > closingDate));
}

function freshRow(snapshot: ActivitySnapshot, transactionId: string) {
  const row = snapshot.rows.find((entry) => entry.id === transactionId);
  if (!row) throw new Error("This activity changed; refresh and review it");
  return row;
}

/** A type the user may choose for a row; structure (plan accounts) is never overridden. */
function checkType(row: ActivityRow, kind: TransactionType, card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  if (!TRANSACTION_TYPES.includes(kind)) throw new Error("Choose a supported type");
  if (isPlanAccountTransfer(row, snapshot, workspace) || currentPlanEntry(workspace, row)?.role === "instalment") {
    throw new Error("Plan transfers are typed by the plan; change the plan instead");
  }
  if ((kind === "refund" || kind === "cashback") && row.amountMinor <= 0) throw new Error("Refunds and cashback are credits");
  const original = workspace.planEntries.some((entry) => entry.transactionId === row.id && entry.role === "original"
    && workspace.plans.some((plan) => plan.id === entry.planId && plan.status === "active"));
  if (original && !PLAN_ELIGIBLE_KINDS.includes(kind)) {
    throw new Error("Close or change the plan before changing its original purchase type");
  }
}

/** The card's type corrections after `changes` (null reverts to the suggestion); validates each. */
function typedCorrections(workspace: Workspace, card: Card, snapshot: ActivitySnapshot, changes: TypeChange[]) {
  if (new Set(changes.map((change) => change.transactionId)).size !== changes.length) throw new Error("Change each transaction once");
  const ids = new Set(changes.map((change) => change.transactionId));
  const corrections = changes.flatMap((change) => {
    const row = freshRow(snapshot, change.transactionId);
    if (change.kind === null) return [];
    checkType(row, change.kind, card, workspace, snapshot);
    return [{
      cardId: card.id, transactionId: row.id, kind: change.kind, identityHash: row.identity,
      sourceHash: row.fingerprint, note: change.note?.trim() || null,
    }];
  });
  return [...workspace.typeCorrections.filter((entry) => entry.cardId !== card.id || !ids.has(entry.transactionId)), ...corrections];
}

const isPromise = <T,>(value: T | Promise<T>): value is Promise<T> => typeof (value as Promise<T>)?.then === "function";

/** Runs `next` on `value` now when it is synchronous, else when it resolves. Always returns a promise. */
function then<T, R>(value: T | Promise<T>, next: (result: T) => R): Promise<R> {
  if (isPromise(value)) return value.then(next);
  try {
    return Promise.resolve(next(value));
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * The credit-card commands for each budget. Every command validates and computes the next workspace
 * first (validation errors throw at once), then commits the difference as one guarded change set and
 * applies what was committed. Nothing is written to Actual.
 */
export function createCreditCardStore(persistence: CreditCardPersistence = memoryPersistence()) {
  return createStore<CreditCardState>((set, get) => {
    const read = (budget: string) => get().workspaces[budget] ?? EMPTY_WORKSPACE;
    const notify = (budget: string, notice: string) => set((state) => ({ notices: { ...state.notices, [budget]: notice } }));
    const settle = (budget: string, workspace: Workspace) => set((state) => ({
      workspaces: { ...state.workspaces, [budget]: workspace },
      status: { ...state.status, [budget]: { state: "ready" } },
    }));

    /** Commits `after` (computed from the current workspace) and records how to undo it. */
    const write = (budget: string, after: Workspace, notice = "Changes saved"): Promise<void> => {
      const before = read(budget);
      const changes = diffWorkspaces(before, after);
      if (isEmptyChangeSet(changes)) return Promise.resolve();
      const undo = inverseChanges(before, after);
      return then(commit(budget, changes), (committed) => {
        set((state) => ({
          workspaces: { ...state.workspaces, [budget]: committed },
          status: { ...state.status, [budget]: { state: "ready" } },
          undoHistory: { ...state.undoHistory, [budget]: [...(state.undoHistory[budget] ?? []).slice(-19), { changes: undo }] },
          notices: { ...state.notices, [budget]: notice },
        }));
      });
    };

    /** A conflict means another tab or device changed the data: reload it, keep the caller's draft. */
    const commit = (budget: string, changes: ChangeSet): Workspace | Promise<Workspace> => {
      let result: Workspace | Promise<Workspace>;
      try {
        result = get().persistence.commit(budget, changes);
      } catch (error) {
        return recover(budget, error);
      }
      return isPromise(result) ? result.catch((error) => recover(budget, error)) : result;
    };
    const recover = (budget: string, error: unknown): Promise<never> => {
      if (error instanceof CreditCardConflictError) {
        return get().load(budget, true).then(() => Promise.reject(error), () => Promise.reject(error));
      }
      return Promise.reject(error);
    };

    return {
      workspaces: {},
      status: {},
      notices: {},
      undoHistory: {},
      persistence,

      load(budget, force = false) {
        const current = get().status[budget]?.state;
        if (!force && (current === "ready" || current === "loading")) return Promise.resolve();
        set((state) => ({ status: { ...state.status, [budget]: { state: current === "ready" ? "ready" : "loading" } } }));
        let result: Workspace | Promise<Workspace>;
        try {
          result = get().persistence.read(budget);
        } catch (error) {
          result = Promise.reject(error);
        }
        return then(result, (workspace) => settle(budget, workspace)).catch((error: unknown) => {
          set((state) => ({
            status: {
              ...state.status,
              [budget]: { state: "unavailable", error: error instanceof Error ? error.message : "Credit-card data unavailable" },
            },
          }));
        });
      },

      undo(budget) {
        const history = get().undoHistory[budget] ?? [];
        const entry = history.at(-1);
        if (!entry) return Promise.resolve();
        set((state) => ({ undoHistory: { ...state.undoHistory, [budget]: history.slice(0, -1) } }));
        return then(commit(budget, entry.changes), (committed) => {
          settle(budget, committed);
          notify(budget, "Last change undone");
        }).catch((error: unknown) => {
          notify(budget, error instanceof CreditCardConflictError
            ? "Can't undo; this changed since. Your current records were kept."
            : "Undo failed; your current records were kept.");
        });
      },

      registerCard(raw) {
        const input = cardInputSchema.parse(raw);
        const workspace = read(input.budgetSyncId);
        if (workspace.cards.some((card) => card.accountId === input.accountId)) throw new Error("This account is already registered");
        const card = cardSchema.parse({ ...input, id: generateId(), revision: 1 });
        return write(input.budgetSyncId, { ...workspace, cards: [...workspace.cards, card] }, "Card added").then(() => card);
      },

      updateCard(budget, cardId, expected, raw, limits) {
        const workspace = read(budget);
        const current = workspace.cards.find((card) => card.id === cardId);
        requireRevision(current, expected);
        const input = cardInputSchema.parse(raw);
        if (input.budgetSyncId !== budget || input.accountId !== current.accountId) {
          throw new Error("A registered card cannot move to another budget or account");
        }
        const saved = workspace.statements.filter((entry) => entry.cardId === cardId);
        // CA-16: null clears the tracking start; the earliest saved statement then defines it.
        if (input.firstTrackedStatementDate && saved.some((entry) => entry.closingDate < input.firstTrackedStatementDate!)) {
          throw new Error("Delete earlier saved statements before moving the tracking start forward.");
        }
        const billingChanged = input.closingDay !== current.closingDay
          || JSON.stringify(input.dueRule) !== JSON.stringify(current.dueRule);
        const updated = cardSchema.parse({
          ...input,
          id: cardId,
          revision: expected + 1,
          billingDaysSource: billingChanged ? "user" : current.billingDaysSource,
        });
        const limitChanges = limits === undefined ? workspace.limitChanges : [
          ...workspace.limitChanges.filter((entry) => entry.cardId !== cardId),
          ...limits.map((entry) => limitChangeSchema.parse({ cardId, ...entry })),
        ];
        return write(budget, { ...workspace, cards: workspace.cards.map((card) => (card.id === cardId ? updated : card)), limitChanges },
          "Card settings saved");
      },

      deleteCard(budget, cardId, expected) {
        const workspace = read(budget);
        requireRevision(workspace.cards.find((card) => card.id === cardId), expected);
        const planIds = new Set(workspace.plans.filter((plan) => plan.cardId === cardId).map((plan) => plan.id));
        return write(budget, {
          ...workspace,
          cards: workspace.cards.filter((entry) => entry.id !== cardId),
          statements: workspace.statements.filter((entry) => entry.cardId !== cardId),
          decisions: workspace.decisions.filter((entry) => entry.cardId !== cardId),
          typeCorrections: workspace.typeCorrections.filter((entry) => entry.cardId !== cardId),
          plans: workspace.plans.filter((entry) => entry.cardId !== cardId),
          planEntries: workspace.planEntries.filter((entry) => !planIds.has(entry.planId)),
          limitChanges: workspace.limitChanges.filter((entry) => entry.cardId !== cardId),
        }, "Card deleted; Actual account and transactions unchanged");
      },

      recordStatement(budget, cardId, raw) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        if (!card) throw new Error("This card is no longer available in the active budget");
        const facts = statementFactsSchema.parse(raw);
        const saved = workspace.statements.filter((entry) => entry.cardId === cardId);
        if (saved.some((entry) => entry.closingDate === facts.closingDate)) throw new Error("A statement already uses this closing date");
        if (overlaps(workspace.statements, cardId, facts.periodStart, facts.closingDate)) {
          throw new Error("Statement periods must not overlap. Correct the existing statement instead.");
        }
        if (card.firstTrackedStatementDate && facts.closingDate < card.firstTrackedStatementDate) {
          throw new Error("This statement is before the first tracked statement. Change the tracking start in Settings first.");
        }
        const statement = statementSchema.parse({ ...facts, id: generateId(), cardId, revision: 1 });
        // D18: the first bank statement replaces default billing days, never ones the user set.
        const billing = card.billingDaysSource === "default" ? billingDaysFrom(facts) : null;
        const tracking = card.firstTrackedStatementDate ?? (saved.length ? null : facts.closingDate);
        const changed = billing || tracking !== card.firstTrackedStatementDate;
        const updated: Card = changed ? bump({
          ...card,
          ...(billing ? { ...billing, billingDaysSource: "statement" as const } : {}),
          firstTrackedStatementDate: tracking ?? card.firstTrackedStatementDate,
        }) : card;
        return write(budget, {
          ...workspace,
          cards: workspace.cards.map((entry) => (entry.id === cardId ? updated : entry)),
          statements: [...workspace.statements, statement],
        }, billing ? `Statement saved · billing days updated from your ${formatCardDate(facts.closingDate)} statement` : "Statement saved")
          .then(() => statement);
      },

      correctStatement(budget, statementId, expected, raw) {
        const workspace = read(budget);
        const current = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(current, expected);
        const facts = statementFactsSchema.parse(raw);
        const card = workspace.cards.find((entry) => entry.id === current.cardId)!;
        const others = workspace.statements.filter((entry) => entry.cardId === card.id && entry.id !== statementId);
        if (others.some((entry) => entry.closingDate === facts.closingDate)) throw new Error("Another statement already uses this closing date");
        if (overlaps(workspace.statements, card.id, facts.periodStart, facts.closingDate, statementId)) {
          throw new Error("Statement periods must not overlap");
        }
        const opening = current.closingDate === trackingStart(card, workspace.statements);
        if (opening && others.some((entry) => entry.closingDate < facts.closingDate)) {
          throw new Error("Delete earlier saved statements before moving the opening date forward.");
        }
        if (!opening && card.firstTrackedStatementDate && facts.closingDate < card.firstTrackedStatementDate) {
          throw new Error("This statement is before the first tracked statement");
        }
        const updated = statementSchema.parse({
          ...current, ...facts, revision: expected + 1,
          reviewState: "not_reviewed", reviewHash: null, reviewedAt: null, scopeAcceptedDifferenceMinor: null,
        });
        const moveStart = opening && card.firstTrackedStatementDate === current.closingDate;
        return write(budget, {
          ...workspace,
          cards: moveStart
            ? workspace.cards.map((entry) => (entry.id === card.id ? bump({ ...entry, firstTrackedStatementDate: facts.closingDate }) : entry))
            : workspace.cards,
          statements: workspace.statements.map((entry) => (entry.id === statementId ? updated : entry)),
        }, "Bank figures corrected");
      },

      deleteStatement(budget, statementId, expected) {
        const workspace = read(budget);
        const statement = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(statement, expected);
        return write(budget, {
          ...workspace,
          statements: workspace.statements.filter((entry) => entry.id !== statementId),
          decisions: workspace.decisions.filter((entry) => entry.statementId !== statementId),
        }, "Statement deleted; Actual transactions unchanged");
      },

      resetReview(budget, statementId, expected) {
        const workspace = read(budget);
        const statement = workspace.statements.find((entry) => entry.id === statementId);
        requireRevision(statement, expected);
        const reset = { ...statement, revision: expected + 1, reviewState: "not_reviewed" as const, reviewHash: null, reviewedAt: null };
        return write(budget, {
          ...workspace,
          decisions: workspace.decisions.filter((entry) => entry.statementId !== statementId),
          statements: workspace.statements.map((entry) => (entry.id === statementId ? reset : entry)),
        }, "Transaction review reset; bank figures kept");
      },

      saveReview(budget, statementId, expected, snapshot, answers, moves = [], types = []) {
        const saved = read(budget);
        const statement = saved.statements.find((entry) => entry.id === statementId);
        requireRevision(statement, expected);
        const card = saved.cards.find((entry) => entry.id === statement.cardId)!;
        if (snapshot.accountId !== card.accountId) throw new Error("Activity belongs to a different card");
        const workspace = types.length ? { ...saved, typeCorrections: typedCorrections(saved, card, snapshot, types) } : saved;
        if (new Set(answers.map((entry) => entry.transactionId)).size !== answers.length) throw new Error("Duplicate transaction decisions");
        const decided = answers.flatMap((answer): Decision[] => {
          const row = snapshot.rows.find((entry) => entry.id === answer.transactionId);
          if (!row) throw new Error("Activity changed. Review the new source before saving.");
          if (answer.decision === "review") return [];
          return [decisionSchema.parse({
            statementId,
            cardId: card.id,
            transactionId: row.id,
            decision: answer.decision,
            origin: "user",
            bankPostingDate: answer.bankPostingDate,
            sourceHash: row.fingerprint,
            note: answer.note,
          })];
        });
        if (new Set(moves.map((move) => move.transactionId)).size !== moves.length) throw new Error("Choose one destination per transaction");
        const targets = new Map<string, Statement>();
        for (const move of moves) {
          const target = workspace.statements.find((entry) => entry.id === move.targetStatementId);
          requireRevision(target, move.expectedTargetRevision);
          if (target.id === statementId || target.cardId !== card.id) throw new Error("Choose another statement for this card");
          if (!statementReview(target, workspace, snapshot).coverage) {
            throw new Error("Load the destination statement's complete transaction history before moving");
          }
          freshRow(snapshot, move.transactionId);
          targets.set(target.id, target);
        }
        let decisions = draftDecisions(statement, workspace, snapshot, decided, moves);
        let review = statementReview(statement, workspace, snapshot, decisions);
        if (review.duplicate) throw new Error("A transaction cannot belong to two statements");
        // D26: a complete review whose balance matches is verified automatically.
        const verified = bankMatchFor(statement, review).key === "matches" && review.varianceMinor !== null;
        if (verified) {
          // Freeze the bill, including suggested inclusions at close.
          const frozen = review.rows.flatMap((row, index): Decision[] => {
            const membership = review.memberships[index];
            if (membership.decision === "review" || membership.ownerId || membership.origin !== "suggested") return [];
            return [{
              statementId, cardId: card.id, transactionId: row.id, decision: membership.decision,
              origin: "verification", bankPostingDate: null, sourceHash: row.fingerprint, note: null,
            }];
          });
          const ids = new Set(frozen.map((entry) => entry.transactionId));
          decisions = [...decisions.filter((entry) => entry.statementId !== statementId || !ids.has(entry.transactionId)), ...frozen];
          review = statementReview(statement, workspace, snapshot, decisions);
        }
        const updated: Statement = {
          ...statement,
          revision: expected + 1,
          reviewState: verified ? "verified" : "reviewed",
          reviewHash: review.signature,
          reviewedAt: new Date().toISOString(),
        };
        return write(budget, {
          ...workspace,
          decisions,
          statements: workspace.statements.map((entry) => {
            if (entry.id === statementId) return updated;
            if (targets.has(entry.id)) return { ...bump(entry), reviewState: "not_reviewed" as const, reviewHash: null, reviewedAt: null };
            return entry;
          }),
        }, moves.length ? "Decisions and moves saved; review the destination statements"
          : verified ? "Statement matches the bank" : "Statement decisions saved");
      },

      setTypes(budget, cardId, snapshot, changes) {
        const workspace = read(budget);
        const card = workspace.cards.find((entry) => entry.id === cardId);
        if (!card) throw new Error("This card is no longer available in the active budget");
        if (snapshot.accountId !== card.accountId) throw new Error("Activity belongs to a different card");
        if (!changes.length) throw new Error("Select transactions to change");
        const corrections = typedCorrections(workspace, card, snapshot, changes);
        const set = changes.filter((change) => change.kind !== null).length;
        return write(budget, { ...workspace, typeCorrections: corrections },
          changes.length === 1 ? (set ? "Type saved" : "Using the suggestion") : `${changes.length} types saved`);
      },

      savePlan(budget, expected, snapshot, raw, rawEntries) {
        const workspace = read(budget);
        const plan = planSchema.parse(raw);
        const existing = workspace.plans.find((entry) => entry.id === plan.id);
        if (expected === null) {
          if (existing) throw new Error("A plan with this id already exists");
        } else {
          requireRevision(existing, expected);
          if (existing.cardId !== plan.cardId) throw new Error("A plan cannot move to another card");
        }
        const card = workspace.cards.find((entry) => entry.id === plan.cardId);
        if (!card) throw new Error("This card is no longer available in the active budget");
        if (snapshot.issues.length || snapshot.accountId !== card.accountId) throw new Error("Refresh this card's Actual activity before saving");
        if (plan.endedOn && plan.endedOn > snapshot.to) throw new Error("The end date cannot be in the future");
        checkPlanAccount(plan, workspace, snapshot);
        const entries = rawEntries.map((entry) => planEntrySchema.parse(entry));
        checkEntries(plan, entries, card, workspace, snapshot);
        const saved: RepaymentPlan = { ...plan, revision: existing ? existing.revision + 1 : 1 };
        const accounts = plan.planAccountId && !workspace.planAccounts.includes(plan.planAccountId)
          ? [...workspace.planAccounts, plan.planAccountId]
          : workspace.planAccounts;
        return write(budget, {
          ...workspace,
          plans: [...workspace.plans.filter((entry) => entry.id !== saved.id), saved],
          planEntries: [...workspace.planEntries.filter((entry) => entry.planId !== saved.id), ...entries],
          planAccounts: accounts,
        }, "Plan saved");
      },

      deletePlan(budget, planId, expected) {
        const workspace = read(budget);
        const plan = workspace.plans.find((entry) => entry.id === planId);
        requireRevision(plan, expected);
        // The account stays in the plan-accounts list, so its transfers are still never payments.
        return write(budget, {
          ...workspace,
          plans: workspace.plans.filter((entry) => entry.id !== planId),
          planEntries: workspace.planEntries.filter((entry) => entry.planId !== planId),
        }, "Plan removed; Actual transactions unchanged");
      },

      setPlanAccounts(budget, accountIds) {
        const workspace = read(budget);
        const ids = [...new Set(accountIds.map((value) => value.trim()).filter(Boolean))];
        const used = workspace.plans.flatMap((plan) => (plan.planAccountId ? [plan.planAccountId] : []));
        if (used.some((accountId) => !ids.includes(accountId))) throw new Error("A plan still uses this plan account");
        return write(budget, { ...workspace, planAccounts: ids }, "Plan accounts saved");
      },
    };
  });
}

/** §12.3: own-account and shared-tag plans never mix in one account; tags are unique. */
function checkPlanAccount(plan: RepaymentPlan, workspace: Workspace, snapshot: ActivitySnapshot) {
  if (!plan.planAccountId) return;
  const account = snapshot.accounts?.find((entry) => entry.id === plan.planAccountId);
  if (account && (!account.offBudget || account.closed)) throw new Error("Choose an open off-budget plan account");
  const others = workspace.plans.filter((entry) => entry.id !== plan.id && entry.planAccountId === plan.planAccountId);
  if (plan.planAccountTag === null && others.length) {
    throw new Error("This account already holds other plans. Give this plan a #tag, or use its own account.");
  }
  if (others.some((entry) => entry.planAccountTag === null)) {
    throw new Error("This account belongs to another plan. Use a different account.");
  }
  if (others.some((entry) => entry.planAccountTag === plan.planAccountTag)) {
    throw new Error("Each plan tag must be unique within its plan account");
  }
}

function checkEntries(plan: RepaymentPlan, entries: PlanEntry[], card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  if (new Set(entries.map((entry) => entry.transactionId)).size !== entries.length) throw new Error("Link each Actual entry once");
  const pairs = entries.flatMap((entry) => (entry.transferPairKey ? [entry.transferPairKey] : []));
  if (new Set(pairs).size !== pairs.length) throw new Error("Link only one side of each transfer");
  const index = rowIndex(snapshot).rows;
  const elsewhere = workspace.planEntries.filter((entry) => entry.planId !== plan.id);
  const originals: ActivityRow[] = [];
  for (const entry of entries) {
    const row = index.get(entry.transactionId);
    if (entry.planId !== plan.id || !row || row.identity !== entry.identityHash) {
      throw new Error("Review the linked entry: it changed or is unavailable");
    }
    if (row.accountId !== card.accountId && !planAccountIds(workspace).has(row.accountId) && row.accountId !== plan.planAccountId) {
      throw new Error("Link entries from this card or its plan account");
    }
    if (elsewhere.some((other) => other.transactionId === row.id || (entry.transferPairKey && other.transferPairKey === entry.transferPairKey))) {
      throw new Error("This Actual entry belongs to another plan");
    }
    if (entry.role === "original") {
      if (row.accountId !== card.accountId || row.amountMinor >= 0 || !PLAN_ELIGIBLE_KINDS.includes(activityKind(row, card, workspace, snapshot))) {
        throw new Error("An original must be a purchase or borrowing on this card");
      }
      originals.push(row);
    }
    if ((entry.role === "conversion" || entry.role === "refund") && row.amountMinor <= 0) throw new Error("Conversions and refunds are credits");
    if (entry.role === "instalment" && row.amountMinor >= 0) throw new Error("A billed instalment is a charge");
    if (entry.instalmentNumber !== null && plan.instalmentCount !== null && entry.instalmentNumber > plan.instalmentCount) {
      throw new Error("Choose a valid instalment number");
    }
  }
  // PL-13: whenever originals are chosen, the plan must fit them.
  if (originals.length) {
    const total = sumMinor(originals.map((row) => -row.amountMinor));
    if (plan.originalAmountMinor !== null && plan.originalAmountMinor > total) throw new Error("The plan amount exceeds its original purchases");
    if (plan.startDate && originals.some((row) => row.date > plan.startDate!)) throw new Error("The plan starts before its original purchases");
  }
}

/** The browser's store, backed by the app-DB API. Tests swap `persistence` for memory. */
export const creditCardStore = createCreditCardStore(httpPersistence);
