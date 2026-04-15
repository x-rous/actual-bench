"use client";

import { memo } from "react";
import { Info, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { DoneAction } from "@/components/ui/editable-cell";
import { EditableCellInput } from "@/components/ui/editable-cell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types/entities";
import type { StagedEntity } from "@/types/staged";

const DEFAULT_TAG_COLOR = "#E4D4FF";

/** Returns "#ffffff" or "#1a1a1a" for readable contrast against a hex background. */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.179 ? "#1a1a1a" : "#ffffff";
}

type TagRow = StagedEntity<Tag>;
type NavigableCol = "name" | "description";

type TagsTableRowProps = {
  row: TagRow;
  highlightedId: string | null;
  isRowSelected: boolean;
  isDuplicate: boolean;
  isNameSelected: boolean;
  isNameEditing: boolean;
  isDescSelected: boolean;
  isDescEditing: boolean;
  nameEditStartChar?: string;
  descEditStartChar?: string;
  onToggleSelect: (id: string, checked: boolean) => void;
  onSelectCell: (id: string, colId: NavigableCol) => void;
  onStartEditing: (id: string, colId: NavigableCol) => void;
  onDoneName: (id: string, value: string, action: DoneAction) => void;
  onDoneDescription: (id: string, value: string, action: DoneAction) => void;
  onChangeColor: (id: string, color: string) => void;
  onClearColor: (id: string) => void;
  onClearSaveError: (id: string) => void;
  onRevert: (id: string) => void;
  onInspect: (id: string) => void;
  onDelete: (entity: Tag, isNew: boolean) => void;
  isAnotherCellEditing: boolean;
};

function TagsTableRowComponent({
  row,
  highlightedId,
  isRowSelected,
  isDuplicate,
  isNameSelected,
  isNameEditing,
  isDescSelected,
  isDescEditing,
  nameEditStartChar,
  descEditStartChar,
  onToggleSelect,
  onSelectCell,
  onStartEditing,
  onDoneName,
  onDoneDescription,
  onChangeColor,
  onClearColor,
  onClearSaveError,
  onRevert,
  onInspect,
  onDelete,
  isAnotherCellEditing,
}: TagsTableRowProps) {
  const { entity, isNew, isUpdated, isDeleted, saveError } = row;
  const effectiveColor = entity.color ?? DEFAULT_TAG_COLOR;

  return (
    <tr
      data-row-id={entity.id}
      className={cn(
        "group/row border-b border-border/30 border-l-2 border-l-transparent transition-colors",
        highlightedId === entity.id && "bg-primary/20 ring-2 ring-inset ring-primary/40",
        highlightedId !== entity.id && isRowSelected && "bg-primary/10",
        highlightedId !== entity.id && !isRowSelected && saveError && "bg-destructive/5 border-l-destructive",
        highlightedId !== entity.id && !isRowSelected && !saveError && isDeleted && "opacity-50 border-l-muted-foreground/30",
        highlightedId !== entity.id && !isRowSelected && !saveError && !isDeleted && isNew && "bg-green-50/30 dark:bg-green-950/10 border-l-green-500",
        highlightedId !== entity.id && !isRowSelected && !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-50/30 dark:bg-amber-950/10 border-l-amber-400",
      )}
    >
      <td className="w-9 px-3 py-0.5">
        {!isDeleted && (
          <input
            type="checkbox"
            checked={isRowSelected}
            onChange={(e) => onToggleSelect(entity.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
            aria-label={`Select tag ${entity.name || "Unnamed tag"}`}
          />
        )}
      </td>

      <td className="w-1 p-0 pl-0.5">
        <div
          title={saveError}
          className={cn(
            "h-4 w-0.5 rounded-full",
            saveError && "bg-destructive",
            !saveError && isDeleted && "bg-muted-foreground/30",
            !saveError && !isDeleted && isNew && "bg-green-500",
            !saveError && !isDeleted && !isNew && isUpdated && "bg-amber-400",
          )}
        />
      </td>

      <td className="w-10 px-2 py-0.5">
        {!isDeleted && (
          <div className="flex items-center gap-1">
            <label className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
              <input
                type="color"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                value={effectiveColor}
                aria-label={`Tag color for ${entity.name || entity.id}`}
                onChange={(e) => onChangeColor(entity.id, e.target.value)}
              />
              <span
                className={cn(
                  "h-4 w-4 rounded-full transition-transform hover:scale-110",
                  entity.color ? "border border-border/50" : "border border-dashed border-border/60",
                )}
                style={{ backgroundColor: effectiveColor }}
              />
            </label>
            {entity.color && (
              <button
                className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-60 group-focus-within/row:opacity-60 focus-visible:opacity-100 hover:!opacity-100"
                onClick={() => onClearColor(entity.id)}
                title="Clear color"
                aria-label="Clear tag color"
              >
                ×
              </button>
            )}
          </div>
        )}
      </td>

      <td
        data-cell={`${entity.id}:name`}
        tabIndex={isNameSelected ? 0 : -1}
        className={cn(
          "cursor-default px-2 py-0.5 outline-none",
          isNameSelected && !isNameEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
          isNameEditing && "ring-1 ring-inset ring-primary",
        )}
        onClick={() => {
          if (isDeleted) return;
          if (isNameSelected) onStartEditing(entity.id, "name");
          else onSelectCell(entity.id, "name");
        }}
        onFocus={() => {
          if (!isAnotherCellEditing) onSelectCell(entity.id, "name");
        }}
      >
        {isNameEditing && !isDeleted ? (
          <EditableCellInput
            initialValue={entity.name}
            startChar={nameEditStartChar}
            onDone={(value, action) => onDoneName(entity.id, value, action)}
            className="text-xs"
          />
        ) : (
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
              isDeleted && "opacity-60",
              isDuplicate && "ring-2 ring-amber-400",
            )}
            style={{ backgroundColor: effectiveColor, color: contrastText(effectiveColor) }}
          >
            {entity.name
              ? `#${entity.name}`
              : <span className="italic opacity-60">unnamed</span>}
          </span>
        )}
      </td>

      <td
        data-cell={`${entity.id}:description`}
        tabIndex={isDescSelected ? 0 : -1}
        className={cn(
          "cursor-default px-2 py-0.5 text-muted-foreground outline-none",
          isDescSelected && !isDescEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
          isDescEditing && "ring-1 ring-inset ring-primary",
        )}
        onClick={() => {
          if (isDeleted) return;
          if (isDescSelected) onStartEditing(entity.id, "description");
          else onSelectCell(entity.id, "description");
        }}
        onFocus={() => {
          if (!isAnotherCellEditing) onSelectCell(entity.id, "description");
        }}
      >
        {isDescEditing && !isDeleted ? (
          <EditableCellInput
            initialValue={entity.description ?? ""}
            startChar={descEditStartChar}
            onDone={(value, action) => onDoneDescription(entity.id, value, action)}
            allowEmpty
            trimOnCommit
            className="text-xs"
          />
        ) : (
          <span className="block truncate">
            {entity.description || <span className="italic text-muted-foreground/50">—</span>}
          </span>
        )}
      </td>

      <td className="w-16 px-1 py-0.5">
        <div
          className={cn(
            "flex items-center justify-end gap-0.5 transition-opacity",
            saveError || isDeleted
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          )}
        >
          {saveError ? (
            <Button
              variant="ghost"
              size="icon-xs"
              title="Clear error"
              aria-label="Clear error"
              onClick={() => onClearSaveError(entity.id)}
            >
              <RefreshCw />
            </Button>
          ) : isDeleted ? (
            <Button variant="ghost" size="icon-xs" title="Undo delete" aria-label="Undo delete" onClick={() => onRevert(entity.id)}>
              <RotateCcw />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                title="Inspect usage"
                aria-label="Inspect usage"
                onClick={() => onInspect(entity.id)}
              >
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
                className="text-destructive hover:text-destructive"
                title="Delete tag"
                aria-label="Delete tag"
                onClick={() => onDelete(entity, isNew)}
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

function areEqual(prev: TagsTableRowProps, next: TagsTableRowProps) {
  return (
    prev.row === next.row &&
    prev.highlightedId === next.highlightedId &&
    prev.isRowSelected === next.isRowSelected &&
    prev.isDuplicate === next.isDuplicate &&
    prev.isNameSelected === next.isNameSelected &&
    prev.isNameEditing === next.isNameEditing &&
    prev.isDescSelected === next.isDescSelected &&
    prev.isDescEditing === next.isDescEditing &&
    prev.nameEditStartChar === next.nameEditStartChar &&
    prev.descEditStartChar === next.descEditStartChar &&
    prev.isAnotherCellEditing === next.isAnotherCellEditing
  );
}

export const TagsTableRow = memo(TagsTableRowComponent, areEqual);
