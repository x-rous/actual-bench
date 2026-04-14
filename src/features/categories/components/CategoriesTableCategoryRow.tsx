"use client";

import { AlertTriangle, Eye, EyeOff, Info, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableCellInput } from "@/components/ui/editable-cell";
import type { DoneAction } from "@/components/ui/editable-cell";
import { EntityNoteButton } from "@/components/ui/entity-note-button";
import { cn } from "@/lib/utils";
import type { Category, CategoryGroup } from "@/types/entities";
import type { StagedEntity } from "@/types/staged";
import { CategoryGroupAssignmentCell, type CategoryGroupOption } from "./CategoryGroupAssignmentCell";

type Props = {
  row: StagedEntity<Category>;
  group: StagedEntity<CategoryGroup>;
  rowId: string;
  highlightedId: string | null;
  isSelected: boolean;
  isEditing: boolean;
  isChecked: boolean;
  isDuplicate: boolean;
  hasNote: boolean;
  isInheritedHidden: boolean;
  ruleCount: number;
  groupLabel: string;
  groupOptions: CategoryGroupOption[];
  editStartChar?: string;
  onToggleSelect: (id: string, checked?: boolean) => void;
  onSelectNameCell: (rowId: string) => void;
  onStartEditingName: (rowId: string) => void;
  onDoneName: (id: string, value: string, action: DoneAction) => void;
  onChangeGroup: (categoryId: string, nextGroupId: string) => void;
  onToggleHidden: (id: string, hidden: boolean) => void;
  onOpenRules: (categoryId: string, ruleCount: number) => void;
  onClearSaveError: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onInspect: (id: string) => void;
  isAnotherCellEditing: boolean;
};

export function CategoriesTableCategoryRow({
  row,
  rowId,
  highlightedId,
  isSelected,
  isEditing,
  isChecked,
  isDuplicate,
  hasNote,
  isInheritedHidden,
  ruleCount,
  groupLabel,
  groupOptions,
  editStartChar,
  onToggleSelect,
  onSelectNameCell,
  onStartEditingName,
  onDoneName,
  onChangeGroup,
  onToggleHidden,
  onOpenRules,
  onClearSaveError,
  onRevert,
  onRequestDelete,
  onInspect,
  isAnotherCellEditing,
}: Props) {
  const { entity, isNew, isUpdated, isDeleted, saveError } = row;

  return (
    <tr
      data-row-id={entity.id}
      className={cn(
        "group/row border-b border-border/20 border-l-2 border-l-transparent transition-colors",
        highlightedId === entity.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
        highlightedId !== entity.id && isChecked && "bg-primary/10",
        highlightedId !== entity.id && !isChecked && saveError && "bg-destructive/5 border-l-destructive",
        highlightedId !== entity.id && !isChecked && !saveError && isDeleted && "opacity-50 border-l-muted-foreground/30",
        highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && isNew && "bg-green-50/30 dark:bg-green-950/10 border-l-green-500",
        highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-50/30 dark:bg-amber-950/10 border-l-amber-400"
      )}
    >
      <td className="w-9 px-3 py-0.5">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => onToggleSelect(entity.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
        />
      </td>

      <td className="w-1 p-0 pl-0.5">
        <div
          className={cn(
            "h-4 w-0.5 rounded-full",
            saveError && "bg-destructive",
            !saveError && isDeleted && "bg-muted-foreground/30",
            !saveError && !isDeleted && isNew && "bg-green-500",
            !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-400"
          )}
        />
      </td>

      <td
        data-cell={rowId}
        tabIndex={isSelected ? 0 : -1}
        className={cn(
          "cursor-default px-2 py-0.5 outline-none",
          isSelected && !isEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
          isEditing && "ring-1 ring-inset ring-primary"
        )}
        onClick={() => (isSelected && !isDeleted && !isAnotherCellEditing ? onStartEditingName(rowId) : onSelectNameCell(rowId))}
        onFocus={() => {
          if (!isAnotherCellEditing) onSelectNameCell(rowId);
        }}
      >
        <div className="flex items-center gap-1 pl-6">
          {isEditing ? (
            <EditableCellInput
              initialValue={entity.name}
              startChar={editStartChar}
              onDone={(value, action) => onDoneName(entity.id, value, action)}
            />
          ) : (
            <div className="flex flex-col">
              <span
                className={cn(
                  "flex items-center gap-1 leading-6",
                  isDeleted && "line-through",
                  !entity.name && "text-xs italic text-muted-foreground/60"
                )}
              >
                {entity.name || "empty name"}
                {isDuplicate && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Duplicate name" />}
              </span>
              {saveError && <span className="pb-0.5 text-xs leading-tight text-destructive">{saveError}</span>}
            </div>
          )}
        </div>
      </td>

      <td className="w-8 px-0 py-0.5 text-center">
        {!isNew && hasNote && (
          <EntityNoteButton
            entityId={entity.id}
            entityKind="category"
            entityLabel={entity.name || "Unnamed category"}
            entityTypeLabel="Category"
            className="mx-auto"
          />
        )}
      </td>

      <td className="w-60 px-2 py-0.5">
        {!isDeleted && (
          <CategoryGroupAssignmentCell
            categoryId={entity.id}
            groupId={entity.groupId}
            currentLabel={groupLabel}
            disabled={entity.isIncome}
            disabledTitle={
              entity.isIncome ? "Income categories always belong to the single income group." : undefined
            }
            options={groupOptions}
            onCommit={onChangeGroup}
          />
        )}
      </td>

      <td className="w-36 px-2 py-0.5">
        {isInheritedHidden ? (
          <span
            className="flex cursor-default items-center gap-1 text-xs text-amber-500/70"
            title="Hidden because the group is hidden — unhide the group first"
          >
            <EyeOff className="h-3 w-3" />
            Hidden - Inherited
          </span>
        ) : (
          <button
            disabled={isDeleted}
            onClick={() => onToggleHidden(entity.id, !entity.hidden)}
            className={cn(
              "flex items-center gap-1 text-xs transition-colors",
              entity.hidden ? "text-amber-600" : "text-muted-foreground hover:text-foreground",
              isDeleted && "cursor-default opacity-50"
            )}
          >
            {entity.hidden ? <><EyeOff className="h-3 w-3" /> Hidden</> : <><Eye className="h-3 w-3" /> Visible</>}
          </button>
        )}
      </td>

      <td className="w-44 px-2 py-0.5">
        {!isDeleted && (
          <button
            className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
            onClick={() => onOpenRules(entity.id, ruleCount)}
            title={ruleCount > 0 ? "View rules for this category" : "Create a rule for this category"}
          >
            {ruleCount === 0 ? "create rule" : ruleCount === 1 ? "1 associated rule" : `${ruleCount} associated rules`}
          </button>
        )}
      </td>

      <td className="w-28 px-1 py-0.5">
        <div
          className={cn(
            "flex items-center justify-end gap-0.5 transition-opacity",
            saveError || isDeleted
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          )}
        >
          {saveError ? (
            <Button variant="ghost" size="icon-xs" title="Clear error" aria-label="Clear error" onClick={() => onClearSaveError(entity.id)}>
              <RefreshCw />
            </Button>
          ) : isDeleted ? (
            <Button variant="ghost" size="icon-xs" title="Undo delete" aria-label="Undo delete" onClick={() => onRevert(entity.id)}>
              <RotateCcw />
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="icon-xs" title="Inspect usage" aria-label="Inspect usage" onClick={() => onInspect(entity.id)}>
                <Info />
              </Button>
              {(isNew || isUpdated) && (
                <Button variant="ghost" size="icon-xs" title="Revert changes" aria-label="Revert changes" onClick={() => onRevert(entity.id)}>
                  <RotateCcw />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                title="Delete category"
                aria-label="Delete category"
                className="text-destructive hover:text-destructive"
                onClick={() => onRequestDelete(entity.id)}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
