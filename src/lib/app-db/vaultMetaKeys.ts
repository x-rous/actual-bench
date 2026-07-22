/**
 * `app_meta` keys for the remembered-connection vault. Kept in their own leaf
 * module (no imports) so both the repositories/passphrase lifecycle and the
 * schema migrations can reference them without an import cycle — `migrations.ts`
 * must not depend on the repositories it migrates.
 */
export const SALT_META_KEY = "connection_vault_salt";
export const KDF_VERSION_META_KEY = "connection_vault_kdf_version";
export const VERIFIER_META_KEY = "connection_vault_verifier";
