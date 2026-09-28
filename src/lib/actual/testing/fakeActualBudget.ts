/**
 * An in-memory Actual budget for transport tests, with Actual's transfer rule.
 *
 * Actual's `batchUpdateTransactions` runs `onInsert` for every added row when
 * `runTransfers` is on: a non-parent row whose payee is a transfer payee gets a
 * counterpart in the other account (`addTransfer`: negated amount, the source
 * account's transfer payee, reciprocal `transfer_id`). With it off, the row is
 * written alone. actual-http-api forwards `runTransfers` from the request body
 * and defaults it to false; the Direct runtime passes it through `addTransactions`.
 *
 * Both transports can be pointed at one instance, so a test can assert that the
 * same create produces the same rows in Direct and HTTP mode. Test-only: never
 * imported by production code.
 */

type Row = Record<string, unknown> & { id: string; account: string; date: string; amount: number };

export type FakeAccount = { id: string; name: string };

export type FakeActualBudget = {
  /** Every row in the budget, split children included. */
  rows(): Row[];
  /** Top-level rows of one account, as Actual lists them. */
  accountRows(accountId: string): Row[];
  /** Every payee in the budget, transfer payees included. */
  payees(): Array<{ id: string; name: string; transfer_acct: string | null }>;
  /** The id of the transfer payee that points at `accountId`. */
  transferPayeeId(accountId: string): string;
  /** Options received by each insert, for asserting what the transport sent. */
  insertOptions(): Array<{ runTransfers: boolean; learnCategories: unknown }>;
  /** `apiRequest` implementation for the HTTP transport (mock it with this). */
  httpApiRequest(conn: unknown, path: string, opts?: { method?: string; body?: unknown }): Promise<unknown>;
  /** Runtime for the Direct transport (return it from the mocked runtime getter). */
  directRuntime(): Record<string, unknown>;
};

export function createFakeActualBudget(options: {
  accounts: FakeAccount[];
  payees?: { id: string; name: string }[];
}): FakeActualBudget {
  const payees: Array<{ id: string; name: string; transfer_acct: string | null }> = [
    ...(options.payees ?? []).map((p) => ({ ...p, transfer_acct: null })),
    // Actual lists transfer payees under the account's name.
    ...options.accounts.map((a) => ({ id: `tp-${a.id}`, name: a.name, transfer_acct: a.id })),
  ];
  const rows: Row[] = [];
  const inserts: Array<{ runTransfers: boolean; learnCategories: unknown }> = [];
  let nextId = 1;

  const transferAccountOf = (payeeId: unknown): string | null =>
    payees.find((p) => p.id === payeeId)?.transfer_acct ?? null;

  function addTransfer(row: Row): void {
    const target = transferAccountOf(row.payee);
    if (!target || row.is_parent) return;
    const counterpart: Row = {
      id: `txn-${nextId++}`,
      account: target,
      date: row.date,
      amount: -row.amount,
      payee: `tp-${row.account}`,
      notes: row.notes ?? null,
      cleared: false,
      transfer_id: row.id,
    };
    row.transfer_id = counterpart.id;
    rows.push(counterpart);
  }

  function insert(accountId: string, input: Record<string, unknown>[], runTransfers: boolean): void {
    const added: Row[] = [];
    for (const t of input) {
      const { subtransactions, ...fields } = t as { subtransactions?: Record<string, unknown>[] };
      const parent: Row = { ...fields, id: `txn-${nextId++}`, account: accountId } as Row;
      rows.push(parent);
      added.push(parent);
      if (subtransactions && subtransactions.length > 0) {
        parent.is_parent = true;
        for (const sub of subtransactions) {
          const child: Row = {
            ...sub,
            id: `txn-${nextId++}`,
            account: accountId,
            date: parent.date,
            is_child: true,
            parent_id: parent.id,
          } as unknown as Row;
          rows.push(child);
          added.push(child);
        }
      }
    }
    // Transfers run after every row is written, as in `batchUpdateTransactions`.
    if (runTransfers) for (const row of added) addTransfer(row);
  }

  function accountRows(accountId: string): Row[] {
    return rows
      .filter((r) => r.account === accountId && !r.is_child)
      .map((r) => {
        const children = rows.filter((c) => c.parent_id === r.id);
        return children.length > 0 ? { ...r, subtransactions: children } : r;
      });
  }

  return {
    rows: () => rows,
    accountRows,
    payees: () => payees,
    transferPayeeId: (accountId) => `tp-${accountId}`,
    insertOptions: () => inserts,

    async httpApiRequest(_conn, path, opts) {
      const method = opts?.method ?? "GET";
      if (path === "/payees" && method === "GET") return { data: payees };
      if (path === "/payees" && method === "POST") {
        const name = (opts?.body as { payee: { name: string } }).payee.name;
        const created = { id: `payee-${nextId++}`, name, transfer_acct: null };
        payees.push(created);
        // actual-http-api returns the new payee's id alone.
        return { data: created.id };
      }
      if (path === "/categorygroups") return { data: [] };
      const batch = path.match(/^\/accounts\/([^/]+)\/transactions\/batch$/);
      if (batch && method === "POST") {
        const body = opts?.body as { transactions: Record<string, unknown>[]; runTransfers?: boolean; learnCategories?: unknown };
        // actual-http-api: `runTransfers: req.body.runTransfers || false`.
        const runTransfers = body.runTransfers || false;
        inserts.push({ runTransfers, learnCategories: body.learnCategories });
        insert(batch[1], body.transactions, runTransfers);
        return { message: "ok" };
      }
      const list = path.match(/^\/accounts\/([^/]+)\/transactions/);
      if (list && method === "GET") {
        const since = /since_date=([^&]+)/.exec(path)?.[1];
        const from = since ? decodeURIComponent(since) : "";
        return { data: accountRows(list[1]).filter((r) => r.date >= from) };
      }
      throw new Error(`fake budget: unexpected request ${method} ${path}`);
    },

    directRuntime() {
      return {
        getPayees: async () => payees,
        getCategories: async () => [],
        createPayee: async ({ name }: { name: string }) => {
          const id = `payee-${nextId++}`;
          payees.push({ id, name, transfer_acct: null });
          return id;
        },
        addTransactions: async (
          accountId: string,
          input: Record<string, unknown>[],
          opts?: { runTransfers?: boolean; learnCategories?: unknown }
        ) => {
          const runTransfers = opts?.runTransfers ?? false;
          inserts.push({ runTransfers, learnCategories: opts?.learnCategories });
          insert(accountId, input, runTransfers);
          return "ok";
        },
        getTransactions: async (accountId: string, start: string, end: string) =>
          accountRows(accountId).filter((r) => (!start || r.date >= start) && (!end || r.date <= end)),
      };
    },
  };
}
