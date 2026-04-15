"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff, Info, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditableCellInput } from "@/components/ui/editable-cell";
import type { DoneAction } from "@/components/ui/editable-cell";
import { EntityNoteButton } from "@/components/ui/entity-note-button";
import { cn } from "@/lib/utils";
import type { CategoryGroup } from "@/types/entities";
import type { StagedEntity } from "@/types/staged";

type Props = {
  row: StagedEntity<CategoryGroup>;
  rowId: string;
  highlightedId: string | null;
  collapsed: boolean;
  isSelected: boolean;
  isEditing: boolean;
  isChecked: boolean;
  isDuplicate: boolean;
  groupCountLabel: string;
  hasNote: boolean;
  incomeGroupCount: number;
  editStartChar?: string;
  onToggleSelect: (id: string, checked?: boolean) => void;
  onToggleCollapse: (groupId: string) => void;
  onSelectNameCell: (rowId: string) => void;
  onStartEditingName: (rowId: string) => void;
  onDoneName: (id: string, value: string, action: DoneAction) => void;
  onToggleHidden: (id: string, hidden: boolean) => void;
  onClearSaveError: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onInspect: (id: string) => void;
  isAnotherCellEditing: boolean;
};

export function CategoriesTableGroupRow({
  row,
  rowId,
  highlightedId,
  collapsed,
  isSelected,
  isEditing,
  isChecked,
  isDuplicate,
  groupCountLabel,
  hasNote,
  incomeGroupCount,
  editStartChar,
  onToggleSelect,
  onToggleCollapse,
  onSelectNameCell,
  onStartEditingName,
  onDoneName,
  onToggleHidden,
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
        "group/row border-b border-border/40 border-l-2 border-l-transparent bg-muted/20 transition-colors",
        highlightedId === entity.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
        highlightedId !== entity.id && isChecked && "bg-primary/10",
        highlightedId !== entity.id && !isChecked && saveError && "bg-destructive/5 border-l-destructive",
        highlightedId !== entity.id && !isChecked && !saveError && isDeleted && "opacity-50 border-l-muted-foreground/30",
        highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && isNew && "bg-green-50/40 dark:bg-green-950/10 border-l-green-500",
        highlightedId !== entity.id && !isChecked && !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-50/40 dark:bg-amber-950/10 border-l-amber-400"
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
        data-cell={`${rowId}:name`}
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
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(entity.id);
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
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
                  "flex items-center gap-1 text-sm font-medium leading-6",
                  isDeleted && "line-through",
                  !entity.name && "text-xs italic font-normal text-muted-foreground/60"
                )}
              >
                {entity.name || "empty name"}
                {isDuplicate && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Duplicate name" />}
                {!isDeleted && <span className="text-xs font-normal text-muted-foreground">({groupCountLabel})</span>}
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
            entityLabel={entity.name || "Unnamed group"}
            entityTypeLabel="Category group"
            className="mx-auto"
          />
        )}
      </td>

      <td className="w-48 px-2 py-0.5">
        <Badge variant={entity.isIncome ? "status-active" : "secondary"} className="text-xs font-normal">
          {entity.isIncome ? "Income" : "Expense"}
        </Badge>
      </td>

      <td className="w-36 px-2 py-0.5">
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
      </td>

      <td className="w-44 px-2 py-0.5" />

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
              {!(entity.isIncome && incomeGroupCount <= 1) && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Delete group"
                  aria-label="Delete group"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onRequestDelete(entity.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
