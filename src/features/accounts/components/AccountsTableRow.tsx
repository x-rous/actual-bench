"use client";

import { memo } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Info,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { DoneAction } from "@/components/ui/editable-cell";
import { EditableCellInput } from "@/components/ui/editable-cell";
import { EntityNoteButton } from "@/components/ui/entity-note-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Account } from "@/types/entities";
import type { StagedEntity } from "@/types/staged";

type AccountRow = StagedEntity<Account>;

type AccountsTableRowProps = {
  row: AccountRow;
  highlightedId: string | null;
  isRowSelected: boolean;
  isNameSelected: boolean;
  isNameEditing: boolean;
  editStartChar?: string;
  isDuplicate: boolean;
  hasNote: boolean;
  balance?: number;
  ruleCount: number;
  onToggleSelect: (id: string, checked: boolean) => void;
  onSelectNameCell: (id: string) => void;
  onStartEditingName: (id: string) => void;
  onDoneName: (id: string, value: string, action: DoneAction) => void;
  onToggleNewBudgetType: (id: string, nextOffBudget: boolean) => void;
  onOpenRules: (accountId: string, accountName: string, ruleCount: number) => void;
  onClearSaveError: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestClose: (entity: Account, balance: number, isNew: boolean) => void;
  onReopen: (id: string) => void;
  onRequestDelete: (entity: Account, balance: number, ruleCount: number, isNew: boolean) => void;
  onInspect: (id: string) => void;
  isAnotherCellEditing: boolean;
};

function formatBalance(balance?: number) {
  if (balance === undefined) return null;
  return balance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function AccountsTableRowComponent({
  row,
  highlightedId,
  isRowSelected,
  isNameSelected,
  isNameEditing,
  editStartChar,
  isDuplicate,
  hasNote,
  balance,
  ruleCount,
  onToggleSelect,
  onSelectNameCell,
  onStartEditingName,
  onDoneName,
  onToggleNewBudgetType,
  onOpenRules,
  onClearSaveError,
  onRevert,
  onRequestClose,
  onReopen,
  onRequestDelete,
  onInspect,
  isAnotherCellEditing,
}: AccountsTableRowProps) {
  const { entity, isNew, isUpdated, isDeleted, saveError } = row;
  const formattedBalance = formatBalance(balance);
  const ruleLabel = ruleCount === 0
    ? "create rule"
    : ruleCount === 1
      ? "1 associated rule"
      : `${ruleCount} associated rules`;

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
        <input
          type="checkbox"
          checked={isRowSelected}
          onChange={(e) => onToggleSelect(entity.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select account ${entity.name || "Unnamed account"}`}
          className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
        />
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

      <td
        data-cell={`${entity.id}:name`}
        tabIndex={isNameSelected ? 0 : -1}
        className={cn(
          "cursor-default px-2 py-0.5 outline-none",
          isNameSelected && !isNameEditing && "bg-primary/10 ring-1 ring-inset ring-primary/50",
          isNameEditing && "ring-1 ring-inset ring-primary",
        )}
        onClick={() => isNameSelected && !isDeleted ? onStartEditingName(entity.id) : onSelectNameCell(entity.id)}
        onFocus={() => {
          if (!isAnotherCellEditing) onSelectNameCell(entity.id);
        }}
      >
        {isNameEditing ? (
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
                !entity.name && "text-xs italic text-muted-foreground/60",
              )}
            >
              {entity.name || "empty name"}
              {isDuplicate && (
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Duplicate name" />
              )}
            </span>
            {saveError && (
              <span className="pb-0.5 text-xs leading-tight text-destructive">
                {saveError}
              </span>
            )}
          </div>
        )}
      </td>

      <td className="w-8 px-0 py-0.5 text-center">
        {!isNew && hasNote && (
          <EntityNoteButton
            entityId={entity.id}
            entityKind="account"
            entityLabel={entity.name || "Unnamed account"}
            entityTypeLabel="Account"
            className="mx-auto"
          />
        )}
      </td>

      <td className="w-32 px-4 py-0.5 text-right tabular-nums">
        {isNew || formattedBalance === null ? (
          <span className="text-xs text-muted-foreground/50">-</span>
        ) : (
          <span
            className={cn(
              "text-xs",
              balance !== undefined && balance < 0 && "text-destructive",
              balance === 0 && "text-muted-foreground",
            )}
          >
            {formattedBalance}
          </span>
        )}
      </td>

      <td className="w-40 px-2 py-0.5">
        {!isNew ? (
          <Badge variant={entity.offBudget ? "status-inactive" : "status-active"} className="text-xs font-normal">
            {entity.offBudget ? "Off Budget" : "On Budget"}
          </Badge>
        ) : (
          <button
            disabled={isDeleted}
            onClick={() => onToggleNewBudgetType(entity.id, !entity.offBudget)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground transition-colors hover:text-foreground/80"
          >
            <span
              className={cn(
                "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
                entity.offBudget ? "bg-slate-400 dark:bg-slate-500" : "bg-emerald-500 dark:bg-emerald-600",
              )}
            >
              <span
                className={cn(
                  "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
                  entity.offBudget ? "translate-x-0.5" : "translate-x-3.5",
                )}
              />
            </span>
            {entity.offBudget ? "Off Budget" : "On Budget"}
          </button>
        )}
      </td>

      <td className="w-32 px-2 py-0.5">
        <Badge variant={entity.closed ? "status-inactive" : "status-active"} className="text-xs font-normal">
          {entity.closed ? "Closed" : "Open"}
        </Badge>
      </td>

      <td className="w-40 px-2 py-0.5">
        {!isDeleted && (
          <button
            className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
            onClick={() => onOpenRules(entity.id, entity.name, ruleCount)}
            title={ruleCount > 0 ? "View rules for this account" : "Create a rule for this account"}
          >
            {ruleLabel}
          </button>
        )}
      </td>

      <td className="w-24 px-1 py-0.5">
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
              <Button
                variant="ghost"
                size="icon-xs"
                title={entity.closed ? "Reopen" : "Close"}
                aria-label={entity.closed ? "Reopen account" : "Close account"}
                onClick={() => {
                  if (entity.closed) {
                    onReopen(entity.id);
                    return;
                  }
                  onRequestClose(entity, balance ?? 0, isNew);
                }}
              >
                {entity.closed ? <ArchiveRestore /> : <Archive />}
              </Button>
              {(isNew || isUpdated) && (
                <Button variant="ghost" size="icon-xs" title="Revert changes" aria-label="Revert changes" onClick={() => onRevert(entity.id)}>
                  <RotateCcw />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                title="Delete account"
                aria-label="Delete account"
                className="text-destructive hover:text-destructive"
                onClick={() => onRequestDelete(entity, balance ?? 0, ruleCount, isNew)}
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

function areEqual(prev: AccountsTableRowProps, next: AccountsTableRowProps) {
  return (
    prev.row === next.row &&
    prev.highlightedId === next.highlightedId &&
    prev.isRowSelected === next.isRowSelected &&
    prev.isNameSelected === next.isNameSelected &&
    prev.isNameEditing === next.isNameEditing &&
    prev.editStartChar === next.editStartChar &&
    prev.isDuplicate === next.isDuplicate &&
    prev.hasNote === next.hasNote &&
    prev.balance === next.balance &&
    prev.ruleCount === next.ruleCount &&
    prev.isAnotherCellEditing === next.isAnotherCellEditing
  );
}

export const AccountsTableRow = memo(AccountsTableRowComponent, areEqual);
