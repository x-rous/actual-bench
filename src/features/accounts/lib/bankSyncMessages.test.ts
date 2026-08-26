import { bankSyncMessage } from "./bankSyncMessages";
import type { BankSyncAccountResult, BankSyncOutcome } from "@/lib/actual/bankSync";

function outcome(
  results: BankSyncAccountResult[],
  overrides: Partial<BankSyncOutcome> = {}
): BankSyncOutcome {
  return { status: "ok", results, countsObserved: true, ...overrides };
}

describe("what a manual bank sync tells the user", () => {
  it("quotes a count only when Bench actually measured one", () => {
    const message = bankSyncMessage(
      outcome([{ accountId: "a", accountName: "Checking", status: "synced", observedNewTransactions: 4 }])
    );

    expect(message.tone).toBe("success");
    expect(message.text).toBe("4 new transactions in 1 account.");
  });

  it("says the sync started, without a number, when the transport only accepted it", () => {
    const message = bankSyncMessage(
      outcome(
        [{ accountId: "a", accountName: "Checking", status: "accepted", observedNewTransactions: null }],
        { countsObserved: false }
      )
    );

    expect(message.tone).toBe("success");
    expect(message.text).toMatch(/Bank sync started for 1 account/);
    // The thing this feature must never do: report an unmeasured zero.
    expect(message.text).not.toMatch(/\b0 new transactions\b/);
    expect(message.text).toMatch(/may take a moment to appear/);
  });

  it("distinguishes a measured zero from an unknown one", () => {
    const message = bankSyncMessage(
      outcome([{ accountId: "a", status: "synced", observedNewTransactions: 0 }])
    );

    expect(message.text).toBe("No new transactions in 1 account.");
  });

  it("names the accounts that failed, and keeps the ones that worked", () => {
    const message = bankSyncMessage(
      outcome(
        [
          { accountId: "a", accountName: "Checking", status: "synced", observedNewTransactions: 2 },
          { accountId: "b", accountName: "Savings", status: "failed", message: "consent expired" },
        ],
        { status: "partial" }
      )
    );

    expect(message.tone).toBe("warning");
    expect(message.text).toMatch(/2 new transactions in 1 account/);
    expect(message.text).toMatch(/1 account failed/);
    expect(message.detail).toBe("Savings: consent expired");
  });

  it("is an error when every account failed", () => {
    const message = bankSyncMessage(
      outcome(
        [
          { accountId: "a", accountName: "Checking", status: "failed", message: "unreachable" },
          { accountId: "b", accountName: "Savings", status: "failed", message: "unreachable" },
        ],
        { status: "failed" }
      )
    );

    expect(message.tone).toBe("error");
    expect(message.text).toBe("Bank sync failed for 2 accounts.");
  });

  it("explains an empty run rather than claiming success", () => {
    const message = bankSyncMessage(
      outcome([{ accountId: "a", accountName: "Cash", status: "not-linked" }])
    );

    expect(message.tone).toBe("warning");
    expect(message.text).toMatch(/No accounts are linked to a bank/);
  });

  it("says plainly when the connection cannot do this at all", () => {
    const message = bankSyncMessage(
      outcome([], { status: "unsupported", message: "This Actual version does not expose a bank sync trigger." })
    );

    expect(message.tone).toBe("error");
    expect(message.text).toMatch(/does not expose a bank sync trigger/);
  });
});
