import { z } from "zod";
import {
  cardSchema,
  decisionSchema,
  limitChangeSchema,
  planEntrySchema,
  planSchema,
  statementSchema,
  typeCorrectionSchema,
  type Card,
  type Decision,
  type LimitChange,
  type PlanEntry,
  type RepaymentPlan,
  type Statement,
  type TypeCorrection,
  type Workspace,
} from "./schema";

/**
 * A change set: the rows one command changes, with the revisions it expects. The client builds it
 * by diffing the workspace before and after a command; the server applies it in one transaction.
 * Both run `applyChangeSet`, so revision checks and the repository rules (§12.3) exist once.
 *
 * - Cards, statements and plans carry a revision. A put must be `current + 1` (or the row is new);
 *   a removal names the revision it expects.
 * - A statement's decisions and a plan's entries are replaced as a whole, and only together with a
 *   put or removal of that statement or plan, so their parent's revision guards them.
 * - A type correction names the value it expects to replace (or null for none).
 * - The plan-accounts list names the list it expects.
 */
export type Guard = { id: string; revision: number };
export type TypeChange = {
  cardId: string;
  transactionId: string;
  expected: Pick<TypeCorrection, "kind" | "sourceHash"> | null;
  next: TypeCorrection | null;
};
export type ChangeSet = {
  cards: { put: Card[]; remove: Guard[] };
  statements: { put: Statement[]; remove: Guard[] };
  plans: { put: RepaymentPlan[]; remove: Guard[] };
  decisions: { statementId: string; rows: Decision[] }[];
  planEntries: { planId: string; rows: PlanEntry[] }[];
  typeCorrections: TypeChange[];
  planAccounts: { expected: string[]; next: string[] } | null;
  /** A card's whole limit history, written only with that card (its revision guards them). */
  limitChanges: { cardId: string; rows: LimitChange[] }[];
};

export class CreditCardConflictError extends Error {
  readonly code = "CREDIT_CARD_CONFLICT";
  constructor(message = "This changed since you opened it. Reload to see the latest values; your draft is kept.") {
    super(message);
    this.name = "CreditCardConflictError";
  }
}

export class CreditCardRuleError extends Error {
  readonly code = "CREDIT_CARD_RULE";
  constructor(message: string) {
    super(message);
    this.name = "CreditCardRuleError";
  }
}

const MAX_ROWS = 5000;
const guardSchema = z.strictObject({ id: z.string().min(1), revision: z.number().int().positive() });
const storedStatement = statementSchema;
const tableOf = <T extends z.ZodType>(row: T) => z.strictObject({ put: z.array(row).max(MAX_ROWS), remove: z.array(guardSchema).max(MAX_ROWS) });

export const changeSetSchema = z.strictObject({
  cards: tableOf(cardSchema),
  statements: tableOf(storedStatement),
  plans: tableOf(planSchema),
  decisions: z.array(z.strictObject({ statementId: z.string().min(1), rows: z.array(decisionSchema).max(MAX_ROWS) })).max(MAX_ROWS),
  planEntries: z.array(z.strictObject({ planId: z.string().min(1), rows: z.array(planEntrySchema).max(MAX_ROWS) })).max(MAX_ROWS),
  typeCorrections: z.array(z.strictObject({
    cardId: z.string().min(1),
    transactionId: z.string().min(1),
    expected: z.strictObject({ kind: typeCorrectionSchema.shape.kind, sourceHash: z.string().min(1) }).nullable(),
    next: typeCorrectionSchema.nullable(),
  })).max(MAX_ROWS),
  planAccounts: z.strictObject({ expected: z.array(z.string().min(1)), next: z.array(z.string().min(1)) }).nullable(),
  limitChanges: z.array(z.strictObject({ cardId: z.string().min(1), rows: z.array(limitChangeSchema).max(MAX_ROWS) })).max(MAX_ROWS),
});

export const EMPTY_CHANGES: ChangeSet = {
  cards: { put: [], remove: [] },
  statements: { put: [], remove: [] },
  plans: { put: [], remove: [] },
  decisions: [],
  planEntries: [],
  typeCorrections: [],
  planAccounts: null,
  limitChanges: [],
};

export function isEmptyChangeSet(changes: ChangeSet) {
  return !changes.cards.put.length && !changes.cards.remove.length
    && !changes.statements.put.length && !changes.statements.remove.length
    && !changes.plans.put.length && !changes.plans.remove.length
    && !changes.decisions.length && !changes.planEntries.length && !changes.typeCorrections.length && !changes.planAccounts
    && !changes.limitChanges.length;
}

/** Stored statements only: estimates are never persisted. */
const stored = (statement: Statement): Statement => {
  const { estimate, ...rest } = statement;
  void estimate;
  return rest;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const typeKey = (entry: { cardId: string; transactionId: string }) => `${entry.cardId}\u0000${entry.transactionId}`;

function groupBy<T>(rows: readonly T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
}

function diffRevisioned<T extends { id: string; revision: number }>(before: readonly T[], after: readonly T[]) {
  const old = new Map(before.map((row) => [row.id, row]));
  const next = new Map(after.map((row) => [row.id, row]));
  return {
    put: after.filter((row) => !same(old.get(row.id), row)),
    remove: before.filter((row) => !next.has(row.id)).map((row) => ({ id: row.id, revision: row.revision })),
  };
}

/** The change set that turns `before` into `after`. */
export function diffWorkspaces(before: Workspace, after: Workspace): ChangeSet {
  const decisionsBefore = groupBy(before.decisions, (row) => row.statementId);
  const decisionsAfter = groupBy(after.decisions, (row) => row.statementId);
  const statementIds = new Set([...decisionsBefore.keys(), ...decisionsAfter.keys()]);
  const entriesBefore = groupBy(before.planEntries, (row) => row.planId);
  const entriesAfter = groupBy(after.planEntries, (row) => row.planId);
  const planIds = new Set([...entriesBefore.keys(), ...entriesAfter.keys()]);
  const typesBefore = new Map(before.typeCorrections.map((row) => [typeKey(row), row]));
  const typesAfter = new Map(after.typeCorrections.map((row) => [typeKey(row), row]));
  const typeKeys = new Set([...typesBefore.keys(), ...typesAfter.keys()]);
  const removedStatements = new Set(before.statements.filter((row) => !after.statements.some((entry) => entry.id === row.id)).map((row) => row.id));
  const removedPlans = new Set(before.plans.filter((row) => !after.plans.some((entry) => entry.id === row.id)).map((row) => row.id));
  const limitsBefore = groupBy(before.limitChanges, (row) => row.cardId);
  const limitsAfter = groupBy(after.limitChanges, (row) => row.cardId);
  const limitCards = new Set([...limitsBefore.keys(), ...limitsAfter.keys()]);
  const removedCards = new Set(before.cards.filter((row) => !after.cards.some((entry) => entry.id === row.id)).map((row) => row.id));
  const byDate = (rows: LimitChange[]) => [...rows].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return {
    cards: diffRevisioned(before.cards, after.cards),
    statements: diffRevisioned(before.statements.map(stored), after.statements.map(stored)),
    plans: diffRevisioned(before.plans, after.plans),
    decisions: [...statementIds]
      .filter((id) => !same(decisionsBefore.get(id) ?? [], decisionsAfter.get(id) ?? []))
      .filter((id) => !(removedStatements.has(id) && !decisionsAfter.has(id)))
      .map((statementId) => ({ statementId, rows: decisionsAfter.get(statementId) ?? [] })),
    planEntries: [...planIds]
      .filter((id) => !same(entriesBefore.get(id) ?? [], entriesAfter.get(id) ?? []))
      .filter((id) => !(removedPlans.has(id) && !entriesAfter.has(id)))
      .map((planId) => ({ planId, rows: entriesAfter.get(planId) ?? [] })),
    typeCorrections: [...typeKeys]
      .filter((key) => !same(typesBefore.get(key), typesAfter.get(key)))
      .filter((key) => {
        // A card removal cascades its types; the inverse restores them.
        const previous = typesBefore.get(key);
        return typesAfter.has(key) || !previous || after.cards.some((card) => card.id === previous.cardId);
      })
      .map((key) => {
        const previous = typesBefore.get(key);
        const next = typesAfter.get(key) ?? null;
        const [cardId, transactionId] = key.split("\u0000");
        return { cardId, transactionId, expected: previous ? { kind: previous.kind, sourceHash: previous.sourceHash } : null, next };
      }),
    planAccounts: same([...before.planAccounts].sort(), [...after.planAccounts].sort())
      ? null
      : { expected: before.planAccounts, next: after.planAccounts },
    // A card removal cascades its limit history; the inverse restores it with the card.
    limitChanges: [...limitCards]
      .filter((id) => !same(byDate(limitsBefore.get(id) ?? []), byDate(limitsAfter.get(id) ?? [])))
      .filter((id) => !(removedCards.has(id) && !limitsAfter.has(id)))
      .map((cardId) => ({ cardId, rows: byDate(limitsAfter.get(cardId) ?? []) })),
  };
}

/**
 * The change set that undoes a committed one (`before` → `after`), guarded against `after`.
 * Restored rows get a revision above the current one, so an editor holding an older revision
 * cannot become valid again (ABA).
 */
export function inverseChanges(before: Workspace, after: Workspace): ChangeSet {
  const bump = <T extends { id: string; revision: number }>(rows: readonly T[], now: readonly T[]) => rows.map((row) => ({
    ...row,
    revision: Math.max(row.revision, now.find((entry) => entry.id === row.id)?.revision ?? 0) + 1,
  }));
  const restored: Workspace = {
    ...before,
    cards: bump(before.cards, after.cards),
    statements: bump(before.statements.map(stored), after.statements.map(stored)),
    plans: bump(before.plans, after.plans),
  };
  const forward = diffWorkspaces(before, after);
  const touched = (ids: Set<string>) => (row: { id: string }) => ids.has(row.id);
  const cardIds = new Set([
    ...forward.cards.put.map((row) => row.id), ...forward.cards.remove.map((row) => row.id),
    ...forward.limitChanges.map((entry) => entry.cardId),
  ]);
  const statementIds = new Set([
    ...forward.statements.put.map((row) => row.id), ...forward.statements.remove.map((row) => row.id),
    ...forward.decisions.map((entry) => entry.statementId),
  ]);
  const planIds = new Set([
    ...forward.plans.put.map((row) => row.id), ...forward.plans.remove.map((row) => row.id),
    ...forward.planEntries.map((entry) => entry.planId),
  ]);
  return diffWorkspaces(after, {
    ...restored,
    cards: [...after.cards.filter((row) => !cardIds.has(row.id)), ...restored.cards.filter(touched(cardIds))],
    statements: [...after.statements.map(stored).filter((row) => !statementIds.has(row.id)), ...restored.statements.filter(touched(statementIds))],
    plans: [...after.plans.filter((row) => !planIds.has(row.id)), ...restored.plans.filter(touched(planIds))],
  });
}

function guardRevision<T extends { id: string; revision: number }>(rows: Map<string, T>, put: T) {
  const current = rows.get(put.id);
  if (current && current.revision !== put.revision - 1) throw new CreditCardConflictError();
}

function guardRemoval<T extends { id: string; revision: number }>(rows: Map<string, T>, guard: Guard) {
  const current = rows.get(guard.id);
  if (!current || current.revision !== guard.revision) throw new CreditCardConflictError();
}

/**
 * Applies a change set to a budget's workspace, checking every expected revision and value, then
 * the repository rules. Throws `CreditCardConflictError` (409) or `CreditCardRuleError` (400).
 * Pure: the same function guards the server write and the client's in-memory persistence.
 */
export function applyChangeSet(current: Workspace, changes: ChangeSet, budgetSyncId: string): Workspace {
  const cards = new Map(current.cards.map((row) => [row.id, row]));
  const statements = new Map(current.statements.map((row) => [row.id, stored(row)]));
  const plans = new Map(current.plans.map((row) => [row.id, row]));
  let decisions = current.decisions;
  let planEntries = current.planEntries;
  let typeCorrections = current.typeCorrections;
  let planAccounts = current.planAccounts;
  let limitChanges = current.limitChanges;

  // Types: compare against the value the client expects to replace.
  for (const change of changes.typeCorrections) {
    const existing = typeCorrections.find((row) => row.cardId === change.cardId && row.transactionId === change.transactionId);
    const matches = change.expected === null ? !existing
      : Boolean(existing && existing.kind === change.expected.kind && existing.sourceHash === change.expected.sourceHash);
    if (!matches) throw new CreditCardConflictError();
    if (change.next && (change.next.cardId !== change.cardId || change.next.transactionId !== change.transactionId)) {
      throw new CreditCardRuleError("A type change must name its own transaction");
    }
    typeCorrections = [
      ...typeCorrections.filter((row) => row !== existing),
      ...(change.next ? [change.next] : []),
    ];
  }
  if (changes.planAccounts) {
    if (!same([...planAccounts].sort(), [...changes.planAccounts.expected].sort())) throw new CreditCardConflictError();
    planAccounts = [...new Set(changes.planAccounts.next)];
  }

  // Removals cascade like the database (ON DELETE CASCADE).
  for (const guard of changes.plans.remove) {
    guardRemoval(plans, guard);
    plans.delete(guard.id);
    planEntries = planEntries.filter((row) => row.planId !== guard.id);
  }
  for (const guard of changes.statements.remove) {
    guardRemoval(statements, guard);
    statements.delete(guard.id);
    decisions = decisions.filter((row) => row.statementId !== guard.id);
  }
  for (const guard of changes.cards.remove) {
    guardRemoval(cards, guard);
    cards.delete(guard.id);
    for (const [id, row] of statements) if (row.cardId === guard.id) statements.delete(id);
    for (const [id, row] of plans) if (row.cardId === guard.id) plans.delete(id);
    decisions = decisions.filter((row) => row.cardId !== guard.id);
    typeCorrections = typeCorrections.filter((row) => row.cardId !== guard.id);
    planEntries = planEntries.filter((row) => plans.has(row.planId));
    limitChanges = limitChanges.filter((row) => row.cardId !== guard.id);
  }
  for (const row of changes.cards.put) {
    guardRevision(cards, row);
    const existing = cards.get(row.id);
    if (row.budgetSyncId !== budgetSyncId) throw new CreditCardRuleError("A card belongs to one budget");
    if (existing && existing.accountId !== row.accountId) throw new CreditCardRuleError("A card's Actual account cannot change");
    cards.set(row.id, row);
  }
  for (const row of changes.statements.put) {
    guardRevision(statements, row);
    const existing = statements.get(row.id);
    if (existing && existing.cardId !== row.cardId) throw new CreditCardRuleError("A statement cannot move to another card");
    statements.set(row.id, row);
  }
  for (const row of changes.plans.put) {
    guardRevision(plans, row);
    const existing = plans.get(row.id);
    if (existing && existing.cardId !== row.cardId) throw new CreditCardRuleError("A plan cannot move to another card");
    plans.set(row.id, row);
  }

  // Child rows travel with their parent, so the parent's revision guards them.
  const statementTouched = new Set([...changes.statements.put, ...changes.statements.remove].map((row) => row.id));
  for (const entry of changes.decisions) {
    if (!statementTouched.has(entry.statementId)) throw new CreditCardRuleError("Decisions change only with their statement");
    if (entry.rows.some((row) => row.statementId !== entry.statementId)) throw new CreditCardRuleError("Decisions must belong to their statement");
    decisions = [...decisions.filter((row) => row.statementId !== entry.statementId), ...entry.rows];
  }
  const planTouched = new Set([...changes.plans.put, ...changes.plans.remove].map((row) => row.id));
  for (const entry of changes.planEntries) {
    if (!planTouched.has(entry.planId)) throw new CreditCardRuleError("Plan entries change only with their plan");
    if (entry.rows.some((row) => row.planId !== entry.planId)) throw new CreditCardRuleError("Entries must belong to their plan");
    planEntries = [...planEntries.filter((row) => row.planId !== entry.planId), ...entry.rows];
  }

  const cardTouched = new Set([...changes.cards.put, ...changes.cards.remove].map((row) => row.id));
  for (const entry of changes.limitChanges) {
    if (!cardTouched.has(entry.cardId)) throw new CreditCardRuleError("Limit changes change only with their card");
    if (entry.rows.some((row) => row.cardId !== entry.cardId)) throw new CreditCardRuleError("Limit changes must belong to their card");
    limitChanges = [...limitChanges.filter((row) => row.cardId !== entry.cardId), ...entry.rows];
  }

  const next: Workspace = {
    cards: [...cards.values()],
    statements: [...statements.values()],
    decisions,
    typeCorrections,
    plans: [...plans.values()],
    planEntries,
    planAccounts,
    limitChanges,
  };
  // A plan account a plan still uses cannot be removed; every plan account is registered (§12.3).
  const used = next.plans.flatMap((plan) => (plan.planAccountId ? [plan.planAccountId] : []));
  if (changes.planAccounts && used.some((id) => !next.planAccounts.includes(id))) {
    throw new CreditCardRuleError("A plan still uses this plan account");
  }
  next.planAccounts = [...new Set([...next.planAccounts, ...used])];
  checkWorkspace(next);
  return next;
}

/** The invariants the database enforces, plus those it cannot express (§12.3). */
export function checkWorkspace(workspace: Workspace) {
  const fail = (message: string) => {
    throw new CreditCardRuleError(message);
  };
  const cards = new Map(workspace.cards.map((card) => [card.id, card]));
  const accounts = new Set<string>();
  for (const card of workspace.cards) {
    if (accounts.has(card.accountId)) fail("This account is already registered");
    accounts.add(card.accountId);
  }
  const statements = new Map(workspace.statements.map((statement) => [statement.id, statement]));
  for (const statement of workspace.statements) {
    if (!cards.has(statement.cardId)) fail("A statement needs its card");
    const others = workspace.statements.filter((entry) => entry.cardId === statement.cardId && entry.id !== statement.id);
    if (others.some((entry) => entry.closingDate === statement.closingDate)) fail("A statement already uses this closing date");
    if (others.some((entry) => !(entry.closingDate < statement.periodStart || entry.periodStart > statement.closingDate))) {
      fail("Statement periods must not overlap");
    }
  }
  for (const card of workspace.cards) {
    if (card.billingDaysSource === "default" && workspace.statements.some((entry) => entry.cardId === card.id)) {
      fail("The first bank statement replaces default billing days");
    }
  }
  const included = new Set<string>();
  const decided = new Set<string>();
  for (const decision of workspace.decisions) {
    const statement = statements.get(decision.statementId);
    if (!statement || statement.cardId !== decision.cardId) fail("A decision must match its statement's card");
    const key = `${decision.statementId}\u0000${decision.transactionId}`;
    if (decided.has(key)) fail("Decide each transaction once per statement");
    decided.add(key);
    if (decision.decision === "included") {
      const bill = `${decision.cardId}\u0000${decision.transactionId}`;
      if (included.has(bill)) fail("A transaction cannot belong to two statements");
      included.add(bill);
    }
  }
  const types = new Set<string>();
  for (const correction of workspace.typeCorrections) {
    if (!cards.has(correction.cardId)) fail("A type needs its card");
    if (types.has(typeKey(correction))) fail("Set one type per transaction");
    types.add(typeKey(correction));
  }
  const plans = new Map(workspace.plans.map((plan) => [plan.id, plan]));
  for (const plan of workspace.plans) {
    if (!cards.has(plan.cardId)) fail("A plan needs its card");
    if (!plan.planAccountId) continue;
    const sharing = workspace.plans.filter((other) => other.id !== plan.id && other.planAccountId === plan.planAccountId);
    if (plan.planAccountTag === null && sharing.length) fail("An account owned by one plan cannot hold other plans");
    if (plan.planAccountTag !== null && sharing.some((other) => other.planAccountTag === plan.planAccountTag)) {
      fail("Each plan tag must be unique within its plan account");
    }
  }
  const limitDates = new Set<string>();
  for (const change of workspace.limitChanges) {
    if (!cards.has(change.cardId)) fail("A limit change needs its card");
    const key = `${change.cardId}\u0000${change.effectiveDate}`;
    if (limitDates.has(key)) fail("Record one limit change per date");
    limitDates.add(key);
  }
  const entryTransactions = new Set<string>();
  const pairs = new Set<string>();
  for (const entry of workspace.planEntries) {
    if (!plans.has(entry.planId)) fail("A plan entry needs its plan");
    if (entryTransactions.has(entry.transactionId)) fail("A transaction belongs to one plan");
    entryTransactions.add(entry.transactionId);
    if (entry.transferPairKey) {
      if (pairs.has(entry.transferPairKey)) fail("Both sides of a transfer belong to one plan");
      pairs.add(entry.transferPairKey);
    }
  }
}
