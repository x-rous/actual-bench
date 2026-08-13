import {
  DEFAULT_APPLY_CONFIG,
  type ApplyConfig,
} from "@/lib/reconciliation/session/plan";

/**
 * Restore the Review-only enrichment choice when returning to Reconcile.
 *
 * Historical settings are never reset: after Apply starts, the persisted
 * config describes what was executed and is part of the reconciliation audit.
 */
export function applyConfigAfterLeavingReview(
  config: ApplyConfig,
  writeSettingsLocked: boolean
): ApplyConfig {
  if (
    writeSettingsLocked ||
    config.enrichImportedPayee === DEFAULT_APPLY_CONFIG.enrichImportedPayee
  ) {
    return config;
  }

  return {
    ...config,
    enrichImportedPayee: DEFAULT_APPLY_CONFIG.enrichImportedPayee,
  };
}
