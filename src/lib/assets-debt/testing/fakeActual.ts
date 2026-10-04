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
 * Test facilities only (not calibrated): split grouping for
 * `updateTransaction(id, { subtransactions })`, and a crash injection point
 * before or after the next write.
 *
 * Anything else Actual does is out of scope here and covered by the live tests
 * (`patterns.live.test.ts`). Test-only: never imported by production code.
 */

export type FakeAccountSpec = { id: string; name: string; offbudget?: boolean };
export type FakeRow = Record<string, unknown> & { id: string; account: string; date: string; amount: number };
export type CrashPoint = { phase: "before-write" | "after-write"; op: "insert" | "update"; times?: number };

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
  const writes: Array<{ op: "insert" | "update"; id?: string; fields?: Record<string, unknown> }> = [];

  const accountOf = (id: string) => accounts.find((a) => a.id === id);
  const transferAccountOf = (payeeId: unknown): string | null => payees.find((p) => p.id === payeeId)?.transfer_acct ?? null;
  const find = (id: unknown) => rows.find((r) => r.id === id);

  function maybeCrash(op: "insert" | "update", phase: CrashPoint["phase"]): void {
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

  function onUpdate(row: FakeRow): void {
    if (!transferAccountOf(row.payee)) {
      clearCategory(row);
      return;
    }
    if (row.transfer_id) updateTransfer(row);
    else addTransfer(row);
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
    if (subtransactions) {
      // Test facility: split grouping. Replace any children with exactly these.
      for (const old of rows.filter((r) => r.parent_id === row.id)) rows.splice(rows.indexOf(old), 1);
      row.is_parent = subtransactions.length > 0;
      row.category = null;
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
    /** Edit a row behind Bench's back, as a user in Actual would (runs Actual's update rule). */
    editInActual(id: string, fields: Record<string, unknown>): void {
      update(id, fields);
    },

    async httpApiRequest(_conn: unknown, path: string, opts?: { method?: string; body?: unknown }): Promise<unknown> {
      const method = opts?.method ?? "GET";
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
      throw new Error(`fake actual: unexpected request ${method} ${path}`);
    },

    directRuntime(): Record<string, unknown> {
      return {
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
      };
    },
  };
}
