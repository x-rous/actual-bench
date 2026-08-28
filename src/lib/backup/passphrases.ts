import {
  listBackupArtifacts,
  listBackupPolicies,
  type BackupArtifact,
} from "@/lib/app-db/backupRepository";
import {
  deleteBackupCredential,
  listBackupCredentialMeta,
} from "@/lib/app-db/backupCredentialRepository";
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

function encryptedArtifactsFor(db: SqliteDatabase, ref: string): BackupArtifact[] {
  // Keyed on the artifact's own reference, not on its rule: deleting a rule
  // nulls the policy link by design, and that is precisely when this lookup
  // has to keep working.
  return listBackupArtifacts(db, { limit: 500 }).filter(
    (artifact) => artifact.encrypted && (artifact.encryptionCredentialRef ?? artifact.policyId) === ref
  );
}

export function listHeldPassphrases(db: SqliteDatabase): HeldPassphrase[] {
  const policies = new Map(listBackupPolicies(db).map((policy) => [policy.id, policy]));

  return listBackupCredentialMeta(db)
    .filter((credential) => credential.kind === "passphrase")
    .map((credential) => {
      const artifacts = encryptedArtifactsFor(db, credential.ref);
      return {
        ref: credential.ref,
        label: credential.label || policies.get(credential.ref)?.name || "Backup passphrase",
        createdAt: credential.createdAt,
        ruleExists: policies.has(credential.ref),
        artifactCount: artifacts.length,
        newestArtifactAt: artifacts[0]?.createdAt ?? null,
      };
    });
}

/**
 * Drop passphrases that nothing needs any more.
 *
 * Runs after anything that can remove the last encrypted copy — a prune, a
 * delete — so an orphaned secret is short-lived rather than permanent. Returns
 * the refs it collected, because "Bench forgot a passphrase" is worth being
 * able to say out loud.
 */
export function collectUnusedPassphrases(db: SqliteDatabase): string[] {
  const policyIds = new Set(listBackupPolicies(db).map((policy) => policy.id));
  const collected: string[] = [];

  for (const credential of listBackupCredentialMeta(db)) {
    if (credential.kind !== "passphrase") continue;
    // A live rule's passphrase is in use by definition, whether or not it has
    // taken an encrypted backup yet.
    if (policyIds.has(credential.ref)) continue;
    if (encryptedArtifactsFor(db, credential.ref).length > 0) continue;

    deleteBackupCredential(db, credential.ref);
    collected.push(credential.ref);
  }

  return collected;
}

/** Forget one deliberately. The caller is responsible for having warned. */
export function forgetPassphrase(db: SqliteDatabase, ref: string): void {
  deleteBackupCredential(db, ref);
}
