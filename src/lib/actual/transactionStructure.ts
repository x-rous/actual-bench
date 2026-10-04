/**
 * Restructuring and transfer-linking existing transactions (RD-084 P1.6
 * T121–T124; research R-06, R-07, R-18).
 *
 * Both transports reach Actual's public `updateTransaction` (Direct: the
 * runtime call; HTTP: `PATCH /transactions/{id}`, which actual-http-api
 * forwards verbatim), so the logic lives here once and each transport supplies
 * only two primitives: read an account's raw rows and update one row. Direct
 * and HTTP therefore behave identically by construction.
 *
 * Binding facts from the P1.0 live spike (agents/knowledge.md):
 *
 * - updating a split child replaces it, so every child update sends the
 *   child's full fields (amount, category, payee, notes);
 * - linking an existing row as the counterpart takes two calls, child first,
 *   and Actual inserts nothing; it does overwrite the counterpart's amount, so
 *   exact equality is a precondition, and it changes a reconciled row, so a
 *   reconciled counterpart is refused;
 * - editing the counterpart between the two calls makes Actual insert a stray
 *   row, so nothing ever does that, and completion checks for one first;
 * - Actual does not stop Bench restructuring a reconciled row: the expected-
 *   state check here must.
 *
 * Every operation re-reads the target first and refuses, writing nothing, if
 * any preflight field differs from what the caller previewed (FR-162).
 */

export type RawTxn = Record<string, unknown> & {
  id: string;
  account?: string;
  date?: string;
  amount?: number;
  subtransactions?: RawTxn[];
};

export type StructurePrimitives = {
  /** Top-level rows of one account from `sinceDate`, split children inline as `subtransactions`. */
  readAccount(accountId: string, sinceDate: string): Promise<RawTxn[]>;
  /**
   * Actual `updateTransaction(id, fields)`. The Direct implementation must not
   * return until the write has landed and the budget is quiet (R-18).
   */
  update(id: string, fields: Record<string, unknown>, watch: { accountIds: string[]; sinceDate: string }): Promise<void>;
};

/** The fields preflight compares, in transport terms. Amounts are integer minor units. */
export type TransactionPreflight = {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payeeId: string | null;
  categoryId: string | null;
  notes: string | null;
  reconciled: boolean;
  transferId: string | null;
  isParent: boolean;
  isChild: boolean;
  parentId: string | null;
  childCount: number;
};

export type SplitChildInput = { amount: number; categoryId: string | null; payeeId: string | null; notes: string | null };

export type RestructureSplitInput = {
  accountId: string;
  transactionId: string;
  expected: TransactionPreflight;
  children: SplitChildInput[];
};

export type StructureChild = { id: string; amount: number; categoryId: string | null; payeeId: string | null; notes: string | null; transferId: string | null };

export type RestructureSplitResult = { parentId: string; parentAmount: number; children: StructureChild[] };

export type LinkTransferInput = {
  source: TransactionPreflight;
  counterpart: TransactionPreflight;
  /** The transfer payee of the counterpart's account. */
  transferPayeeId: string;
};

export type LinkTransferResult = { sourceId: string; counterpartId: string; sourceTransferId: string | null; counterpartTransferId: string | null; counterpartAmount: number };

export type ExpectedSplitState = {
  parentAmount: number;
  children: Array<{ amount: number; categoryId: string | null; payeeId: string | null; notes: string | null; transferAccountId: string | null }>;
};

export type RestructureVerification = "applied-exact" | "not-applied" | "mismatch";

export type HalfLinkState =
  | { state: "linked" }
  | { state: "half-linked"; strayCounterpartIds: string[] }
  | { state: "not-linked" }
  | { state: "changed"; detail: string };

export class TransactionChangedError extends Error {
  readonly differences: string[];
  constructor(differences: string[]) {
    super(`Actual changed since the preview: ${differences.join(", ")}. Nothing was written.`);
    this.name = "TransactionChangedError";
    this.differences = differences;
  }
}

export class TransactionStructureRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionStructureRefusedError";
  }
}

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const minor = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) ? value : 0);

/** Read one row, child or top-level, with its parent when it is a child. */
export async function findRaw(
  primitives: StructurePrimitives,
  accountId: string,
  id: string,
  sinceDate: string
): Promise<{ row: RawTxn; parent: RawTxn | null } | null> {
  for (const top of await primitives.readAccount(accountId, sinceDate)) {
    if (top.id === id) return { row: top, parent: null };
    const child = (top.subtransactions ?? []).find((c) => c.id === id);
    if (child) return { row: child, parent: top };
  }
  return null;
}

export function preflightOf(row: RawTxn, parent: RawTxn | null, accountId: string): TransactionPreflight {
  return {
    id: row.id,
    accountId: str(row.account) ?? accountId,
    date: str(row.date) ?? str(parent?.date) ?? "",
    amount: minor(row.amount),
    payeeId: str(row.payee),
    categoryId: str(row.category),
    notes: str(row.notes),
    reconciled: row.reconciled === true || parent?.reconciled === true,
    transferId: str(row.transfer_id),
    isParent: row.is_parent === true,
    isChild: parent !== null || row.is_child === true,
    parentId: parent?.id ?? str(row.parent_id),
    childCount: Array.isArray(row.subtransactions) ? row.subtransactions.length : 0,
  };
}

const PREFLIGHT_KEYS: (keyof TransactionPreflight)[] = ["accountId", "date", "amount", "payeeId", "categoryId", "notes", "reconciled", "transferId", "isParent", "isChild", "parentId", "childCount"];

export function preflightDifferences(expected: TransactionPreflight, now: TransactionPreflight | null): string[] {
  if (!now) return [`${expected.id} no longer exists`];
  return PREFLIGHT_KEYS.filter((key) => expected[key] !== now[key]).map((key) => `${key} of ${expected.id}`);
}

async function requireUnchanged(primitives: StructurePrimitives, expected: TransactionPreflight): Promise<{ row: RawTxn; parent: RawTxn | null }> {
  const found = await findRaw(primitives, expected.accountId, expected.id, expected.date);
  const differences = preflightDifferences(expected, found ? preflightOf(found.row, found.parent, expected.accountId) : null);
  if (differences.length) throw new TransactionChangedError(differences);
  return found!;
}

function childOf(raw: RawTxn): StructureChild {
  return { id: raw.id, amount: minor(raw.amount), categoryId: str(raw.category), payeeId: str(raw.payee), notes: str(raw.notes), transferId: str(raw.transfer_id) };
}

/**
 * Restructure an existing, unsplit, unreconciled row into split children with
 * one `updateTransaction(id, { subtransactions })` (R-06). A child whose payee
 * is a transfer payee gets its counterpart from Actual's own transfer
 * handling. Refuses before writing on any preflight difference, on a reconciled
 * row, on an existing split, or when the children do not sum to the parent.
 */
export async function restructureAsSplit(primitives: StructurePrimitives, input: RestructureSplitInput): Promise<RestructureSplitResult> {
  if (input.expected.id !== input.transactionId || input.expected.accountId !== input.accountId) {
    throw new TransactionStructureRefusedError("The expected state does not describe this transaction.");
  }
  const { row } = await requireUnchanged(primitives, input.expected);
  if (row.reconciled === true) throw new TransactionStructureRefusedError("A reconciled transaction is never restructured.");
  if (row.is_parent === true || row.is_child === true) throw new TransactionStructureRefusedError("An existing split or split child is never restructured.");
  if (str(row.transfer_id) !== null) throw new TransactionStructureRefusedError("An existing transfer is never restructured.");
  const sum = input.children.reduce((total, child) => total + child.amount, 0);
  if (!Number.isSafeInteger(sum) || sum !== minor(row.amount)) throw new TransactionStructureRefusedError("The split children do not sum to the transaction amount.");
  if (input.children.length < 2) throw new TransactionStructureRefusedError("A split needs at least two children.");

  await primitives.update(
    input.transactionId,
    { subtransactions: input.children.map((c) => ({ amount: c.amount, category: c.categoryId, payee: c.payeeId, notes: c.notes })) },
    { accountIds: [input.accountId], sinceDate: input.expected.date }
  );

  const after = await findRaw(primitives, input.accountId, input.transactionId, input.expected.date);
  if (!after) throw new TransactionStructureRefusedError("The restructured transaction could not be read back.");
  return { parentId: after.row.id, parentAmount: minor(after.row.amount), children: (after.row.subtransactions ?? []).map(childOf) };
}

/** Read-only: does the row now hold exactly the expected split? Never writes (T124). */
export async function verifySplit(
  primitives: StructurePrimitives,
  input: { accountId: string; transactionId: string; date: string; expected: ExpectedSplitState; transferPayeeByAccount: Record<string, string> }
): Promise<{ result: RestructureVerification; children: StructureChild[] }> {
  const found = await findRaw(primitives, input.accountId, input.transactionId, input.date);
  if (!found) return { result: "mismatch", children: [] };
  const children = (found.row.subtransactions ?? []).map(childOf);
  if (found.row.is_parent !== true || children.length === 0) return { result: "not-applied", children };
  if (minor(found.row.amount) !== input.expected.parentAmount || children.length !== input.expected.children.length) return { result: "mismatch", children };
  const exact = input.expected.children.every((want, index) => {
    const got = children[index];
    const payee = want.transferAccountId ? input.transferPayeeByAccount[want.transferAccountId] ?? null : want.payeeId;
    return got.amount === want.amount && got.categoryId === want.categoryId && got.payeeId === payee && got.notes === want.notes
      && (want.transferAccountId ? got.transferId !== null : true);
  });
  return { result: exact ? "applied-exact" : "mismatch", children };
}

function counterpartPreconditions(source: TransactionPreflight, counterpart: TransactionPreflight): void {
  if (counterpart.reconciled) throw new TransactionStructureRefusedError("A reconciled row is never used as a transfer counterpart.");
  if (source.reconciled) throw new TransactionStructureRefusedError("A reconciled row is never changed.");
  if (counterpart.amount !== -source.amount) throw new TransactionStructureRefusedError("The counterpart amount must equal the source amount exactly; Actual would overwrite it.");
  if (counterpart.isParent || counterpart.isChild) throw new TransactionStructureRefusedError("A split row cannot be a transfer counterpart.");
  if (source.transferId !== null || counterpart.transferId !== null) throw new TransactionStructureRefusedError("One of the rows is already part of a transfer.");
}

/**
 * Make an existing row the counterpart of another (R-07, FR-013a): two
 * `updateTransaction` calls, source first, nothing inserted. A crash between
 * them leaves a half-linked pair that `completeTransferLink` finishes, but only
 * when the user asks.
 */
export async function linkCounterpart(primitives: StructurePrimitives, input: LinkTransferInput): Promise<LinkTransferResult> {
  const source = await requireUnchanged(primitives, input.source);
  const counterpart = await requireUnchanged(primitives, input.counterpart);
  counterpartPreconditions(input.source, input.counterpart);
  const watch = { accountIds: [input.source.accountId, input.counterpart.accountId], sinceDate: input.source.date < input.counterpart.date ? input.source.date : input.counterpart.date };

  await primitives.update(
    input.source.id,
    {
      amount: minor(source.row.amount),
      category: str(source.row.category),
      payee: input.transferPayeeId,
      notes: str(counterpart.row.notes),
      transfer_id: input.counterpart.id,
    },
    watch
  );
  await primitives.update(input.counterpart.id, { transfer_id: input.source.id }, watch);
  return readPair(primitives, input);
}

async function readPair(primitives: StructurePrimitives, input: LinkTransferInput): Promise<LinkTransferResult> {
  const source = await findRaw(primitives, input.source.accountId, input.source.id, input.source.date);
  const counterpart = await findRaw(primitives, input.counterpart.accountId, input.counterpart.id, input.counterpart.date);
  return {
    sourceId: input.source.id,
    counterpartId: input.counterpart.id,
    sourceTransferId: source ? str(source.row.transfer_id) : null,
    counterpartTransferId: counterpart ? str(counterpart.row.transfer_id) : null,
    counterpartAmount: counterpart ? minor(counterpart.row.amount) : 0,
  };
}

/**
 * Read-only detection of a half-linked pair (T131). Also looks for a stray
 * counterpart Actual inserts in the source account if the counterpart was
 * edited while half-linked, which recovery routes to Review.
 */
export async function inspectTransferLink(primitives: StructurePrimitives, input: LinkTransferInput): Promise<HalfLinkState> {
  const source = await findRaw(primitives, input.source.accountId, input.source.id, input.source.date);
  const counterpart = await findRaw(primitives, input.counterpart.accountId, input.counterpart.id, input.counterpart.date);
  if (!source || !counterpart) return { state: "changed", detail: "One of the rows no longer exists." };
  const sourceTransfer = str(source.row.transfer_id);
  const counterpartTransfer = str(counterpart.row.transfer_id);
  if (sourceTransfer === input.counterpart.id && counterpartTransfer === input.source.id) return { state: "linked" };
  if (sourceTransfer === null && counterpartTransfer === null) return { state: "not-linked" };
  if (sourceTransfer === input.counterpart.id && counterpartTransfer === null) {
    if (minor(source.row.amount) !== input.source.amount || minor(counterpart.row.amount) !== input.counterpart.amount || counterpart.row.reconciled === true) {
      return { state: "changed", detail: "An amount or the reconciled state changed while the link was incomplete." };
    }
    const strays: string[] = [];
    for (const top of await primitives.readAccount(input.source.accountId, input.counterpart.date)) {
      for (const row of [top, ...(top.subtransactions ?? [])]) {
        if (row.id !== input.source.id && str(row.transfer_id) === input.counterpart.id) strays.push(row.id);
      }
    }
    return { state: "half-linked", strayCounterpartIds: strays };
  }
  return { state: "changed", detail: "The rows are linked to something else." };
}

/**
 * Finish a half-linked pair with the second call only. Runs only from the
 * user's explicit action on an already-approved posting; refuses anything but
 * a clean half-link with no stray counterpart. Never inserts.
 */
export async function completeTransferLink(primitives: StructurePrimitives, input: LinkTransferInput): Promise<LinkTransferResult> {
  const state = await inspectTransferLink(primitives, input);
  if (state.state === "linked") return readPair(primitives, input);
  if (state.state !== "half-linked") throw new TransactionStructureRefusedError(state.state === "changed" ? state.detail : "The pair is not half-linked; nothing to complete.");
  if (state.strayCounterpartIds.length) throw new TransactionStructureRefusedError("Actual inserted a stray counterpart while the link was incomplete; review it in Actual first.");
  await primitives.update(
    input.counterpart.id,
    { transfer_id: input.source.id },
    { accountIds: [input.source.accountId, input.counterpart.accountId], sinceDate: input.source.date < input.counterpart.date ? input.source.date : input.counterpart.date }
  );
  return readPair(primitives, input);
}

/** True when this connection's reads report `transfer_id`, so a link can be verified (R-07). */
export async function readsReportTransferIds(primitives: StructurePrimitives, accountId: string, sinceDate: string): Promise<boolean> {
  const rows = await primitives.readAccount(accountId, sinceDate);
  if (rows.length === 0) return true;
  return rows.every((row) => Object.prototype.hasOwnProperty.call(row, "transfer_id"));
}
