"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { useStagedStore, selectHasChanges } from "@/store/staged";
import { CONDITION_FIELDS, ACTION_FIELDS } from "@/features/rules/utils/ruleFields";
import { rulePreview, valueToString } from "@/features/rules/utils/rulePreview";
import type { BaseEntity, Rule, ConditionOrAction, Schedule } from "@/types/entities";
import type { StagedEntity, StagedMap } from "@/types/staged";
import type { Payee, Category, Account, CategoryGroup } from "@/types/entities";
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
  | "schedules"
  | "tags";

type LabelResult = { text: string; title?: string };

type EntityMaps = {
  payees: StagedMap<Payee>;
  categories: StagedMap<Category>;
  accounts: StagedMap<Account>;
  categoryGroups: StagedMap<CategoryGroup>;
  schedules?: StagedMap<Schedule>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<EntityKey, string> = {
  accounts: "Accounts",
  payees: "Payees",
  categoryGroups: "Category Groups",
  categories: "Categories",
  rules: "Rules",
  schedules: "Schedules",
  tags: "Tags",
};

const ENTITY_ROUTES: Partial<Record<EntityKey, string>> = {
  accounts: "/accounts",
  payees: "/payees",
  categoryGroups: "/categories",
  categories: "/categories",
  rules: "/rules",
  schedules: "/schedules",
  tags: "/tags",
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
      def.entity === "payee"         ? (maps.payees[scalar]?.entity.name         ?? scalar) :
      def.entity === "category"      ? (maps.categories[scalar]?.entity.name     ?? scalar) :
      def.entity === "account"       ? (maps.accounts[scalar]?.entity.name       ?? scalar) :
      def.entity === "categoryGroup" ? (maps.categoryGroups[scalar]?.entity.name ?? scalar) :
      scalar;
  }

  return extraCount > 0 ? `${resolved} +${extraCount}` : resolved;
}

function getRuleLabel(rule: Rule, maps: EntityMaps): LabelResult {
  const cond = rule.conditions[0];
  const act  = rule.actions[0];

  const condField = cond?.field ?? "";
  const actField  = act?.field  ?? "";

  const condPart = cond
    ? `${CONDITION_FIELDS[condField]?.label ?? condField} ${cond.op} ${resolvePartValue(condField, cond.value, CONDITION_FIELDS, maps)}`
    : "(no conditions)";

  const actPart = act
    ? act.op === "delete-transaction"
      ? "delete transaction"
      : act.op === "link-schedule"
        ? `linked to schedule: ${
            maps.schedules?.[typeof act.value === "string" ? act.value : ""]?.entity.name ??
            valueToString(act.value)
          }`
      : `${ACTION_FIELDS[actField]?.label ?? actField}: ${resolvePartValue(actField, act.value, ACTION_FIELDS, maps)}`
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
  onItemClick,
}: {
  variant: ItemVariant;
  items: StagedEntity<BaseEntity>[];
  getLabelFn: (entity: BaseEntity) => LabelResult;
  onItemClick?: (id: string) => void;
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
            <li key={s.entity.id}>
              <button
                type="button"
                onClick={() => onItemClick?.(s.entity.id)}
                className={cn(
                  "flex w-full items-start gap-1.5 rounded-sm px-1 -mx-1 text-left",
                  onItemClick && "cursor-pointer transition-colors hover:bg-accent"
                )}
              >
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
              </button>
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
  onItemClick,
}: {
  label: string;
  entries: StagedEntity<BaseEntity>[];
  getLabelFn?: (entity: BaseEntity) => LabelResult;
  mergeDepIds?: { created: Set<string>; deleted: Set<string> };
  onItemClick?: (id: string) => void;
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
        {mergeCreated.length   > 0 && <ItemGroup variant="merge-created" items={mergeCreated}   getLabelFn={labelFn} onItemClick={onItemClick} />}
        {regularCreated.length > 0 && <ItemGroup variant="created"       items={regularCreated} getLabelFn={labelFn} onItemClick={onItemClick} />}
        {updated.length        > 0 && <ItemGroup variant="updated"       items={updated}        getLabelFn={labelFn} onItemClick={onItemClick} />}
        {mergeDeleted.length   > 0 && <ItemGroup variant="merge-deleted" items={mergeDeleted}   getLabelFn={labelFn} onItemClick={onItemClick} />}
        {regularDeleted.length > 0 && <ItemGroup variant="deleted"       items={regularDeleted} getLabelFn={labelFn} onItemClick={onItemClick} />}
        {errored.length        > 0 && <ItemGroup variant="error"         items={errored}        getLabelFn={labelFn} onItemClick={onItemClick} />}
      </div>
    </div>
  );
}

// ─── DraftPanel ───────────────────────────────────────────────────────────────

export function DraftPanel() {
  const router            = useRouter();
  const hasChanges          = useStagedStore(selectHasChanges);
  const mergeDependencies   = useStagedStore((s) => s.mergeDependencies);
  const pendingPayeeMerges  = useStagedStore((s) => s.pendingPayeeMerges);
  const accounts          = useStagedStore((s) => s.accounts);
  const payees            = useStagedStore((s) => s.payees);
  const categoryGroups    = useStagedStore((s) => s.categoryGroups);
  const categories        = useStagedStore((s) => s.categories);
  const rules             = useStagedStore((s) => s.rules);
  const schedules         = useStagedStore((s) => s.schedules);
  const tags              = useStagedStore((s) => s.tags);

  const slices = useMemo<Record<EntityKey, StagedMap<BaseEntity>>>(
    () => ({
      accounts:       accounts       as StagedMap<BaseEntity>,
      payees:         payees         as StagedMap<BaseEntity>,
      categoryGroups: categoryGroups as StagedMap<BaseEntity>,
      categories:     categories     as StagedMap<BaseEntity>,
      rules:          rules          as StagedMap<BaseEntity>,
      schedules:      schedules      as StagedMap<BaseEntity>,
      tags:           tags           as StagedMap<BaseEntity>,
    }),
    [accounts, payees, categoryGroups, categories, rules, schedules, tags]
  );

  const { errorCount, totalCount } = useMemo(() => {
    let errors = 0, total = 0;
    for (const key of Object.keys(ENTITY_LABELS) as EntityKey[]) {
      for (const s of Object.values(slices[key])) {
        if (s.saveError) errors++;
        if (s.isNew || s.isUpdated || s.isDeleted) total++;
      }
    }
    return { errorCount: errors, totalCount: total };
  }, [slices]);

  const handleItemClick = (entityKey: EntityKey, id: string) => {
    const route = ENTITY_ROUTES[entityKey];
    if (!route) return;
    router.push(`${route}?highlight=${id}`);
  };

  const entityMaps: EntityMaps = useMemo(
    () => ({ payees, categories, accounts, categoryGroups, schedules }),
    [payees, categories, accounts, categoryGroups, schedules]
  );

  const ruleMergeDepIds = useMemo(() => ({
    created: new Set(Object.keys(mergeDependencies)),
    deleted: new Set(Object.values(mergeDependencies).flat()),
  }), [mergeDependencies]);

  const payeeMergeDepIds = useMemo(() => ({
    created: new Set<string>(),
    deleted: new Set(pendingPayeeMerges.flatMap((m) => m.mergeIds)),
  }), [pendingPayeeMerges]);

  const hasPayeeMerges = pendingPayeeMerges.length > 0;

  const getRuleLabelFn = useMemo(
    () => (entity: BaseEntity) => getRuleLabel(entity as unknown as Rule, entityMaps),
    [entityMaps]
  );

  const isExpanded = hasChanges || hasPayeeMerges || errorCount > 0;

  // ── Collapsed strip — shown when no pending changes ───────────────────────────
  if (!isExpanded) {
    return (
      <aside
        className="flex w-10 shrink-0 flex-col items-center border-l border-border bg-background pt-3"
        title="No pending changes"
      >
        <Layers className="h-4 w-4 text-muted-foreground/40" />
      </aside>
    );
  }

  // ── Expanded panel — shown when there are staged changes or errors ─────────────
  return (
    <aside className="flex w-90 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between px-3 py-3">
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
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
              {totalCount} change{totalCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>
      <Separator />

      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto">
        {(Object.keys(ENTITY_LABELS) as EntityKey[]).map((key) => (
          <EntitySection
            key={key}
            label={ENTITY_LABELS[key]}
            entries={Object.values(slices[key])}
            getLabelFn={key === "rules" ? getRuleLabelFn : undefined}
            mergeDepIds={
              key === "rules"   ? ruleMergeDepIds  :
              key === "payees"  ? payeeMergeDepIds :
              undefined
            }
            onItemClick={ENTITY_ROUTES[key] ? (id) => handleItemClick(key, id) : undefined}
          />
        ))}
      </div>
    </aside>
  );
}
