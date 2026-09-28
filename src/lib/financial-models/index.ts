/**
 * Assets & Debt financial models (RD-084): pure, deterministic calculation.
 *
 * Nothing under this folder may import the app database, the Actual transport,
 * the automation engine, credentials, providers, React or Next. The rule is
 * enforced by `no-restricted-imports` in eslint.config.mjs, so a calculation
 * can always be reproduced from its recorded inputs alone.
 */
export {};
