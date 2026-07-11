import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { clampSyncInterval, decodeFlowPlanConfig, DEFAULT_SYNC_INTERVAL_MINUTES } from "@/lib/sync/flowConfig";
import { decodeSourceFilter } from "@/lib/sync/sourceFilter";
import type { ConnectionInstance } from "@/store/connection";
import type { JsonObject, SyncFlow, SyncReviewPolicy } from "@/lib/app-db/types";
import type {
  SyncAmountDirection,
  SyncMissingPayeePolicy,
} from "@/lib/sync/flowConfig";
import type {
  SyncAmountSign,
  SyncClearedFilter,
  SyncReconciledFilter,
} from "@/lib/sync/sourceFilter";

/**
 * Flow editor form state <-> persisted flow envelopes (RD-053 / PR-019 Slice 5).
 *
 * The persisted flow stores only non-secret references (connection fingerprint,
 * budget sync id, account id, display names). The live connection (with its
 * password) is resolved at preview/apply time from the in-memory connection
 * store by fingerprint - never persisted here.
 */

export type SyncEndpointForm = {
  /** In-memory connection instance id (ephemeral; not persisted). */
  connectionId: string;
  budgetSyncId: string;
  budgetName: string;
  accountId: string;
  accountName: string;
};

export type SyncFilterForm = {
  startDate: string;
  endDate: string;
  cleared: SyncClearedFilter;
  reconciled: SyncReconciledFilter;
  amountSign: SyncAmountSign;
  minAbsAmount: string;
  maxAbsAmount: string;
  payeeInclude: string;
  payeeExclude: string;
  categoryInclude: string;
  categoryExclude: string;
  notesContains: string;
};

export type SyncTransformForm = {
  amountDirection: SyncAmountDirection;
  missingPayee: SyncMissingPayeePolicy;
  notesMarkerEnabled: boolean;
  /** Custom marker text; empty = the default `[Synced from …]` (RD-057). */
  notesMarker: string;
  copySourceNotes: boolean;
};

/** Automation policy for the flow (RD-054 / PR-020). */
export type SyncAutomationForm = {
  reviewPolicy: SyncReviewPolicy;
  /** Interval for `auto_sync_on_interval`; free text in the form, clamped on save. */
  intervalMinutes: string;
  /** Set when flow health paused the flow; cleared on re-enable. */
  autoPausedAt: string | null;
  /** Auto-map exact duplicates to their existing target instead of queuing them. */
  exactDuplicateAutoMap: boolean;
  /** Push a changed source transaction to its mapped target (RD-057 §4). */
  updateMappedTargets: boolean;
  /** Offer to delete a mapped target when its source was deleted (RD-057 §5). */
  detectDeletedSource: boolean;
  /** Sync split parents as one grouped target split (RD-057 §6). */
  createTargetSplits: boolean;
};

/** Which data type the flow syncs (RD-055). Determines the engine adapter. */
export type SyncFlowType = "transaction_sync" | "payee_sync" | "category_sync";

/** Master-data (entity) options; only meaningful for payee/category flows. */
export type SyncEntityForm = {
  /** Category-only: create categories under this group when none matches. */
  defaultGroupName: string;
  /** Category-only: create a missing target group instead of blocking. */
  createMissingGroup: boolean;
};

export type SyncFlowFormState = {
  name: string;
  enabled: boolean;
  flowType: SyncFlowType;
  source: SyncEndpointForm;
  target: SyncEndpointForm;
  filter: SyncFilterForm;
  transform: SyncTransformForm;
  automation: SyncAutomationForm;
  entity: SyncEntityForm;
};

/** True for a master-data (payee/category) flow. */
export function isEntityFlow(flowType: SyncFlowType): boolean {
  return flowType === "payee_sync" || flowType === "category_sync";
}

export const EMPTY_ENDPOINT: SyncEndpointForm = {
  connectionId: "",
  budgetSyncId: "",
  budgetName: "",
  accountId: "",
  accountName: "",
};

export function emptyFlowForm(): SyncFlowFormState {
  return {
    name: "",
    enabled: true,
    flowType: "transaction_sync",
    source: { ...EMPTY_ENDPOINT },
    target: { ...EMPTY_ENDPOINT },
    filter: {
      startDate: "",
      endDate: "",
      cleared: "any",
      reconciled: "any",
      amountSign: "any",
      minAbsAmount: "",
      maxAbsAmount: "",
      payeeInclude: "",
      payeeExclude: "",
      categoryInclude: "",
      categoryExclude: "",
      notesContains: "",
    },
    transform: {
      amountDirection: "same",
      missingPayee: "create",
      notesMarkerEnabled: true,
      notesMarker: "",
      copySourceNotes: true,
    },
    automation: {
      // Existing/new flows stay manual - RD-053 behavior - until opted in.
      reviewPolicy: "manual_preview_required",
      intervalMinutes: String(DEFAULT_SYNC_INTERVAL_MINUTES),
      autoPausedAt: null,
      exactDuplicateAutoMap: false,
      updateMappedTargets: false,
      detectDeletedSource: false,
      createTargetSplits: false,
    },
    entity: { defaultGroupName: "", createMissingGroup: false },
  };
}

/** Required route fields must be present before save/preview. */
export function missingRouteFields(form: SyncFlowFormState): string[] {
  const missing: string[] = [];
  if (!form.name.trim()) missing.push("name");
  // Entity flows sync at the budget level (no account); transactions need an account.
  if (isEntityFlow(form.flowType)) {
    if (!form.source.connectionId) missing.push("source budget");
    if (!form.target.connectionId) missing.push("target budget");
    return missing;
  }
  if (!form.source.connectionId || !form.source.accountId) missing.push("source account");
  if (!form.target.connectionId || !form.target.accountId) missing.push("target account");
  return missing;
}

/** True when source and target resolve to the same budget file. */
export function isSameBudget(form: SyncFlowFormState): boolean {
  return !!form.source.budgetSyncId && form.source.budgetSyncId === form.target.budgetSyncId;
}

/**
 * A flow that syncs an account to itself is a no-op and is always blocked. Same
 * budget but *different* accounts is allowed (RD-057 §3 same-budget sync);
 * cross-budget remains the common case.
 */
export function isSelfSync(form: SyncFlowFormState): boolean {
  return (
    isSameBudget(form) &&
    !!form.source.accountId &&
    form.source.accountId === form.target.accountId
  );
}

function splitNames(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function numOrUndefined(value: string): number | undefined {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

function endpointFingerprint(
  endpoint: SyncEndpointForm,
  instances: ConnectionInstance[]
): string {
  const instance = instances.find((i) => i.id === endpoint.connectionId);
  return instance ? connectionFingerprint(instance) : "";
}

/** Build the create/update payload sent to the sync-flows route. */
export function buildFlowPayload(
  form: SyncFlowFormState,
  instances: ConnectionInstance[]
): JsonObject {
  const sourceRef: JsonObject = {
    connectionFingerprint: endpointFingerprint(form.source, instances),
    budgetId: form.source.budgetSyncId,
    budgetName: form.source.budgetName,
    accountId: form.source.accountId,
    accountName: form.source.accountName,
  };
  const targetRef: JsonObject = {
    connectionFingerprint: endpointFingerprint(form.target, instances),
    budgetId: form.target.budgetSyncId,
    budgetName: form.target.budgetName,
    accountId: form.target.accountId,
    accountName: form.target.accountName,
  };

  const filter: JsonObject = {
    startDate: form.filter.startDate || null,
    endDate: form.filter.endDate || null,
    cleared: form.filter.cleared,
    reconciled: form.filter.reconciled,
    amountSign: form.filter.amountSign,
    minAbsAmount: numOrUndefined(form.filter.minAbsAmount) ?? null,
    maxAbsAmount: numOrUndefined(form.filter.maxAbsAmount) ?? null,
    payeeInclude: splitNames(form.filter.payeeInclude),
    payeeExclude: splitNames(form.filter.payeeExclude),
    categoryInclude: splitNames(form.filter.categoryInclude),
    categoryExclude: splitNames(form.filter.categoryExclude),
    notesContains: form.filter.notesContains || null,
    // Generated-transaction exclusion stays on in the MVP (loop prevention).
    excludeGeneratedSyncTransactions: true,
  };

  const transform: JsonObject = {
    amountDirection: form.transform.amountDirection,
    missingPayee: form.transform.missingPayee,
    notesMarkerEnabled: form.transform.notesMarkerEnabled,
    notesMarker: form.transform.notesMarker.trim() || null,
    copySourceNotes: form.transform.copySourceNotes,
  };

  // Automation/policy metadata lives in the leg `options` envelope (non-secret).
  // The interval is clamped to its floor on save so a stored value is always valid.
  const options: JsonObject = {
    reviewPolicy: form.automation.reviewPolicy,
    intervalMinutes: clampSyncInterval(form.automation.intervalMinutes),
    autoPausedAt: form.automation.autoPausedAt,
    exactDuplicateAutoMap: form.automation.exactDuplicateAutoMap,
    updateMappedTargets: form.automation.updateMappedTargets,
    detectDeletedSource: form.automation.detectDeletedSource,
    createTargetSplits: form.automation.createTargetSplits,
    // Master-data (entity) options - ignored by transaction flows.
    defaultGroupName: form.entity.defaultGroupName.trim() || null,
    createMissingGroup: form.entity.createMissingGroup,
  };

  // Each leg ref/filter/transform must be a versioned JSON envelope, matching
  // what the flow repository normalizes and what the Slice 3 decoders read.
  const envelope = (data: JsonObject) => ({ version: 1, data });

  return {
    name: form.name.trim(),
    enabled: form.enabled,
    flowType: form.flowType,
    legs: [
      {
        sourceRef: envelope(sourceRef),
        targetRef: envelope(targetRef),
        filter: envelope(filter),
        transform: envelope(transform),
        options: envelope(options),
      },
    ],
  };
}

/** Rebuild editor form state from a persisted flow, resolving live connections. */
export function flowToFormState(
  flow: SyncFlow,
  instances: ConnectionInstance[]
): SyncFlowFormState {
  const config = decodeFlowPlanConfig(flow);
  const filter = decodeSourceFilter(flow);
  const form = emptyFlowForm();

  const resolveConnectionId = (fingerprint: string, budgetSyncId: string): string => {
    const byFingerprint = fingerprint
      ? instances.find((i) => connectionFingerprint(i) === fingerprint)
      : undefined;
    const match = byFingerprint ?? instances.find((i) => i.budgetSyncId === budgetSyncId);
    return match?.id ?? "";
  };

  form.name = flow.name;
  form.enabled = flow.enabled;
  form.flowType = flow.flowType === "payee_sync" || flow.flowType === "category_sync" ? flow.flowType : "transaction_sync";
  const options = (flow.legs[0]?.options.data ?? {}) as Record<string, unknown>;
  form.entity = {
    defaultGroupName: typeof options.defaultGroupName === "string" ? options.defaultGroupName : "",
    createMissingGroup: options.createMissingGroup === true,
  };
  form.source = {
    connectionId: resolveConnectionId(config.sourceConnectionFingerprint, config.sourceBudgetId),
    budgetSyncId: config.sourceBudgetId,
    budgetName: config.sourceBudgetName,
    accountId: config.sourceAccountId,
    accountName: config.sourceAccountName,
  };
  form.target = {
    connectionId: resolveConnectionId(config.targetConnectionFingerprint, config.targetBudgetId),
    budgetSyncId: config.targetBudgetId,
    budgetName: config.targetBudgetName,
    accountId: config.targetAccountId,
    accountName: config.targetAccountName,
  };
  form.transform = {
    amountDirection: config.amountDirection,
    missingPayee: config.missingPayee,
    notesMarkerEnabled: config.notesMarkerEnabled,
    notesMarker: config.notesMarker,
    copySourceNotes: config.copySourceNotes,
  };
  form.automation = {
    reviewPolicy: config.reviewPolicy,
    intervalMinutes: String(config.intervalMinutes),
    autoPausedAt: config.autoPausedAt,
    exactDuplicateAutoMap: config.exactDuplicateAutoMap,
    updateMappedTargets: config.updateMappedTargets,
    detectDeletedSource: config.detectDeletedSource,
    createTargetSplits: config.createTargetSplits,
  };
  form.filter = {
    startDate: filter.startDate ?? "",
    endDate: filter.endDate ?? "",
    cleared: filter.cleared,
    reconciled: filter.reconciled,
    amountSign: filter.amountSign,
    minAbsAmount: filter.minAbsAmount != null ? String(filter.minAbsAmount) : "",
    maxAbsAmount: filter.maxAbsAmount != null ? String(filter.maxAbsAmount) : "",
    payeeInclude: filter.payeeInclude.join(", "),
    payeeExclude: filter.payeeExclude.join(", "),
    categoryInclude: filter.categoryInclude.join(", "),
    categoryExclude: filter.categoryExclude.join(", "),
    notesContains: filter.notesContains ?? "",
  };

  return form;
}
