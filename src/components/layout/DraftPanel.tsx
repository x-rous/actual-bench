"use client";

import { useMemo } from "react";
import { useStagedStore, selectHasChanges } from "@/store/staged";
import { CONDITION_FIELDS, ACTION_FIELDS } from "@/features/rules/utils/ruleFields";
import { rulePreview, valueToString } from "@/features/rules/utils/rulePreview";
import type { BaseEntity, Rule, ConditionOrAction } from "@/types/entities";
import type { StagedEntity, StagedMap } from "@/types/staged";
import type { Payee, Category, Account } from "@/types/entities";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type EntityKey =
  | "accounts"
  | "payees"
  | "categoryGroups"
  | "categories"
  | "rules"
  | "schedules";

type LabelResult = { text: string; title?: string };

type EntityMaps = {
  payees: StagedMap<Payee>;
  categories: StagedMap<Category>;
  accounts: StagedMap<Account>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<EntityKey, string> = {
  accounts: "Accounts",
  payees: "Payees",
  categoryGroups: "Category Groups",
  categories: "Categories",
  rules: "Rules",
  schedules: "Schedules",
};

// ─── Generic label (name or ID prefix) ───────────────────────────────────────

function getLabel(entity: BaseEntity): LabelResult {
  const text = (entity as { name?: string }).name?.trim() || entity.id.slice(0, 8);
  return { text };
}

// ─── Rule short label ─────────────────────────────────────────────────────────

function resolvePartValue(
  field: string,
  value: ConditionOrAction["value"],
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS,
  maps: EntityMaps
): string {
  const def = fieldDefs[field];
  if (!def) return valueToString(value);

  const firstVal = Array.isArray(value) ? value[0] : value;
  const extraCount = Array.isArray(value) ? value.length - 1 : 0;
  const scalar = valueToString(firstVal);

  let resolved = scalar;
  if (def.entity && scalar) {
    resolved =
      def.entity === "payee"    ? (maps.payees[scalar]?.entity.name    ?? scalar) :
      def.entity === "category" ? (maps.categories[scalar]?.entity.name ?? scalar) :
      def.entity === "account"  ? (maps.accounts[scalar]?.entity.name  ?? scalar) :
      scalar;
  }

  return extraCount > 0 ? `${resolved} +${extraCount}` : resolved;
}

function getRuleLabel(rule: Rule, maps: EntityMaps): LabelResult {
  const cond = rule.conditions[0];
  const act  = rule.actions[0];

  const condPart = cond
    ? `${CONDITION_FIELDS[cond.field]?.label ?? cond.field} ${cond.op} ${resolvePartValue(cond.field, cond.value, CONDITION_FIELDS, maps)}`
    : "(no conditions)";

  const actPart = act
    ? `${ACTION_FIELDS[act.field]?.label ?? act.field}: ${resolvePartValue(act.field, act.value, ACTION_FIELDS, maps)}`
    : "(no actions)";

  const hasMore = rule.conditions.length > 1 || rule.actions.length > 1;
  const text  = `${condPart} → ${actPart}${hasMore ? "…" : ""}`;
  const title = rulePreview(rule, maps);

  return { text, title: title !== text ? title : undefined };
}

// ─── ItemGroup ────────────────────────────────────────────────────────────────

type ItemVariant = "created" | "updated" | "deleted" | "merge-created" | "merge-deleted" | "error";

function ItemGroup({
  variant,
  items,
  getLabelFn,
}: {
  variant: ItemVariant;
  items: StagedEntity<BaseEntity>[];
  getLabelFn: (entity: BaseEntity) => LabelResult;
}) {
  const label =
    variant === "created"       ? "Created" :
    variant === "updated"       ? "Updated" :
    variant === "deleted"       ? "Deleted" :
    variant === "merge-created" ? "Merge Created" :
    variant === "merge-deleted" ? "Merge Deleted" : "Errors";

  const dot =
    variant === "created" || variant === "merge-created"   ? "bg-green-500" :
    variant === "updated"                                   ? "bg-amber-400" :
    variant === "deleted" || variant === "merge-deleted"    ? "bg-muted-foreground/50" :
    "bg-destructive";

  return (
    <div>
      <p className={cn(
        "mb-0.5 text-[10px] font-medium uppercase tracking-wide",
        variant === "error" ? "text-destructive" : "text-muted-foreground"
      )}>
        {label} ({items.length})
      </p>
      <ul className="space-y-0.5">
        {items.slice(0, 8).map((s) => {
          const { text, title } = getLabelFn(s.entity);
          return (
            <li key={s.entity.id} className="flex items-start gap-1.5">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
              <span
                className="min-w-0 flex-1 truncate text-xs text-foreground/80 leading-tight"
                title={title ?? text}
              >
                {text}
                {s.saveError && (
                  <span className="block text-[10px] text-destructive leading-tight">
                    {s.saveError}
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {items.length > 8 && (
          <li className="text-xs text-muted-foreground pl-3">
            +{items.length - 8} more
          </li>
        )}
      </ul>
    </div>
  );
}

// ─── EntitySection ────────────────────────────────────────────────────────────

function EntitySection({
  label,
  entries,
  getLabelFn,
  mergeDepIds,
}: {
  label: string;
  entries: StagedEntity<BaseEntity>[];
  getLabelFn?: (entity: BaseEntity) => LabelResult;
  mergeDepIds?: { created: Set<string>; deleted: Set<string> };
}) {
  const allCreated = entries.filter((s) => s.isNew && !s.isDeleted);
  const updated    = entries.filter((s) => s.isUpdated && !s.isNew && !s.isDeleted);
  const allDeleted = entries.filter((s) => s.isDeleted && !s.isNew);
  const errored    = entries.filter((s) => s.saveError);

  const mergeCreated   = mergeDepIds ? allCreated.filter((s) => mergeDepIds.created.has(s.entity.id))  : [];
  const regularCreated = mergeDepIds ? allCreated.filter((s) => !mergeDepIds.created.has(s.entity.id)) : allCreated;
  const mergeDeleted   = mergeDepIds ? allDeleted.filter((s) => mergeDepIds.deleted.has(s.entity.id))  : [];
  const regularDeleted = mergeDepIds ? allDeleted.filter((s) => !mergeDepIds.deleted.has(s.entity.id)) : allDeleted;

  const total = allCreated.length + updated.length + allDeleted.length;
  if (total === 0 && errored.length === 0) return null;

  const labelFn = getLabelFn ?? getLabel;

  return (
    <div className="px-3 py-2">
      <p className="mb-1.5 text-xs font-semibold">{label}</p>
      <div className="flex flex-col gap-1">
        {mergeCreated.length   > 0 && <ItemGroup variant="merge-created" items={mergeCreated}   getLabelFn={labelFn} />}
        {regularCreated.length > 0 && <ItemGroup variant="created"       items={regularCreated} getLabelFn={labelFn} />}
        {updated.length        > 0 && <ItemGroup variant="updated"       items={updated}        getLabelFn={labelFn} />}
        {mergeDeleted.length   > 0 && <ItemGroup variant="merge-deleted" items={mergeDeleted}   getLabelFn={labelFn} />}
        {regularDeleted.length > 0 && <ItemGroup variant="deleted"       items={regularDeleted} getLabelFn={labelFn} />}
        {errored.length        > 0 && <ItemGroup variant="error"         items={errored}        getLabelFn={labelFn} />}
      </div>
    </div>
  );
}

// ─── DraftPanel ───────────────────────────────────────────────────────────────

export function DraftPanel() {
  const state             = useStagedStore((s) => s);
  const hasChanges        = useStagedStore(selectHasChanges);
  const mergeDependencies = useStagedStore((s) => s.mergeDependencies);
  const payees            = useStagedStore((s) => s.payees);
  const categories        = useStagedStore((s) => s.categories);
  const accounts          = useStagedStore((s) => s.accounts);

  const entityKeys = Object.keys(ENTITY_LABELS) as EntityKey[];

  const errorCount = entityKeys.reduce((acc, key) => {
    return acc + Object.values(state[key] as Record<string, StagedEntity<BaseEntity>>)
      .filter((s) => s.saveError).length;
  }, 0);

  const entityMaps: EntityMaps = useMemo(
    () => ({ payees, categories, accounts }),
    [payees, categories, accounts]
  );

  // Merge-dep sets for the Rules section
  const ruleMergeDepIds = useMemo(() => ({
    created: new Set(Object.keys(mergeDependencies)),
    deleted: new Set(Object.values(mergeDependencies).flat()),
  }), [mergeDependencies]);

  function getRuleLabelFn(entity: BaseEntity): LabelResult {
    return getRuleLabel(entity as unknown as Rule, entityMaps);
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between px-3 py-3.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Draft Changes
        </span>
        <div className="flex gap-1">
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {errorCount} error{errorCount !== 1 ? "s" : ""}
            </Badge>
          )}
          {hasChanges && errorCount === 0 && (
            <Badge variant="secondary" className="text-xs">
              pending
            </Badge>
          )}
        </div>
      </div>
      <Separator />

      {!hasChanges ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No pending changes.
        </p>
      ) : (
        <div className="flex flex-col gap-0 overflow-y-auto">
          {entityKeys.map((key) => (
            <EntitySection
              key={key}
              label={ENTITY_LABELS[key]}
              entries={Object.values(state[key] as Record<string, StagedEntity<BaseEntity>>)}
              getLabelFn={key === "rules" ? getRuleLabelFn : undefined}
              mergeDepIds={key === "rules" ? ruleMergeDepIds : undefined}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
