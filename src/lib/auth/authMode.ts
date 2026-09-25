/**
 * Whether Actual Bench asks for its password (RD-096). One password: the app
 * password is the saved-connections vault password, and signing in unlocks it.
 *
 * Reads only the environment, so the proxy can call it on every request.
 */

export type AuthMode = "password" | "none";

export const MIN_PASSWORD_LENGTH = 8;

export function authMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  // The public demo runs on Vercel with a throwaway database, where a password
  // could not be kept. Nothing there is private.
  if (env.DEMO_MODE === "1" || env.VERCEL) return "none";
  // Anything but an explicit "none" asks for the password: a typo fails closed.
  return env.ACTUAL_BENCH_AUTH?.trim().toLowerCase() === "none" ? "none" : "password";
}

/** `ACTUAL_BENCH_AUTH` set to something other than the two known values. */
export function unknownAuthSetting(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.ACTUAL_BENCH_AUTH?.trim();
  if (!value) return null;
  return ["password", "none"].includes(value.toLowerCase()) ? null : value;
}

/** The operator-supplied password, when `ACTUAL_BENCH_PASSWORD` is set. */
export function passwordFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.ACTUAL_BENCH_PASSWORD;
  return value && value.trim() ? value : null;
}
