import {
  countEncryptedArtifactsForCredential,
  listBackupPolicies,
} from "@/lib/app-db/backupRepository";
import {
  deleteBackupCredential,
  listBackupCredentialMeta,
} from "@/lib/credentials/backupSecrets";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * Passphrases Bench still holds (RD-077 / PR-047).
 *
 * Deleting a backup rule used to delete its sealed passphrase with it, which
 * quietly made every encrypted backup that rule had taken unopenable. That is
 * permanent data loss caused by tidying up a setting, which is indefensible —
 * so a passphrase now outlives its rule for exactly as long as something still
 * needs it.
 *
 * The trade is a secret living longer than the object that created it, and the
 * answer to that is not to keep it forever in silence:
 *
 *   * it is **listed** in the Recovery Center, with what still depends on it;
 *   * it is **collected** automatically once the last encrypted backup using it
 *     is gone, so the retention rules eventually clean it up with no ceremony;
 *   * it can be **forgotten** deliberately, with the consequence stated.
 *
 * A backup you cannot open is worse than a secret you meant to remove.
 */

export type HeldPassphrase = {
  ref: string;
  label: string;
  createdAt: string;
  /** Whether the rule that created it still exists. */
  ruleExists: boolean;
  /** Encrypted artifacts that can only be opened with this passphrase. */
  artifactCount: number;
  /** The newest of those, so the UI can say how much is at stake. */
  newestArtifactAt: string | null;
};

/**
 * The refs a live rule is using.
 *
 * A rule's current passphrase is its `encryptionCredentialRef`. Its own id
 * counts as well: that is where every passphrase lived before a changed
 * passphrase got a ref of its own, and keeping such a secret a little longer
 * than needed is the safe direction.
 */
function refsInUse(db: SqliteDatabase): Map<string, string> {
  const inUse = new Map<string, string>();
  for (const policy of listBackupPolicies(db)) {
    inUse.set(policy.id, policy.name);
    if (policy.encryptionCredentialRef) inUse.set(policy.encryptionCredentialRef, policy.name);
  }
  return inUse;
}

export function listHeldPassphrases(db: SqliteDatabase): HeldPassphrase[] {
  const inUse = refsInUse(db);

  return listBackupCredentialMeta(db)
    .filter((credential) => credential.kind === "passphrase")
    .map((credential) => {
      // Counted in SQL over every artifact: a capped list missed the oldest
      // encrypted copies, which are exactly the ones a forgotten rule leaves.
      const { count, newestAt } = countEncryptedArtifactsForCredential(db, credential.ref);
      return {
        ref: credential.ref,
        label: credential.label || inUse.get(credential.ref) || "Backup passphrase",
        createdAt: credential.createdAt,
        ruleExists: inUse.has(credential.ref),
        artifactCount: count,
        newestArtifactAt: newestAt,
      };
    });
}

/**
 * Drop passphrases that nothing needs any more.
 *
 * Runs after anything that can remove the last encrypted copy - a prune, a
 * delete - so an orphaned secret is short-lived rather than permanent. Returns
 * the refs it collected, because "Bench forgot a passphrase" is worth being
 * able to say out loud.
 */
export function collectUnusedPassphrases(db: SqliteDatabase): string[] {
  const inUse = refsInUse(db);
  const collected: string[] = [];

  for (const credential of listBackupCredentialMeta(db)) {
    if (credential.kind !== "passphrase") continue;
    // A live rule's passphrase is in use by definition, whether or not it has
    // taken an encrypted backup yet.
    if (inUse.has(credential.ref)) continue;
    if (countEncryptedArtifactsForCredential(db, credential.ref).count > 0) continue;

    deleteBackupCredential(db, credential.ref);
    collected.push(credential.ref);
  }

  return collected;
}

/** Forget one deliberately. The caller is responsible for having warned. */
export function forgetPassphrase(db: SqliteDatabase, ref: string): void {
  deleteBackupCredential(db, ref);
}
