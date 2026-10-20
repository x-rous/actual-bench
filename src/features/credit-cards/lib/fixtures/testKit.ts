import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { normalizeActivity, type ActivityRow, type ActivitySnapshot } from "../activity";
import { createCreditCardStore, creditCardStore } from "../store/store";
import { memoryPersistence, type CreditCardPersistence } from "../store/persistence";
import type { Card, CardInput, Statement, StatementFactsInput } from "../models";

/**
 * Test support with Actual-realistic shapes (PL-16): rows go through the real normaliser, so
 * fingerprints and identities are real `cc-v2` hashes; transfer legs are separate rows on each
 * account with independent dates, clearing and notes. Never imported by production code.
 */
export const BUDGET = "budget";
export const CARD_ACCOUNT = "card-account";
export const BANK_ACCOUNT = "bank-account";

type Source = Partial<SyncSourceTransaction> & { id: string; date: string; amount: number };

export function source(entry: Source): SyncSourceTransaction {
  return {
    accountId: CARD_ACCOUNT,
    payeeId: null,
    payeeName: entry.id,
    categoryId: null,
    categoryName: null,
    notes: null,
    cleared: true,
    reconciled: false,
    importedId: null,
    transferId: null,
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...entry,
  };
}

/** One normalised row. */
export function row(entry: Source): ActivityRow {
  const [result] = normalizeActivity([source(entry)]).rows;
  return result;
}

/** A transfer pair: the card leg (amount) and its peer on `peerAccount` (−amount), each with its own fields. */
export function transfer(id: string, date: string, amount: number, peerAccount: string, options: {
  peerDate?: string;
  cleared?: boolean;
  peerCleared?: boolean;
  notes?: string | null;
  peerNotes?: string | null;
  accountId?: string;
} = {}) {
  const peerId = `${id}-peer`;
  const card = row({
    id, date, amount, accountId: options.accountId ?? CARD_ACCOUNT, transferId: peerId, cleared: options.cleared ?? true, notes: options.notes ?? null,
    payeeName: "Transfer",
  });
  const peer = row({
    id: peerId,
    date: options.peerDate ?? date,
    amount: -amount,
    accountId: peerAccount,
    transferId: id,
    // Actual creates the counterpart leg uncleared unless it is cleared separately.
    cleared: options.peerCleared ?? false,
    notes: options.peerNotes ?? options.notes ?? null,
    payeeName: "Transfer",
  });
  return { card, peer };
}

type SnapshotOptions = Partial<Omit<ActivitySnapshot, "rows">> & {
  /** Plan-account histories: account id → rows (including card-side counterparts automatically). */
  planAccounts?: Record<string, { rows: ActivityRow[]; signedBalanceMinor?: number; issues?: string[] }>;
};

export function snapshot(rows: ActivityRow[], options: SnapshotOptions = {}): ActivitySnapshot {
  const { planAccounts = {}, ...rest } = options;
  const cardRows = rows.filter((entry) => entry.accountId === (rest.accountId ?? CARD_ACCOUNT));
  const others = rows.filter((entry) => entry.accountId !== (rest.accountId ?? CARD_ACCOUNT));
  return {
    accountId: CARD_ACCOUNT,
    from: "2026-01-01",
    to: "2026-12-31",
    rows: cardRows,
    counterparts: others,
    issues: [],
    fetchedAt: "2026-12-31T00:00:00.000Z",
    signature: cardRows.map((entry) => entry.evidenceFingerprint).join(","),
    accounts: [
      { id: CARD_ACCOUNT, name: "Visa", offBudget: false },
      { id: BANK_ACCOUNT, name: "Checking", offBudget: false },
      ...Object.keys(planAccounts).map((id) => ({ id, name: `Plan ${id}`, offBudget: true })),
    ],
    trackingAccounts: Object.entries(planAccounts).map(([accountId, entry]) => ({
      accountId,
      rows: entry.rows,
      counterparts: cardRows.filter((card) => entry.rows.some((plan) => plan.transferId === card.id)),
      issues: entry.issues ?? [],
      signedBalanceMinor: entry.signedBalanceMinor,
      to: rest.to ?? "2026-12-31",
    })),
    ...rest,
  };
}

export const CARD_INPUT: CardInput = {
  budgetSyncId: BUDGET,
  accountId: CARD_ACCOUNT,
  bankTimeZone: "UTC",
  creditLimitMinor: 500_000,
  purchaseAprBps: 2400,
  closingDay: 10,
  dueRule: { kind: "day-of-month", value: 3 },
  minimumPercentBps: 500,
  minimumFloorMinor: 10_000,
};

/** Empties the app's shared store and backs it with memory, so component tests never call the API. */
export function resetCreditCardStore() {
  creditCardStore.setState({ workspaces: {}, status: {}, notices: {}, undoHistory: {}, persistence: memoryPersistence() });
}

type TestStore = Pick<ReturnType<typeof createCreditCardStore>, "getState">;

/**
 * Registers a card and returns it at once. Memory persistence commits synchronously, so the card is
 * in state when the command returns; validation errors still throw.
 */
export function addCard(store: TestStore, input: CardInput): Card {
  store.getState().registerCard(input).catch(() => undefined);
  const card = store.getState().workspaces[input.budgetSyncId]?.cards.find((entry) => entry.accountId === input.accountId);
  if (!card) throw new Error("The card was not saved");
  return card;
}

/** Records a statement and returns it at once (see `addCard`). */
export function addStatement(store: TestStore, budget: string, cardId: string, facts: StatementFactsInput): Statement {
  store.getState().recordStatement(budget, cardId, facts).catch(() => undefined);
  const statement = store.getState().workspaces[budget]?.statements
    .find((entry) => entry.cardId === cardId && entry.closingDate === facts.closingDate);
  if (!statement) throw new Error("The statement was not saved");
  return statement;
}

/** A store with one registered card and optional saved statements. */
export function setup(card: Partial<CardInput> = {}, statements: StatementFactsInput[] = [], persistence?: CreditCardPersistence) {
  const store = createCreditCardStore(persistence);
  const registered = addCard(store, { ...CARD_INPUT, ...card });
  const saved = statements.map((facts) => addStatement(store, BUDGET, registered.id, facts));
  const workspace = () => store.getState().workspaces[BUDGET];
  return { store, cardId: registered.id, saved, workspace, card: () => workspace().cards[0] };
}

/** A statement's facts with defaults. */
export function facts(closingDate: string, balanceMinor: number, rest: Partial<StatementFactsInput> = {}): StatementFactsInput {
  const [year, month] = closingDate.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 11)).toISOString().slice(0, 10);
  const due = new Date(Date.UTC(year, month, 3)).toISOString().slice(0, 10);
  return { periodStart: previous, closingDate, dueDate: due, balanceMinor, minimumDueMinor: 0, ...rest };
}

export const PLAN_ACCOUNT = "plan-laptop";

/**
 * A 30,000.00 laptop bought on 10 Jun, converted into an own plan account on 12 Jun, billed back
 * 5,000.00 on 8 Jul; a 5,000.00 cash payment on 2 Aug, a statement closing on the 10th, and an
 * uncleared 1,000.00 payment on 15 Oct. Today is 16 Oct.
 */
export function laptopPlanScenario(persistence?: CreditCardPersistence) {
  const test = setup({ purchaseAprBps: null }, [
    facts("2026-06-10", 0, { periodStart: "2026-05-11", previousBalanceMinor: 0 }),
    facts("2026-07-10", 3000000),
  ], persistence);
  const conversion = transfer("conversion", "2026-06-12", 3000000, PLAN_ACCOUNT);
  const billed = transfer("billed", "2026-07-08", -500000, PLAN_ACCOUNT);
  const cash = transfer("cash", "2026-08-02", 500000, BANK_ACCOUNT);
  const pending = transfer("pending", "2026-10-15", 100000, BANK_ACCOUNT, { cleared: false });
  const rows = [row({ id: "laptop", date: "2026-06-10", amount: -3000000, categoryId: "tech" }), conversion.card, billed.card, cash.card, pending.card];
  const read = snapshot(rows, { from: "2026-05-01", to: "2026-10-16", planAccounts: { [PLAN_ACCOUNT]: { rows: [conversion.peer, billed.peer] } } });
  test.store.getState().savePlan(BUDGET, null, read, {
    id: "plan", cardId: test.cardId, revision: 1, name: "Laptop", recordedAs: "plan-account", planAccountId: PLAN_ACCOUNT,
    originalAmountMinor: 3000000, startDate: "2026-06-10",
  }, []);
  const signedBalanceMinor = rows.reduce((total, entry) => total + entry.amountMinor, 0);
  return { ...test, snapshot: read, signedBalanceMinor, today: "2026-10-16" };
}
