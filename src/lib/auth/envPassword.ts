import { isPassphraseSet, resetVault, setPassphrase, verifyPassphrase } from "@/lib/connectionVault/passphrase";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { passwordFromEnv } from "./authMode";

export type EnvPasswordOutcome = "unset" | "set" | "unchanged" | "replaced";

/**
 * Apply `ACTUAL_BENCH_PASSWORD` on startup (RD-096). When set, it *is* the
 * password: it sets one on a fresh install, and it is how a forgotten password
 * is recovered. Saved connections are sealed with the old password, which no
 * one can supply, so replacing it clears them. Automations, backups and
 * unattended credentials are sealed with the operator vault key instead and
 * are not touched.
 *
 * Node-only; must never be imported into client code.
 */
export function applyEnvPassword(db: SqliteDatabase, env: NodeJS.ProcessEnv = process.env): EnvPasswordOutcome {
  const password = passwordFromEnv(env);
  if (!password) return "unset";
  if (!isPassphraseSet(db)) {
    setPassphrase(db, password);
    return "set";
  }
  if (verifyPassphrase(db, password)) return "unchanged";
  resetVault(db);
  setPassphrase(db, password);
  return "replaced";
}
