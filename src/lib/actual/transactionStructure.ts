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
 * Binding facts from the P1.6 live tests (Actual 26.10.0, Direct and HTTP
 * identical; `assets-debt/testing/__fixtures__/p1.6-undo-evidence.json`):
 *
 * - a split is undone by deleting its children one at a time: deleting the
 *   last one makes the parent an ordinary row again with its own category, and
 *   deleting a transfer child deletes the counterpart Actual made for it;
 *   clearing `subtransactions` in one update leaves an empty split instead;
 * - a link is undone by detaching the counterpart first (`transfer_id: null`
 *   with its own payee, notes and category), then restoring the source; both
 *   rows come back exactly and nothing is inserted or deleted;
 * - a row becomes a transfer by taking the transfer payee (one counterpart is
 *   created) and stops being one by taking its own payee back (the counterpart
 *   Actual made is deleted);
 * - a transfer row that becomes a split loses its counterpart (deleted), so a
 *   transfer is restructured only when that counterpart is exactly as Actual
 *   made it; undoing the split re-creates it with a new id.
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
  /** Actual `deleteTransaction(id)`, settled like `update` in Direct mode. */
  remove(id: string, watch: { accountIds: string[]; sinceDate: string }): Promise<void>;
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
  /** Restructuring an existing transfer: its untouched Actual-made counterpart, which Actual deletes. */
  replaceCounterpart?: ReplacedCounterpart | null;
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

/** The preflight fields plus the user-visible state an exact restoration must bring back. */
export type RowState = TransactionPreflight & { cleared: boolean; importedId: string | null; importedPayee: string | null };

/** The counterpart a transfer restructure deletes; allowed only when untouched (see `untouchedCounterpartProblems`). */
export type ReplacedCounterpart = { expected: RowState; sourceAccountTransferPayeeId: string };

export type RestoreSplitInput = {
  /** The applied split parent and its children, as they must still be. */
  parent: TransactionPreflight;
  children: TransactionPreflight[];
  /** The original row the parent returns to. */
  restoreTo: RowState;
  /** Accounts holding counterparts Actual made for transfer children (deleted with them). */
  counterpartAccountIds: string[];
  /** A transfer restructure: the counterpart Actual re-creates once the parent is ordinary again. */
  recreatedCounterpart?: { accountId: string; expected: RowState } | null;
};

export type RestoreSplitResult = {
  parentId: string;
  /** Fields of the parent that differ from `restoreTo` after the undo (empty when exact). */
  differences: string[];
  /** Children or their counterparts still present after the undo. */
  leftovers: string[];
  /** The re-created counterpart, for a transfer restructure. */
  recreated?: { id: string | null; differences: string[] };
};

export type UnlinkTransferInput = {
  source: TransactionPreflight;
  counterpart: TransactionPreflight;
  sourceRestore: RowState;
  counterpartRestore: RowState;
};

export type UnlinkTransferResult = { sourceDifferences: string[]; counterpartDifferences: string[]; counterpartExists: boolean };

export type ConvertToTransferInput = { expected: TransactionPreflight; transferPayeeId: string; counterpartAccountId: string };
export type ConvertToTransferResult = { transactionId: string; transferId: string | null; counterpart: RowState | null };

export type RevertTransferInput = { converted: TransactionPreflight; counterpart: TransactionPreflight; restoreTo: RowState };
export type RevertTransferResult = { differences: string[]; counterpartRemains: boolean };

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

export function stateOf(row: RawTxn, parent: RawTxn | null, accountId: string): RowState {
  return {
    ...preflightOf(row, parent, accountId),
    cleared: row.cleared === true || (row.cleared === undefined && parent?.cleared === true),
    // Split lines carry their parent's imported fields, as Bench's transports read them.
    importedId: str(row.imported_id) ?? str(parent?.imported_id),
    importedPayee: str(row.imported_payee) ?? str(parent?.imported_payee),
  };
}

const STATE_KEYS: (keyof RowState)[] = [...PREFLIGHT_KEYS, "cleared", "importedId", "importedPayee"];

/** Every field an exact restoration compares; `ignore` names fields that may legitimately differ. */
export function stateDifferences(expected: RowState, now: RowState | null, ignore: (keyof RowState)[] = []): string[] {
  if (!now) return [`${expected.id} no longer exists`];
  return STATE_KEYS.filter((key) => !ignore.includes(key) && expected[key] !== now[key]).map((key) => `${key} of ${expected.id}`);
}

/**
 * Why a transfer's counterpart is not exactly as Actual made it. Restructuring
 * the transfer deletes the counterpart and undoing re-creates it from the
 * source, so only an untouched one can come back the same: not cleared or
 * reconciled, no imported fields, no category, the mirrored amount, date and
 * notes, and the source account's transfer payee.
 */
export function untouchedCounterpartProblems(
  source: Pick<RowState, "id" | "amount" | "date" | "notes">,
  counterpart: RowState,
  sourceAccountTransferPayeeId: string
): string[] {
  const problems: string[] = [];
  if (counterpart.transferId !== source.id) problems.push("it is not linked to this transaction");
  if (counterpart.reconciled) problems.push("it is reconciled");
  if (counterpart.cleared) problems.push("it is cleared");
  if (counterpart.importedId || counterpart.importedPayee) problems.push("it was imported (for example from the lender)");
  if (counterpart.categoryId) problems.push("it has a category");
  if (counterpart.isParent || counterpart.isChild) problems.push("it is split");
  if (counterpart.amount !== -source.amount || counterpart.date !== source.date) problems.push("its amount or date differs");
  if ((counterpart.notes ?? null) !== (source.notes ?? null)) problems.push("its notes were edited");
  if (counterpart.payeeId !== sourceAccountTransferPayeeId) problems.push("its payee was changed");
  return problems;
}

async function readState(primitives: StructurePrimitives, accountId: string, id: string, sinceDate: string): Promise<RowState | null> {
  const found = await findRaw(primitives, accountId, id, sinceDate);
  return found ? stateOf(found.row, found.parent, accountId) : null;
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
  const transferId = str(row.transfer_id);
  const replaced = input.replaceCounterpart ?? null;
  if (transferId !== null) {
    if (!replaced || replaced.expected.id !== transferId) throw new TransactionStructureRefusedError("An existing transfer is restructured only with its untouched counterpart named.");
    const counterpart = await readState(primitives, replaced.expected.accountId, replaced.expected.id, replaced.expected.date);
    const changed = stateDifferences(replaced.expected, counterpart);
    if (changed.length) throw new TransactionChangedError(changed);
    const problems = untouchedCounterpartProblems(input.expected, counterpart!, replaced.sourceAccountTransferPayeeId);
    if (problems.length) throw new TransactionStructureRefusedError(`The transfer's counterpart is not as Actual made it (${problems.join("; ")}), so splitting would destroy it. Nothing was written.`);
  } else if (replaced) {
    throw new TransactionStructureRefusedError("The transaction is not a transfer; there is no counterpart to replace.");
  }
  const sum = input.children.reduce((total, child) => total + child.amount, 0);
  if (!Number.isSafeInteger(sum) || sum !== minor(row.amount)) throw new TransactionStructureRefusedError("The split children do not sum to the transaction amount.");
  if (input.children.length < 2) throw new TransactionStructureRefusedError("A split needs at least two children.");

  await primitives.update(
    input.transactionId,
    { subtransactions: input.children.map((c) => ({ amount: c.amount, category: c.categoryId, payee: c.payeeId, notes: c.notes })) },
    { accountIds: [...new Set([input.accountId, ...(replaced ? [replaced.expected.accountId] : [])])], sinceDate: input.expected.date }
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

/**
 * Undo a restructure (T276): delete the children one at a time, which makes
 * the parent an ordinary row again and removes the counterparts Actual made,
 * then restore the parent's own payee, category and notes if they differ.
 * Refuses, writing nothing, if the split or any of its rows changed or is
 * reconciled. Returns what differs afterwards; the caller verifies.
 */
export async function restoreSplit(primitives: StructurePrimitives, input: RestoreSplitInput): Promise<RestoreSplitResult> {
  const { row } = await requireUnchanged(primitives, input.parent);
  if (row.reconciled === true) throw new TransactionStructureRefusedError("A reconciled transaction is never changed.");
  const current = (row.subtransactions ?? []).map((c) => c.id);
  if (JSON.stringify(current) !== JSON.stringify(input.children.map((c) => c.id))) throw new TransactionChangedError([`the split lines of ${input.parent.id}`]);
  for (const child of input.children) {
    const found = await requireUnchanged(primitives, child);
    if (found.row.reconciled === true) throw new TransactionStructureRefusedError("A reconciled split line is never changed.");
  }
  const counterpartIds = input.children.map((c) => c.transferId).filter((id): id is string => id !== null);
  for (const id of counterpartIds) {
    for (const accountId of input.counterpartAccountIds) {
      const found = await findRaw(primitives, accountId, id, input.parent.date);
      if (found?.row.reconciled === true) throw new TransactionStructureRefusedError("A counterpart of this split is reconciled; Bench will not delete it.");
    }
  }
  const watch = { accountIds: [...new Set([input.parent.accountId, ...input.counterpartAccountIds])], sinceDate: input.parent.date };
  for (const child of input.children) await primitives.remove(child.id, watch);

  let now = await readState(primitives, input.parent.accountId, input.parent.id, input.parent.date);
  const own = (s: RowState | null) => (s ? { payee: s.payeeId, category: s.categoryId, notes: s.notes } : null);
  if (now && !now.isParent && JSON.stringify(own(now)) !== JSON.stringify(own(input.restoreTo))) {
    await primitives.update(input.parent.id, { payee: input.restoreTo.payeeId, category: input.restoreTo.categoryId, notes: input.restoreTo.notes }, watch);
    now = await readState(primitives, input.parent.accountId, input.parent.id, input.parent.date);
  }
  const recreatedSpec = input.recreatedCounterpart ?? null;
  // A transfer restructure: the restored transfer points at the counterpart Actual re-created.
  const differences = stateDifferences(input.restoreTo, now, recreatedSpec ? ["transferId"] : []);
  const leftovers: string[] = [];
  for (const id of [...input.children.map((c) => c.id), ...counterpartIds]) {
    for (const accountId of [input.parent.accountId, ...input.counterpartAccountIds]) {
      if (await findRaw(primitives, accountId, id, input.parent.date)) leftovers.push(id);
    }
  }
  const result: RestoreSplitResult = { parentId: input.parent.id, differences, leftovers: [...new Set(leftovers)] };
  if (recreatedSpec) {
    const newId = now?.transferId ?? null;
    const recreated = newId ? await readState(primitives, recreatedSpec.accountId, newId, input.parent.date) : null;
    result.recreated = {
      id: newId,
      differences: recreated ? stateDifferences({ ...recreatedSpec.expected, transferId: input.parent.id }, recreated, ["id"]) : ["the counterpart was not re-created"],
    };
  }
  return result;
}

/**
 * Undo a counterpart link (T276): detach the counterpart first (no transfer
 * id, its own payee, notes and category), then restore the source. Actual
 * inserts and deletes nothing on this path. Refuses, writing nothing, unless
 * the pair is still linked exactly as Bench left it and neither is reconciled.
 */
export async function unlinkTransfer(primitives: StructurePrimitives, input: UnlinkTransferInput): Promise<UnlinkTransferResult> {
  const source = await requireUnchanged(primitives, input.source);
  const counterpart = await requireUnchanged(primitives, input.counterpart);
  if (input.source.transferId !== input.counterpart.id || input.counterpart.transferId !== input.source.id) throw new TransactionStructureRefusedError("The rows are no longer linked to each other.");
  if (source.row.reconciled === true || counterpart.row.reconciled === true) throw new TransactionStructureRefusedError("A reconciled row is never changed.");
  const watch = { accountIds: [...new Set([input.source.accountId, input.counterpart.accountId])], sinceDate: input.source.date < input.counterpart.date ? input.source.date : input.counterpart.date };
  const c = input.counterpartRestore;
  await primitives.update(input.counterpart.id, { transfer_id: null, payee: c.payeeId, notes: c.notes, category: c.categoryId }, watch);
  const r = input.sourceRestore;
  // A split child is replaced by exactly the fields sent, so the source always carries all of them.
  await primitives.update(input.source.id, { amount: r.amount, payee: r.payeeId, category: r.categoryId, notes: r.notes, transfer_id: null }, watch);
  const sourceNow = await readState(primitives, input.source.accountId, input.source.id, input.source.date);
  const counterpartNow = await readState(primitives, input.counterpart.accountId, input.counterpart.id, input.counterpart.date);
  return { sourceDifferences: stateDifferences(r, sourceNow), counterpartDifferences: stateDifferences(c, counterpartNow), counterpartExists: counterpartNow !== null };
}

/**
 * Make an existing payment the loan transfer (T277): its payee becomes the
 * liability's transfer payee and Actual creates the one counterpart. Refuses,
 * writing nothing, a changed, reconciled, split or already-transfer row.
 */
export async function convertToTransfer(primitives: StructurePrimitives, input: ConvertToTransferInput): Promise<ConvertToTransferResult> {
  const { row } = await requireUnchanged(primitives, input.expected);
  if (row.reconciled === true) throw new TransactionStructureRefusedError("A reconciled transaction is never changed.");
  if (row.is_parent === true || row.is_child === true) throw new TransactionStructureRefusedError("A split or split line is not converted into a transfer.");
  if (str(row.transfer_id) !== null) throw new TransactionStructureRefusedError("The transaction is already a transfer.");
  const watch = { accountIds: [...new Set([input.expected.accountId, input.counterpartAccountId])], sinceDate: input.expected.date };
  await primitives.update(input.expected.id, { payee: input.transferPayeeId }, watch);
  const now = await readState(primitives, input.expected.accountId, input.expected.id, input.expected.date);
  const transferId = now?.transferId ?? null;
  const counterpart = transferId ? await readState(primitives, input.counterpartAccountId, transferId, input.expected.date) : null;
  return { transactionId: input.expected.id, transferId, counterpart };
}

/**
 * Undo a conversion (T277): the payment takes its own payee, category and
 * notes back and Actual deletes the counterpart it made. Refuses, writing
 * nothing, if either row changed or the counterpart is reconciled.
 */
export async function revertTransferConversion(primitives: StructurePrimitives, input: RevertTransferInput): Promise<RevertTransferResult> {
  const { row } = await requireUnchanged(primitives, input.converted);
  const counterpart = await requireUnchanged(primitives, input.counterpart);
  if (row.reconciled === true || counterpart.row.reconciled === true) throw new TransactionStructureRefusedError("A reconciled row is never changed or deleted.");
  if (input.converted.transferId !== input.counterpart.id) throw new TransactionStructureRefusedError("The payment is no longer linked to the counterpart Bench recorded.");
  const watch = { accountIds: [...new Set([input.converted.accountId, input.counterpart.accountId])], sinceDate: input.converted.date };
  const r = input.restoreTo;
  await primitives.update(input.converted.id, { payee: r.payeeId, category: r.categoryId, notes: r.notes }, watch);
  const now = await readState(primitives, input.converted.accountId, input.converted.id, input.converted.date);
  const remains = (await findRaw(primitives, input.counterpart.accountId, input.counterpart.id, input.counterpart.date)) !== null;
  return { differences: stateDifferences(r, now), counterpartRemains: remains };
}

/** True when this connection's reads report `transfer_id`, so a link can be verified (R-07). */
export async function readsReportTransferIds(primitives: StructurePrimitives, accountId: string, sinceDate: string): Promise<boolean> {
  const rows = await primitives.readAccount(accountId, sinceDate);
  if (rows.length === 0) return true;
  return rows.every((row) => Object.prototype.hasOwnProperty.call(row, "transfer_id"));
}
