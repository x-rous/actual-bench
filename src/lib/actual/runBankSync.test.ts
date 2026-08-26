import { runBankSyncForAccounts } from "./runBankSync";
import { sanitizeBankSyncError, summarizeBankSync } from "./bankSync";
import { isBankLinked, selectBankSyncTargets, type BankLinkedAccount } from "./bankSyncAccounts";

function account(overrides: Partial<BankLinkedAccount> = {}): BankLinkedAccount {
  return {
    id: "acct-1",
    name: "Checking",
    externalAccountId: "ext-1",
    syncSource: "simpleFin",
    lastSync: null,
    bankSyncStatus: null,
    closed: false,
    ...overrides,
  };
}

function withAccounts(accounts: BankLinkedAccount[]): () => Promise<BankLinkedAccount[]> {
  return async () => accounts;
}

describe("choosing which accounts to sync", () => {
  it("treats an account with no bank link as unlinked, not syncable", () => {
    expect(isBankLinked(account())).toBe(true);
    expect(isBankLinked(account({ externalAccountId: null }))).toBe(false);
    // Actual skips closed accounts too.
    expect(isBankLinked(account({ closed: true }))).toBe(false);
  });

  it("reports an explicitly requested account that is not linked, rather than throwing", () => {
    const accounts = [account(), account({ id: "acct-2", externalAccountId: null, name: "Cash" })];
    const { targets, skipped } = selectBankSyncTargets(accounts, "acct-2");

    expect(targets).toHaveLength(0);
    expect(skipped.map((a) => a.id)).toEqual(["acct-2"]);
  });
});

describe("running a bank sync", () => {
  afterEach(() => jest.restoreAllMocks());

  it("syncs each linked account separately, so one failure cannot hide the others", async () => {
    const loadAccounts = withAccounts([
      account({ id: "a", name: "Checking" }),
      account({ id: "b", name: "Savings" }),
      account({ id: "c", name: "Credit" }),
    ]);
    const triggered: string[] = [];

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async (id) => {
        triggered.push(id);
        if (id === "b") throw new Error("consent expired");
      },
    });

    // Every account was attempted; the failure did not abort the loop.
    expect(triggered).toEqual(["a", "b", "c"]);
    expect(outcome.status).toBe("partial");

    const failed = outcome.results.find((result) => result.status === "failed");
    expect(failed?.accountId).toBe("b");
    expect(failed?.accountName).toBe("Savings");
    expect(failed?.message).toBe("consent expired");
  });

  it("never reports an unlinked account as synced", async () => {
    const loadAccounts = withAccounts([account({ id: "a" }), account({ id: "b", externalAccountId: null, name: "Cash" })]);
    const triggered: string[] = [];

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async (id) => {
        triggered.push(id);
      },
    });

    // Actual would silently skip the unlinked account, so Bench must not claim
    // it synced — and must not trigger it at all.
    expect(triggered).toEqual(["a"]);
    const cash = outcome.results.find((result) => result.accountId === "b");
    expect(cash?.status).toBe("not-linked");
    expect(cash?.observedNewTransactions).toBeNull();
    expect(outcome.status).toBe("ok");
  });

  it("counts what arrived when the transport finishes the import", async () => {
    const loadAccounts = withAccounts([account({ id: "a" })]);
    let count = 10;

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async () => {
        count = 13;
      },
      countTransactions: async () => count,
    });

    expect(outcome.countsObserved).toBe(true);
    expect(outcome.results[0].observedNewTransactions).toBe(3);
    expect(outcome.results[0].status).toBe("synced");
  });

  it("says the count is unknown rather than zero when the trigger only accepts the request", async () => {
    const loadAccounts = withAccounts([account({ id: "a" })]);

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      // The HTTP endpoint answers "Bank sync started"; reading straight after
      // would be measuring nothing in particular.
      synchronous: false,
      trigger: async () => {},
      countTransactions: async () => 99,
    });

    expect(outcome.countsObserved).toBe(false);
    expect(outcome.results[0].status).toBe("accepted");
    expect(outcome.results[0].observedNewTransactions).toBeNull();
  });

  it("reports every account failing as a failure, not a partial success", async () => {
    const loadAccounts = withAccounts([account({ id: "a" }), account({ id: "b" })]);

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async () => {
        throw new Error("provider unreachable");
      },
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toBe("provider unreachable");
  });

  it("says so plainly when nothing is linked at all", async () => {
    const loadAccounts = withAccounts([account({ id: "a", externalAccountId: null })]);

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async () => {
        throw new Error("should not be called");
      },
    });

    expect(outcome.status).toBe("ok");
    expect(outcome.message).toMatch(/No accounts are linked/);
  });
});

describe("provider errors", () => {
  it("strips credential-shaped values before they reach history or the UI", () => {
    expect(sanitizeBankSyncError(new Error("401 apiKey=abcd1234efgh rejected"))).toBe(
      "401 apiKey=[redacted] rejected"
    );
    expect(sanitizeBankSyncError(new Error("Authorization: Bearer abcd1234efgh"))).toContain(
      "[redacted]"
    );
    expect(sanitizeBankSyncError(new Error("https://user:hunter2@bank.example.com failed"))).toContain(
      "[redacted]"
    );
  });

  it("caps a runaway message", () => {
    expect(sanitizeBankSyncError(new Error("x".repeat(2000))).length).toBe(500);
  });
});

describe("summarizing", () => {
  it("counts only attempted accounts when deciding the outcome", () => {
    const outcome = summarizeBankSync(
      [
        { accountId: "a", status: "synced" },
        { accountId: "b", status: "not-linked" },
      ],
      true
    );
    // One synced, one skipped: that is a clean run, not a partial one.
    expect(outcome.status).toBe("ok");
  });

  it("does not claim counts were observed when every measurement failed", async () => {
    const loadAccounts = withAccounts([account({ id: "a" }), account({ id: "b" })]);

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async () => {},
      // Intending to count is not the same as having counted.
      countTransactions: async () => {
        throw new Error("query failed");
      },
    });

    expect(outcome.countsObserved).toBe(false);
    expect(outcome.results.every((result) => result.observedNewTransactions === null)).toBe(true);
  });

  it("still reports observed counts when only some measurements failed", async () => {
    const loadAccounts = withAccounts([account({ id: "a" }), account({ id: "b" })]);
    let calls = 0;

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async () => {},
      countTransactions: async (id) => {
        if (id === "b") throw new Error("query failed");
        calls += 1;
        return calls === 1 ? 5 : 8;
      },
    });

    expect(outcome.countsObserved).toBe(true);
    expect(outcome.results.find((result) => result.accountId === "a")?.observedNewTransactions).toBe(3);
    expect(outcome.results.find((result) => result.accountId === "b")?.observedNewTransactions).toBeNull();
  });

  it("does not fabricate a count when reading the account fails", async () => {
    const loadAccounts = withAccounts([account({ id: "a" })]);

    const outcome = await runBankSyncForAccounts({
      loadAccounts,
      synchronous: true,
      trigger: async () => {},
      countTransactions: async () => {
        throw new Error("query failed");
      },
    });

    // The sync itself worked; only the measurement did not.
    expect(outcome.results[0].status).toBe("synced");
    expect(outcome.results[0].observedNewTransactions).toBeNull();
    expect(outcome.countsObserved).toBe(false);
    expect(outcome.status).toBe("ok");
  });
});
