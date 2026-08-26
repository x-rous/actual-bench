import { bankSyncJobType } from "./bankSync";
import type { AutomationRunContext } from "../registry";
import type { BankSyncConfig } from "./bankSync";
import { BANK_SYNC_JOB_TYPE } from "./bankSyncType";
import type { BankSyncOutcome } from "@/lib/actual/bankSync";

function outcome(overrides: Partial<BankSyncOutcome> = {}): BankSyncOutcome {
  return { status: "ok", results: [], countsObserved: true, ...overrides };
}

describe("bank sync job type", () => {
  it("contributes nothing to the review queue, because it constructs nothing", () => {
    // The case the optional `classification` field exists for: this type asks
    // Actual to run its own import, so there is no staged work to review and it
    // must be absent from the queue rather than listed with a zero.
    expect(bankSyncJobType.classification).toBeUndefined();
    expect(bankSyncJobType.type).toBe(BANK_SYNC_JOB_TYPE);
  });

  it("refuses a configuration with no connection, in words a person can act on", () => {
    expect(() => bankSyncJobType.validateConfig({ version: 1, data: {} })).toThrow(
      /no connection to sync/
    );
  });

  it("stores 'every linked account' rather than a snapshot of account ids", () => {
    // An empty selection means all, so an account linked next month is included
    // without anyone remembering to edit the automation.
    expect(
      bankSyncJobType.validateConfig({ version: 1, data: { connectionFingerprint: "srv-1" } })
    ).toEqual({ connectionFingerprint: "srv-1", accountIds: [] });

    expect(
      bankSyncJobType.validateConfig({
        version: 1,
        data: { connectionFingerprint: " srv-1 ", accountIds: ["a", 7, "b"] },
      })
    ).toEqual({ connectionFingerprint: "srv-1", accountIds: ["a", "b"] });
  });

  it("does not let one unreachable bank count against the automation's health", () => {
    const rollup = bankSyncJobType.summarize(
      outcome({
        status: "partial",
        results: [
          { accountId: "a", accountName: "Checking", status: "synced", observedNewTransactions: 4 },
          { accountId: "b", accountName: "Savings", status: "failed", message: "consent expired" },
        ],
      })
    );

    expect(rollup.outcome).toBe("partial");
    // Budget File Sync makes the opposite choice, because a partial *apply*
    // there means writes failed. Here it means a bank was unreachable, and
    // pausing the automation would stop the accounts that do work.
    expect(rollup.countsAsFailure).toBeUndefined();
    expect(rollup.message).toMatch(/4 new transactions in 1 account/);
    expect(rollup.message).toMatch(/1 failed/);
  });

  it("reports every account failing as a failure", () => {
    const rollup = bankSyncJobType.summarize(
      outcome({
        status: "failed",
        results: [
          { accountId: "a", status: "failed", message: "unreachable" },
          { accountId: "b", status: "failed", message: "unreachable" },
        ],
      })
    );

    expect(rollup.outcome).toBe("failed");
    expect(rollup.itemCount).toBe(2);
  });

  it("says nothing is linked rather than claiming a clean run", () => {
    const rollup = bankSyncJobType.summarize(
      outcome({ results: [{ accountId: "a", accountName: "Cash", status: "not-linked" }] })
    );

    expect(rollup.outcome).toBe("no_changes");
    expect(rollup.message).toMatch(/No accounts are linked to a bank/);
  });

  it("never quotes a transaction count the transport did not measure", () => {
    const rollup = bankSyncJobType.summarize(
      outcome({
        countsObserved: false,
        results: [
          { accountId: "a", status: "accepted", observedNewTransactions: null },
          { accountId: "b", status: "accepted", observedNewTransactions: null },
        ],
      })
    );

    expect(rollup.message).toBe("Sync started for 2 accounts");
    expect(rollup.message).not.toMatch(/new transaction/);
    expect(rollup.message).not.toMatch(/\b0\b/);
  });

  it("distinguishes a measured zero from an unmeasured one", () => {
    const rollup = bankSyncJobType.summarize(
      outcome({
        countsObserved: true,
        results: [{ accountId: "a", status: "synced", observedNewTransactions: 0 }],
      })
    );

    expect(rollup.message).toBe("No new transactions in 1 account");
  });

  it("keeps per-account detail in its own result payload", () => {
    const serialized = bankSyncJobType.serializeResult(
      outcome({
        status: "partial",
        countsObserved: true,
        results: [
          { accountId: "a", accountName: "Checking", status: "synced", observedNewTransactions: 4 },
          { accountId: "b", accountName: "Savings", status: "failed", message: "consent expired" },
        ],
      })
    );

    const accounts = serialized.data.accounts as unknown as { accountId: string; status: string }[];
    expect(accounts).toHaveLength(2);
    expect(accounts[1]).toEqual({
      accountId: "b",
      accountName: "Savings",
      status: "failed",
      message: "consent expired",
      observedNewTransactions: null,
    });
    // Nothing here borrows Budget File Sync's vocabulary.
    expect(Object.keys(serialized.data)).not.toContain("applied");
  });

  it("reports an unavailable transport as a failure, not as an empty success", () => {
    const rollup = bankSyncJobType.summarize(
      outcome({ status: "unsupported", results: [], countsObserved: false, message: "not available" })
    );

    expect(rollup.outcome).toBe("failed");
    expect(rollup.message).toBe("not available");
  });

  it("refuses a config naming a different connection than the credential the engine checked", async () => {
    // The engine fails closed on `definition.credentialRef`. Reading the vault
    // by the fingerprint in this type's own config would use a credential that
    // was never checked, so the two are required to agree.
    const ctx = {
      config: { connectionFingerprint: "srv-OTHER", accountIds: [] } as BankSyncConfig,
      credentials: {
        status: "resolved" as const,
        serverFingerprint: "srv-1",
        reveal: () => ({ apiKey: "should-not-be-used" }),
      },
      definition: {} as never,
      attempt: 1,
      signal: new AbortController().signal,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      reportProgress: () => {},
    } as unknown as AutomationRunContext<BankSyncConfig>;

    await expect(bankSyncJobType.run(ctx)).rejects.toThrow(/does not match the credential/);
  });

  it("refuses to run without a resolved credential", async () => {
    const ctx = {
      config: { connectionFingerprint: "srv-1", accountIds: [] } as BankSyncConfig,
      credentials: { status: "unavailable" as const, reason: "vault disabled" },
      definition: {} as never,
      attempt: 1,
      signal: new AbortController().signal,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      reportProgress: () => {},
    } as unknown as AutomationRunContext<BankSyncConfig>;

    await expect(bankSyncJobType.run(ctx)).rejects.toThrow(/no usable credential/);
  });
});
