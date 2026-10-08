/**
 * The in-memory fake Actual model for RD-084 write tests (P1.6 T111).
 *
 * It serves both of Bench's real transports, so a write test exercises the
 * production Direct and HTTP code paths end to end: `httpApiRequest` stands in
 * for `apiRequest` (HTTP mode) and `directRuntime()` for the Direct runtime.
 *
 * It implements only what T121–T127 need, calibrated against the P1.0 live
 * spike (`__fixtures__/p1.0-spike-evidence.json`, owner decision D6):
 *
 * Live-calibrated:
 * 1. `onInsert` with a transfer payee inserts one counterpart;
 * 2. `onUpdate` with a transfer payee and no `transfer_id` inserts a
 *    counterpart (this is also how editing a half-linked counterpart creates a
 *    stray row);
 * 3. `onUpdate` with both a transfer payee and a `transfer_id` calls
 *    `updateTransfer` (mirror amount, date, notes and payee onto the other row)
 *    and inserts nothing;
 * 4. category clearing: off-budget rows never keep a category, and a transfer
 *    between two on-budget accounts keeps none on either side.
 *
 * Live-calibrated in P1.6 (`__fixtures__/p1.6-undo-evidence.json`, Actual 26.10.0,
 * identical in Direct and HTTP):
 * 5. `onUpdate` without a transfer payee but with a `transfer_id` removes the
 *    transfer: a counterpart that is a split child loses its transfer id and
 *    payee; any other counterpart is deleted. Setting `transfer_id: null` in
 *    the same write detaches the row and touches nothing else.
 * 6. Deleting a row runs the same removal for its transfer. Deleting a split
 *    child leaves the parent a split while children remain; deleting the last
 *    child makes the parent an ordinary row again with its own category (a
 *    split parent keeps its category stored; reads show none), and Actual's
 *    update rule then runs on it (a transfer payee re-creates a counterpart).
 * 7. A row that becomes a split parent loses its transfer: its existing
 *    counterpart is deleted.
 *
 * Test facilities only (not calibrated): split grouping for
 * `updateTransaction(id, { subtransactions })`, and a crash injection point
 * before or after the next write.
 *
 * Anything else Actual does is out of scope here and covered by the live tests
 * (`patterns.live.test.ts`). Test-only: never imported by production code.
 */

export type FakeAccountSpec = { id: string; name: string; offbudget?: boolean };
export type FakeRow = Record<string, unknown> & { id: string; account: string; date: string; amount: number };
export type CrashPoint = { phase: "before-write" | "after-write"; op: "insert" | "update" | "delete"; times?: number };

export class InjectedCrash extends Error {
  constructor(phase: string) {
    super(`Injected crash ${phase}`);
    this.name = "InjectedCrash";
  }
}

const ROW_DEFAULTS = {
  payee: null,
  category: null,
  notes: null,
  cleared: false,
  reconciled: false,
  imported_id: null,
  imported_payee: null,
  transfer_id: null,
  is_parent: false,
  is_child: false,
  parent_id: null,
};

export type FakeActual = ReturnType<typeof createFakeActual>;

export function createFakeActual(options: { accounts: FakeAccountSpec[]; payees?: { id: string; name: string }[]; categories?: { id: string; name: string; groupId?: string }[] }) {
  const accounts = options.accounts.map((a) => ({ id: a.id, name: a.name, offbudget: a.offbudget === true, closed: false }));
  const payees: Array<{ id: string; name: string; transfer_acct: string | null }> = [
    ...(options.payees ?? []).map((p) => ({ ...p, transfer_acct: null })),
    ...accounts.map((a) => ({ id: `tp-${a.id}`, name: a.name, transfer_acct: a.id })),
  ];
  const categories = options.categories ?? [];
  const rows: FakeRow[] = [];
  let nextId = 1;
  let crash: CrashPoint | null = null;
  const writes: Array<{ op: "insert" | "update" | "delete"; id?: string; fields?: Record<string, unknown> }> = [];
  /** Behaviour 6: a split parent keeps its own category stored while reads show none. */
  const parentCategory = new Map<string, unknown>();

  const accountOf = (id: string) => accounts.find((a) => a.id === id);
  const transferAccountOf = (payeeId: unknown): string | null => payees.find((p) => p.id === payeeId)?.transfer_acct ?? null;
  const find = (id: unknown) => rows.find((r) => r.id === id);

  function maybeCrash(op: "insert" | "update" | "delete", phase: CrashPoint["phase"]): void {
    if (!crash || crash.op !== op || crash.phase !== phase) return;
    const remaining = (crash.times ?? 1) - 1;
    crash = remaining > 0 ? { ...crash, times: remaining } : null;
    throw new InjectedCrash(phase);
  }

  /** Behaviour 4: what category Actual lets a row keep. */
  function clearCategory(row: FakeRow): void {
    if (accountOf(row.account)?.offbudget) {
      row.category = null;
      return;
    }
    const target = transferAccountOf(row.payee);
    if (target && !accountOf(target)?.offbudget) row.category = null;
  }

  /** Behaviour 1/2: insert the counterpart of a transfer row. */
  function addTransfer(row: FakeRow): void {
    const target = transferAccountOf(row.payee);
    if (!target || row.is_parent) return;
    const counterpart: FakeRow = {
      ...ROW_DEFAULTS,
      id: `txn-${nextId++}`,
      account: target,
      date: row.date,
      amount: -row.amount,
      payee: `tp-${row.account}`,
      notes: row.notes ?? null,
      category: row.category ?? null,
      transfer_id: row.id,
    };
    clearCategory(counterpart);
    row.transfer_id = counterpart.id;
    clearCategory(row);
    rows.push(counterpart);
  }

  /** Behaviour 3: mirror the row onto its existing counterpart; never insert. */
  function updateTransfer(row: FakeRow): void {
    const counterpart = find(row.transfer_id);
    if (!counterpart) return;
    counterpart.amount = -row.amount;
    counterpart.date = row.date;
    counterpart.notes = row.notes ?? null;
    counterpart.payee = `tp-${row.account}`;
    clearCategory(counterpart);
    clearCategory(row);
  }

  /** Behaviours 5–7: a child counterpart is detached; any other counterpart is deleted. */
  function removeTransfer(row: FakeRow): void {
    const counterpart = find(row.transfer_id);
    if (counterpart) {
      if (counterpart.is_child) {
        counterpart.transfer_id = null;
        counterpart.payee = null;
      } else {
        rows.splice(rows.indexOf(counterpart), 1);
      }
    }
    row.transfer_id = null;
  }

  /** Actual's transfer update rule, in its own order (loot-core `transfer.onUpdate`). */
  function onUpdate(row: FakeRow): void {
    const target = transferAccountOf(row.payee);
    if (row.is_parent) {
      if (row.transfer_id) removeTransfer(row);
      return;
    }
    if (target && !row.transfer_id) addTransfer(row);
    else if (!target && row.transfer_id) removeTransfer(row);
    else if (target && row.transfer_id) updateTransfer(row);
    else clearCategory(row);
  }

  /** Behaviour 6: Actual `deleteTransaction(id)`. */
  function remove(id: string): void {
    maybeCrash("delete", "before-write");
    const row = find(id);
    if (!row) throw new Error(`fake actual: no transaction ${id}`);
    writes.push({ op: "delete", id });
    const doomed = row.is_parent ? [row, ...rows.filter((r) => r.parent_id === row.id)] : [row];
    for (const r of doomed) {
      if (r.transfer_id) removeTransfer(r);
      rows.splice(rows.indexOf(r), 1);
    }
    if (row.is_child) {
      const parent = find(row.parent_id);
      if (parent && !rows.some((r) => r.parent_id === parent.id)) {
        parent.is_parent = false;
        parent.category = parentCategory.get(parent.id) ?? null;
        parentCategory.delete(parent.id);
        onUpdate(parent);
      }
    }
    maybeCrash("delete", "after-write");
  }

  function insert(accountId: string, input: Record<string, unknown>[], runTransfers: boolean): void {
    maybeCrash("insert", "before-write");
    writes.push({ op: "insert" });
    const added: FakeRow[] = [];
    for (const t of input) {
      const { subtransactions, ...fields } = t as { subtransactions?: Record<string, unknown>[] };
      const parent: FakeRow = { ...ROW_DEFAULTS, ...fields, id: `txn-${nextId++}`, account: accountId } as unknown as FakeRow;
      if (parent.cleared === undefined) parent.cleared = true;
      rows.push(parent);
      added.push(parent);
      if (subtransactions && subtransactions.length > 0) {
        parent.is_parent = true;
        parent.category = null;
        for (const sub of subtransactions) {
          const child = { ...ROW_DEFAULTS, ...sub, id: `txn-${nextId++}`, account: accountId, date: parent.date, is_child: true, parent_id: parent.id } as unknown as FakeRow;
          rows.push(child);
          added.push(child);
        }
      }
    }
    for (const row of added) clearCategory(row);
    if (runTransfers) for (const row of added) addTransfer(row);
    maybeCrash("insert", "after-write");
  }

  /** Actual `updateTransaction(id, fields)`. */
  function update(id: string, fields: Record<string, unknown>): void {
    maybeCrash("update", "before-write");
    const row = find(id);
    if (!row) throw new Error(`fake actual: no transaction ${id}`);
    writes.push({ op: "update", id, fields });
    const { subtransactions, ...rest } = fields as { subtransactions?: Record<string, unknown>[] };
    const existing = rows.filter((r) => r.parent_id === row.id);
    const inPlace = !!subtransactions && subtransactions.length > 0 && existing.length === subtransactions.length && subtransactions.every((sub) => existing.some((c) => c.id === sub.id));
    if (subtransactions && inPlace) {
      // Live-calibrated (2026-10-06, both transports): subtransactions naming every existing child
      // update those children in place; ids stay, a transfer child's counterpart follows its amount.
      for (const sub of subtransactions) {
        const child = existing.find((c) => c.id === sub.id)!;
        for (const [key, value] of Object.entries(sub)) if (key !== "id") child[key] = value;
        if (child.transfer_id) updateTransfer(child);
        else clearCategory(child);
      }
    } else if (subtransactions) {
      // Test facility: split grouping. Replace any children with exactly these.
      for (const old of rows.filter((r) => r.parent_id === row.id)) rows.splice(rows.indexOf(old), 1);
      if (subtransactions.length > 0 && !row.is_parent) parentCategory.set(row.id, row.category ?? null);
      row.is_parent = subtransactions.length > 0;
      row.category = null;
      // Behaviour 7: a new split parent loses its transfer.
      if (row.is_parent && row.transfer_id) removeTransfer(row);
      const children: FakeRow[] = subtransactions.map(
        (sub) => ({ ...ROW_DEFAULTS, ...sub, id: `txn-${nextId++}`, account: row.account, date: row.date, cleared: row.cleared, is_child: true, parent_id: row.id }) as unknown as FakeRow
      );
      rows.push(...children);
      for (const child of children) clearCategory(child);
      for (const child of children) addTransfer(child);
    }
    for (const [key, value] of Object.entries(rest)) row[key] = value;
    if (Object.keys(rest).length > 0) onUpdate(row);
    maybeCrash("update", "after-write");
  }

  function accountRows(accountId: string): FakeRow[] {
    return rows
      .filter((r) => r.account === accountId && !r.is_child)
      .map((r) => {
        const children = rows.filter((c) => c.parent_id === r.id).map((c) => ({ ...c }));
        return children.length > 0 ? { ...r, subtransactions: children } : { ...r };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  const matchesQuery = (row: FakeRow, filter: Record<string, unknown>): boolean => Object.entries(filter).every(([field, value]) => {
    if (field === "$and") return (value as Record<string, unknown>[]).every((part) => matchesQuery(row, part));
    if (field === "$or") return (value as Record<string, unknown>[]).some((part) => matchesQuery(row, part));
    const actual = row[field];
    if (value && typeof value === "object") return Object.entries(value).every(([operator, expected]) => {
      if (operator === "$oneof") return (expected as unknown[]).includes(actual);
      if (operator === "$gte") return String(actual) >= String(expected);
      if (operator === "$lte") return String(actual) <= String(expected);
      throw new Error(`fake actual: unknown query operator ${operator}`);
    });
    return actual === value;
  });
  const queryRows = (filter: Record<string, unknown>, splits?: string) => (splits === "all"
    ? rows.map((row) => ({ ...row }))
    : accounts.flatMap((account) => accountRows(account.id))).filter((row) => matchesQuery(row as FakeRow, filter));
  return {
    rows: () => rows,
    row: (id: string) => find(id),
    accountRows,
    payees: () => payees,
    transferPayeeId: (accountId: string) => `tp-${accountId}`,
    writes: () => writes,
    /** Seed an existing row (imported, reconciled, split...). Returns its id. */
    seed(row: Omit<FakeRow, "id"> & { id?: string; subtransactions?: Record<string, unknown>[] }): string {
      const { subtransactions, ...fields } = row as { subtransactions?: Record<string, unknown>[] } & FakeRow;
      const parent = { ...ROW_DEFAULTS, ...fields, id: fields.id ?? `seed-${nextId++}` } as unknown as FakeRow;
      rows.push(parent);
      if (subtransactions?.length) {
        parent.is_parent = true;
        for (const sub of subtransactions) rows.push({ ...ROW_DEFAULTS, ...sub, id: (sub.id as string) ?? `seed-${nextId++}`, account: parent.account, date: parent.date, is_child: true, parent_id: parent.id } as unknown as FakeRow);
      }
      return parent.id;
    },
    /** Make the next matching write throw before or after it lands. */
    crashOn(point: CrashPoint): void {
      crash = point;
    },
    /** Delete a row as Actual does (behaviour 6). */
    remove,
    /** Edit a row behind Bench's back, as a user in Actual would (runs Actual's update rule). */
    editInActual(id: string, fields: Record<string, unknown>): void {
      update(id, fields);
    },

    async httpApiRequest(_conn: unknown, path: string, opts?: { method?: string; body?: unknown }): Promise<unknown> {
      const method = opts?.method ?? "GET";
      if (path === "/run-query") {
        const query = (opts?.body as { ActualQLquery: { filter: Record<string, unknown>; options?: { splits?: string } } }).ActualQLquery;
        return { data: queryRows(query.filter, query.options?.splits) };
      }
      if (path === "/payees" && method === "GET") return { data: payees };
      if (path === "/payees" && method === "POST") {
        const name = (opts?.body as { payee: { name: string } }).payee.name;
        const created = { id: `payee-${nextId++}`, name, transfer_acct: null };
        payees.push(created);
        return { data: created.id };
      }
      if (path === "/accounts" && method === "GET") return { data: accounts };
      if (path === "/categorygroups") return { data: [{ id: "grp", name: "Group", is_income: false, hidden: false, categories: categories.map((c) => ({ id: c.id, name: c.name, group_id: "grp", is_income: false, hidden: false })) }] };
      const batch = path.match(/^\/accounts\/([^/]+)\/transactions\/batch$/);
      if (batch && method === "POST") {
        const body = opts?.body as { transactions: Record<string, unknown>[]; runTransfers?: boolean };
        insert(batch[1], body.transactions, body.runTransfers || false);
        return { message: "ok" };
      }
      const list = path.match(/^\/accounts\/([^/]+)\/transactions/);
      if (list && method === "GET") {
        const since = /since_date=([^&]+)/.exec(path)?.[1];
        const from = since ? decodeURIComponent(since) : "";
        return { data: accountRows(list[1]).filter((r) => r.date >= from) };
      }
      const patch = path.match(/^\/transactions\/([^/]+)$/);
      if (patch && method === "PATCH") {
        update(patch[1], (opts?.body as { transaction: Record<string, unknown> }).transaction);
        return { message: "ok" };
      }
      if (patch && method === "DELETE") {
        remove(patch[1]);
        return { message: "ok" };
      }
      throw new Error(`fake actual: unexpected request ${method} ${path}`);
    },

    directRuntime(): Record<string, unknown> {
      return {
        q: () => {
          const query = { filterValue: {} as Record<string, unknown>, splitMode: undefined as string | undefined, filter(value: Record<string, unknown>) { this.filterValue = value; return this; }, select() { return this; }, options(value: { splits?: string }) { this.splitMode = value.splits; return this; }, orderBy() { return this; } };
          return query;
        },
        runQuery: async (query: { filterValue: Record<string, unknown>; splitMode?: string }) => ({ data: queryRows(query.filterValue, query.splitMode) }),
        getAccounts: async () => accounts,
        getPayees: async () => payees,
        getCategories: async () => categories.map((c) => ({ id: c.id, name: c.name, group_id: "grp" })),
        getCategoryGroups: async () => [{ id: "grp", name: "Group", is_income: false, hidden: false, categories: categories.map((c) => ({ id: c.id, name: c.name, group_id: "grp" })) }],
        createPayee: async ({ name }: { name: string }) => {
          const id = `payee-${nextId++}`;
          payees.push({ id, name, transfer_acct: null });
          return id;
        },
        addTransactions: async (accountId: string, input: Record<string, unknown>[], opts?: { runTransfers?: boolean }) => {
          insert(accountId, input, opts?.runTransfers ?? false);
          return "ok";
        },
        getTransactions: async (accountId: string, start: string, end: string) =>
          accountRows(accountId).filter((r) => (!start || r.date >= start) && (!end || r.date <= end)),
        updateTransaction: async (id: string, fields: Record<string, unknown>) => {
          update(id, fields);
          return "ok";
        },
        deleteTransaction: async (id: string) => {
          remove(id);
          return "ok";
        },
      };
    },
  };
}
