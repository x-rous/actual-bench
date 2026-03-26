"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Download, Upload, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStagedStore } from "@/store/staged";
import { useRules } from "../hooks/useRules";
import { useAccounts } from "@/features/accounts/hooks/useAccounts";
import { usePayees } from "@/features/payees/hooks/usePayees";
import { useCategoryGroups } from "@/features/categories/hooks/useCategoryGroups";
import { RulesTable } from "./RulesTable";
import { RuleDrawer } from "./RuleDrawer";
import { MergeRulesDialog } from "./MergeRulesDialog";
import { CONDITION_FIELDS, ACTION_FIELDS } from "../utils/ruleFields";
import { valueToString } from "../utils/rulePreview";
import type { RuleStage, ConditionsOp, ConditionOrAction } from "@/types/entities";

// ─── CSV primitives ───────────────────────────────────────────────────────────

/** Parse a single CSV line respecting double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ""; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

/** Wrap a field value in CSV-safe quotes if needed. */
function csvField(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ─── Name-resolution helpers (import) ────────────────────────────────────────

/** Look up an entity ID by name (case-insensitive). */
function findIdByName(
  map: Record<string, { entity: { id: string; name: string }; isDeleted: boolean }>,
  name: string
): string | undefined {
  const lower = name.trim().toLowerCase();
  for (const s of Object.values(map)) {
    if (!s.isDeleted && s.entity.name.trim().toLowerCase() === lower) return s.entity.id;
  }
  return undefined;
}

/**
 * Resolve a single human-readable name to its entity ID.
 * For payees: auto-creates a new staged payee if not found.
 * For categories/accounts: falls back to the raw string if not found.
 */
function resolveScalarValue(
  field: string,
  rawValue: string,
  store: ReturnType<typeof useStagedStore.getState>,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS,
  createdPayees: Map<string, string>
): { value: string; type: string } {
  const def = fieldDefs[field];
  if (!def || def.type !== "id") {
    return { value: rawValue, type: def?.type ?? "string" };
  }

  if (def.entity === "payee") {
    const lower = rawValue.trim().toLowerCase();
    if (createdPayees.has(lower)) return { value: createdPayees.get(lower)!, type: "id" };
    const existing = findIdByName(store.payees, rawValue);
    if (existing) return { value: existing, type: "id" };
    // Auto-create
    const id = crypto.randomUUID();
    store.stageNew("payees", { id, name: rawValue.trim() });
    createdPayees.set(lower, id);
    return { value: id, type: "id" };
  }

  if (def.entity === "category") {
    const existing = findIdByName(store.categories, rawValue);
    return { value: existing ?? rawValue, type: existing ? "id" : "string" };
  }

  if (def.entity === "account") {
    const existing = findIdByName(store.accounts, rawValue);
    return { value: existing ?? rawValue, type: existing ? "id" : "string" };
  }

  return { value: rawValue, type: "id" };
}

/**
 * Resolve a value that may be pipe-separated (for oneOf/notOneOf operators).
 * Returns an array of resolved IDs for multi-value ops, a scalar string otherwise.
 */
function resolveValue(
  field: string,
  op: string,
  rawValue: string,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS,
  store: ReturnType<typeof useStagedStore.getState>,
  createdPayees: Map<string, string>
): { value: ConditionOrAction["value"]; type: string } {
  const isMulti = op === "oneOf" || op === "notOneOf";
  if (isMulti && rawValue.includes("|")) {
    const parts = rawValue.split("|").map((p) => p.trim()).filter(Boolean);
    const resolved = parts.map(
      (p) => resolveScalarValue(field, p, store, fieldDefs, createdPayees).value
    );
    return { value: resolved, type: "id" };
  }
  return resolveScalarValue(field, rawValue, store, fieldDefs, createdPayees);
}

// ─── RulesView ────────────────────────────────────────────────────────────────

export function RulesView() {
  const { isLoading, isError, error, refetch } = useRules();
  // Ensure payees / categories / accounts are loaded so IDs resolve to names.
  useAccounts();
  usePayees();
  useCategoryGroups();

  const router = useRouter();
  const searchParams = useSearchParams();
  const payeeIdFilter = searchParams.get("payeeId");
  const categoryIdFilter = searchParams.get("categoryId");

  const importInputRef = useRef<HTMLInputElement>(null);

  const stagedRules     = useStagedStore((s) => s.rules);
  const stagedPayees    = useStagedStore((s) => s.payees);
  const stagedCategories = useStagedStore((s) => s.categories);
  const stagedAccounts  = useStagedStore((s) => s.accounts);
  const pushUndo        = useStagedStore((s) => s.pushUndo);
  const stageNew        = useStagedStore((s) => s.stageNew);

  const [drawerOpen, setDrawerOpen]       = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [mergeRuleIds, setMergeRuleIds]   = useState<string[]>([]);

  const ruleCount = Object.values(stagedRules).filter((s) => !s.isDeleted).length;

  function openNewRule()          { setEditingRuleId(null); setDrawerOpen(true); }
  function openEditRule(id: string) { setEditingRuleId(id); setDrawerOpen(true); }

  // Auto-open the new rule drawer when navigated here with ?new=1
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openNewRule();
      router.replace("/rules");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Export helpers ──────────────────────────────────────────────────────────

  /** Resolve an entity ID to a human-readable name for export. */
  function resolveIdToName(id: string): string {
    return (
      stagedPayees[id]?.entity.name ??
      stagedCategories[id]?.entity.name ??
      stagedAccounts[id]?.entity.name ??
      id
    );
  }

  /**
   * Convert a condition/action value to a human-readable export string.
   * - Arrays (oneOf/notOneOf): each ID resolved to a name, joined with "|"
   * - Scalar ID: resolved to a name
   * - Plain strings/numbers: converted as-is
   */
  function exportDisplayValue(coa: { value: ConditionOrAction["value"]; type?: string }): string {
    const { value, type } = coa;
    if (Array.isArray(value)) {
      return value
        .filter(Boolean)
        .map((v) => (type === "id" ? resolveIdToName(String(v)) : String(v ?? "")))
        .join("|");
    }
    const scalar = valueToString(value);
    return type === "id" && scalar ? resolveIdToName(scalar) : scalar;
  }

  // ── Export CSV ──────────────────────────────────────────────────────────────
  /**
   * Long-format export: one row per condition or action.
   * Rows belonging to the same rule share the same rule_id.
   *
   * Format:
   *   rule_id, stage, conditions_op, row_type, field, op, value
   *
   * - rule_id: the actual API rule ID (used as grouping key on re-import)
   * - stage/conditions_op: written only on the first row of each rule; blank on subsequent rows
   * - row_type: "condition" or "action"
   * - value: human-readable name for payee/category/account fields;
   *          pipe-separated for oneOf/notOneOf (e.g. "Amazon|Netflix|Uber")
   *
   * This format supports unlimited conditions and actions per rule and is
   * fully round-trippable: export → edit in Excel → re-import on a new instance.
   */
  function handleExportCsv() {
    const HEADER = "rule_id,stage,conditions_op,row_type,field,op,value";
    const lines: string[] = [HEADER];

    for (const s of Object.values(stagedRules)) {
      if (s.isDeleted) continue;
      const rule = s.entity;
      let isFirstRow = true;

      // Emit one row per condition
      for (const cond of rule.conditions) {
        lines.push([
          csvField(rule.id),
          isFirstRow ? csvField(rule.stage) : "",
          isFirstRow ? csvField(rule.conditionsOp) : "",
          "condition",
          csvField(cond.field),
          csvField(cond.op),
          csvField(exportDisplayValue(cond)),
        ].join(","));
        isFirstRow = false;
      }

      // Emit one row per action
      for (const act of rule.actions) {
        lines.push([
          csvField(rule.id),
          isFirstRow ? csvField(rule.stage) : "",
          isFirstRow ? csvField(rule.conditionsOp) : "",
          "action",
          csvField(act.field),
          csvField(act.op),
          csvField(exportDisplayValue(act)),
        ].join(","));
        isFirstRow = false;
      }

      // Guard: emit a header-only row for empty rules so they survive round-trips
      if (rule.conditions.length === 0 && rule.actions.length === 0) {
        lines.push([
          csvField(rule.id),
          csvField(rule.stage),
          csvField(rule.conditionsOp),
          "", "", "", "",
        ].join(","));
      }
    }

    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "rules.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import CSV ──────────────────────────────────────────────────────────────
  /**
   * Long-format import matching the export format above.
   *
   * Algorithm (two-pass):
   *   Pass 1 — group rows by rule_id into an in-memory map.
   *            stage/conditions_op are read from the first non-blank occurrence
   *            within each group so the file is robust to blank repeat values.
   *   Pass 2 — for each group, resolve names → IDs, build conditions + actions,
   *            and stage a new rule (a fresh UUID is always assigned; the
   *            imported rule_id is NEVER sent to the API).
   *
   * Supports:
   *   - Unlimited conditions and actions per rule
   *   - oneOf/notOneOf with pipe-separated values: "Amazon|Netflix|Uber"
   *   - Auto-creation of missing payees as staged entities
   *   - Blank stage/conditions_op on continuation rows (gracefully ignored)
   */
  function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== "string") return;

      const rawLines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (rawLines.length < 2) { toast.error("CSV has no data rows."); return; }

      // ── Parse header ──────────────────────────────────────────────────────
      const headers = parseCsvLine(rawLines[0]).map((h) => h.trim().toLowerCase());
      function col(name: string) { return headers.indexOf(name); }

      const ruleIdIdx    = col("rule_id");
      const stageIdx     = col("stage");
      const condOpIdx    = col("conditions_op");
      const rowTypeIdx   = col("row_type");
      const fieldIdx     = col("field");
      const opIdx        = col("op");
      const valueIdx     = col("value");

      if (ruleIdIdx === -1 || rowTypeIdx === -1 || fieldIdx === -1) {
        toast.error(
          'CSV must have "rule_id", "row_type", and "field" columns. ' +
          'Please use the Export function to get a correctly-formatted template.'
        );
        return;
      }

      function cellAt(row: string[], idx: number): string {
        return idx !== -1 ? row[idx]?.trim() ?? "" : "";
      }

      // ── Pass 1: group rows by rule_id ─────────────────────────────────────
      type RuleGroup = {
        stage: string;
        conditionsOp: string;
        rows: Array<{ rowType: string; field: string; op: string; rawValue: string }>;
      };

      // Use an ordered Map so rules are staged in the same order as exported.
      const groups = new Map<string, RuleGroup>();

      let parseSkipped = 0;

      for (let i = 1; i < rawLines.length; i++) {
        const row    = parseCsvLine(rawLines[i]);
        const ruleId = cellAt(row, ruleIdIdx);
        if (!ruleId) { parseSkipped++; continue; }

        if (!groups.has(ruleId)) {
          groups.set(ruleId, { stage: "", conditionsOp: "", rows: [] });
        }

        const group        = groups.get(ruleId)!;
        const stage        = cellAt(row, stageIdx);
        const conditionsOp = cellAt(row, condOpIdx);
        const rowType      = cellAt(row, rowTypeIdx);
        const field        = cellAt(row, fieldIdx);
        const op           = cellAt(row, opIdx);
        const rawValue     = cellAt(row, valueIdx);

        // Accept the first non-blank stage/conditionsOp for this group.
        if (stage && !group.stage)               group.stage        = stage;
        if (conditionsOp && !group.conditionsOp) group.conditionsOp = conditionsOp;

        // Only record rows that have a meaningful row_type and field.
        if (rowType === "condition" || rowType === "action") {
          if (field) group.rows.push({ rowType, field, op, rawValue });
        }
      }

      // ── Pass 2: build and stage rules ─────────────────────────────────────
      pushUndo();

      const store        = useStagedStore.getState();
      const createdPayees = new Map<string, string>();

      const validStages: RuleStage[]     = ["pre", "default", "post"];
      const validCondOps: ConditionsOp[] = ["and", "or"];

      let imported = 0;
      let skipped  = parseSkipped;

      for (const [, group] of groups) {
        const conditions: ConditionOrAction[] = [];
        const actions:    ConditionOrAction[] = [];

        for (const { rowType, field, op, rawValue } of group.rows) {
          if (rowType === "condition") {
            const r = resolveValue(field, op, rawValue, CONDITION_FIELDS, store, createdPayees);
            conditions.push({ field, op: op || "is", value: r.value, type: r.type });
          } else {
            // Actions always use "set"; op column is ignored on import
            const r = resolveValue(field, "set", rawValue, ACTION_FIELDS, store, createdPayees);
            actions.push({ field, op: "set", value: r.value, type: r.type });
          }
        }

        if (conditions.length === 0 && actions.length === 0) { skipped++; continue; }

        stageNew("rules", {
          id:           crypto.randomUUID(),
          stage:        validStages.includes(group.stage as RuleStage)
                          ? (group.stage as RuleStage)
                          : "default",
          conditionsOp: validCondOps.includes(group.conditionsOp as ConditionsOp)
                          ? (group.conditionsOp as ConditionsOp)
                          : "and",
          conditions,
          actions,
        });
        imported++;
      }

      // ── Toast result ──────────────────────────────────────────────────────
      if (imported === 0) {
        toast.warning(
          skipped > 0 ? `No rules imported — ${skipped} row(s) skipped.` : "No valid rules found in CSV."
        );
      } else {
        const suffix = skipped > 0 ? ` (${skipped} row(s) skipped)` : "";
        toast.success(`Imported ${imported} rule${imported !== 1 ? "s" : ""}${suffix}.`);
      }
    };

    reader.readAsText(file, "utf-8");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading rules…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive">
          {error instanceof Error ? error.message : "An error occurred"}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Rules</h1>
          <span className="text-xs text-muted-foreground">
            {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportCsv}
          />
          <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()} title="Import CSV">
            <Upload />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} title="Export CSV">
            <Download />
            Export
          </Button>
          <Button size="sm" onClick={openNewRule}>
            <Plus />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Table */}
      <RulesTable
        onEdit={openEditRule}
        onMerge={(ids) => setMergeRuleIds(ids)}
        payeeId={payeeIdFilter}
        categoryId={categoryIdFilter}
      />

      {/* Drawer */}
      <RuleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        ruleId={editingRuleId}
      />

      {/* Merge dialog */}
      <MergeRulesDialog
        open={mergeRuleIds.length >= 2}
        onOpenChange={(open) => { if (!open) setMergeRuleIds([]); }}
        ruleIds={mergeRuleIds}
      />
    </div>
  );
}
