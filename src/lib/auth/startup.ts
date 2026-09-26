import { isPassphraseSet } from "@/lib/connectionVault/passphrase";
import { rememberedCredentialsSupported } from "@/lib/credentials/passphraseVaultKey";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { MIN_PASSWORD_LENGTH, authMode, passwordFromEnv, unknownAuthSetting } from "./authMode";
import { applyEnvPassword } from "./envPassword";

type Logger = { info: (message: string) => void; warn: (message: string) => void };

/**
 * Startup step (RD-096): apply `ACTUAL_BENCH_PASSWORD`, and say in the log
 * whether Actual Bench asks for a password, so an operator reading it knows
 * what a visitor meets.
 *
 * Node-only; must never be imported into client code.
 */
export function applyAuthSettings(db: SqliteDatabase, logger: Logger, env: NodeJS.ProcessEnv = process.env): void {
  const unknown = unknownAuthSetting(env);
  if (unknown) {
    logger.warn(`[auth] ACTUAL_BENCH_AUTH="${unknown}" is not "password" or "none"; asking for the password.`);
  }

  if (!rememberedCredentialsSupported()) return;

  const envPassword = passwordFromEnv(env);
  if (envPassword && envPassword.length < MIN_PASSWORD_LENGTH) {
    logger.warn(`[auth] ACTUAL_BENCH_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const outcome = applyEnvPassword(db, env);
  if (outcome === "set") logger.info("[auth] password set from ACTUAL_BENCH_PASSWORD.");
  if (outcome === "replaced") {
    logger.warn(
      "[auth] ACTUAL_BENCH_PASSWORD replaced the stored password. Saved connections were sealed with the old one and have been cleared; automations and backups are unaffected."
    );
  }

  if (authMode(env) === "none") {
    logger.warn("[auth] sign-in is off (ACTUAL_BENCH_AUTH=none): anyone who can reach Actual Bench can use it.");
  } else if (!isPassphraseSet(db)) {
    logger.info("[auth] no password yet: the first visit to Actual Bench sets it.");
  } else {
    logger.info("[auth] sign-in required.");
  }
}
