import { selectBankSyncTargets } from "./bankSyncAccounts";
import { sanitizeBankSyncError, summarizeBankSync } from "./bankSync";
import type { BankSyncAccountResult, BankSyncOutcome } from "./bankSync";
import type { BankLinkedAccount } from "./bankSyncAccounts";

/**
 * The shared bank-sync run (RD-080 / PR-044).
 *
 * Both transports discover accounts the same way (one ActualQL read) and differ
 * only in how a single account's sync is triggered, so the loop, the failure
 * isolation and the honesty rules live here once.
 */

export type TriggerAccountSync = (accountId: string) => Promise<void>;

export type RunBankSyncOptions = {
  /**
   * Where the account list comes from. Passed in rather than imported so the
   * loop has no hidden dependency: each transport supplies the shared ActualQL
   * read bound to its own connection, and a test supplies a fixture.
   */
  loadAccounts: () => Promise<BankLinkedAccount[]>;
  /** Trigger one account. Rejects on failure. */
  trigger: TriggerAccountSync;
  /**
   * Whether the trigger returning means the import has *finished*.
   *
   * Direct is synchronous — `api/bank-sync` awaits the pull — so a post-run read
   * sees the imported rows. The HTTP endpoint answers `"Bank sync started"` and
   * has not been verified against a live server, so it is treated as accepted
   * and Bench does not claim to know what arrived.
   */
  synchronous: boolean;
  /** Count transactions in an account, when the transport can. */
  countTransactions?: (accountId: string) => Promise<number>;
  accountId?: string;
};

function accountResult(
  account: BankLinkedAccount,
  status: BankSyncAccountResult["status"],
  extra: Partial<BankSyncAccountResult> = {}
): BankSyncAccountResult {
  return { accountId: account.id, accountName: account.name, status, ...extra };
}

export async function runBankSyncForAccounts(
  options: RunBankSyncOptions
): Promise<BankSyncOutcome> {
  const accounts = await options.loadAccounts();
  const { targets, skipped } = selectBankSyncTargets(accounts, options.accountId);

  const results: BankSyncAccountResult[] = skipped.map((account) =>
    accountResult(account, "not-linked", {
      message: account.closed ? "This account is closed." : "This account is not linked to a bank.",
      observedNewTransactions: null,
    })
  );

  for (const account of targets) {
    // Counting is only meaningful when the trigger is synchronous *and* the
    // transport can read transactions; otherwise the number is reported as
    // unknown rather than as zero.
    const canCount = options.synchronous && Boolean(options.countTransactions);
    let before: number | null = null;
    if (canCount && options.countTransactions) {
      before = await options.countTransactions(account.id).catch(() => null);
    }

    try {
      // One call per account. The all-accounts endpoint throws on the first
      // failure and cannot attribute it, so isolation depends on this loop.
      await options.trigger(account.id);
    } catch (error) {
      results.push(
        accountResult(account, "failed", {
          message: sanitizeBankSyncError(error),
          observedNewTransactions: null,
        })
      );
      continue;
    }

    let observed: number | null = null;
    if (canCount && before !== null && options.countTransactions) {
      const after = await options.countTransactions(account.id).catch(() => null);
      observed = after === null ? null : Math.max(after - before, 0);
    }

    results.push(
      accountResult(account, options.synchronous ? "synced" : "accepted", {
        observedNewTransactions: observed,
      })
    );
  }

  return summarizeBankSync(results, options.synchronous && Boolean(options.countTransactions));
}
