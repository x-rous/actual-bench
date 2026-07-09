import type {
  SyncCapabilityReport,
  SyncDuplicateConfidence,
  SyncEntityType,
  SyncItemClassification,
  SyncMapping,
} from "@/lib/app-db/types";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { SyncFlowPlanConfig } from "./flowConfig";

/**
 * Planner-level shapes for Budget File Sync dry-run planning (RD-053 / PR-019).
 * Everything here is headless and Actual-write-free.
 */

/** What apply would do for a planned item. */
export type SyncPlannedAction = "create" | "skip" | "blocked";

/**
 * Non-exclusive annotations attached to a planned item. These are the "rich
 * internal classifications" that the coarse UI labels group over, and that
 * background sync will lean on later.
 */
export type SyncPlanFlag =
  | "missing_payee_created_on_apply"
  | "missing_payee_left_empty"
  | "missing_category_left_empty"
  | "target_rules_may_modify"
  | "source_changed_since_sync"
  | "target_marker_match_repair"
  | "duplicate_review"
  | "exact_duplicate_auto_map"
  | "blocked_no_marker"
  | "split_fallback_key";

/** The transaction the engine would create on the target (create-only, no splits). */
export type PlannedTargetPayload = {
  accountId: string;
  date: string;
  amount: number;
  payeeId: string | null;
  /** Set when a payee must be created on apply (no existing match). */
  payeeName: string | null;
  categoryId: string | null;
  notes: string | null;
  cleared: boolean;
  /** Deterministic durable marker; required for every create candidate. */
  importedId: string | null;
};

/**
 * The master-data entity the engine would create on the target (RD-055). A
 * discriminated alternative to the transaction payload; both are stored as plain
 * JSON on the run item and read back by the kind-specific apply adapter.
 */
export type EntityTargetPayload = {
  entity: "payee" | "category";
  name: string;
  /** Category kind; carried so income/expense stay distinct. */
  incomeKind?: "income" | "expense";
  /** Resolved target group id a category will be created under (categories only). */
  groupId?: string | null;
  /** Target group display name (categories only). */
  groupName?: string | null;
};


/** Source-side display snapshot, persisted so the preview can show both sides. */
export type PlannedSourceSnapshot = {
  date: string;
  amount: number;
  payeeName: string | null;
  categoryName: string | null;
  notes: string | null;
};

export type SyncPlannedItem = {
  sourceItemKey: string;
  sourceEntityType: SyncEntityType;
  sourceTransactionId: string;
  sourceSplitId: string | null;
  sourceFingerprint: string;
  usedFallbackKey: boolean;
  source: PlannedSourceSnapshot;
  classification: SyncItemClassification;
  duplicateConfidence: SyncDuplicateConfidence;
  action: SyncPlannedAction;
  flags: SyncPlanFlag[];
  selectedForApply: boolean;
  /** Transaction create payload; present for transaction create candidates. */
  plannedTargetPayload: PlannedTargetPayload | null;
  /** Master-data entity create payload (RD-055); present for entity candidates. */
  entityPayload?: EntityTargetPayload | null;
  /** Known target transaction/entity id for already-synced / matched items. */
  targetTransactionId: string | null;
  message: string | null;
};

export type SyncPlanResult = {
  flowId: string;
  items: SyncPlannedItem[];
  /** Count of items per primary classification. */
  counts: Record<string, number>;
};

// --- Planner input snapshots (fixture-friendly; no DB/Actual access) --------

export type SyncPlannerPayee = { id: string; name: string };
export type SyncPlannerCategory = { id: string; name: string };

/** Minimal target transaction shape used for duplicate detection. */
export type SyncTargetTransactionForDedupe = {
  id: string;
  date: string;
  amount: number;
  payeeName: string | null;
  categoryId: string | null;
};

export type SyncPlannerTargetSnapshot = {
  payees: SyncPlannerPayee[];
  categories: SyncPlannerCategory[];
  /** Existing target `imported_id` -> target transaction id. */
  importedIdIndex: Map<string, string>;
  /** Target transactions in range for duplicate classification. */
  transactions: SyncTargetTransactionForDedupe[];
};

export type SyncPlannerInput = {
  config: SyncFlowPlanConfig;
  capabilities: SyncCapabilityReport;
  /** Fully materialized source snapshot (already filtered upstream). */
  sourceTransactions: SyncSourceTransaction[];
  target: SyncPlannerTargetSnapshot;
  existingMappings: SyncMapping[];
};
