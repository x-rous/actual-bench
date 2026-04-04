"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { RotateCcw, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import type { Account } from "@/types/entities";
import type { StagedEntity } from "@/types/staged";
import { InlineTextCell } from "../components/InlineTextCell";

type AccountRow = StagedEntity<Account>;

const col = createColumnHelper<AccountRow>();

/** Row-state indicator bar — colored left border column */
function RowIndicator({ row }: { row: AccountRow }) {
  return (
    <div
      className={cn(
        "h-full w-1 rounded-sm",
        row.saveError && "bg-destructive",
        !row.saveError && row.isDeleted && "bg-staged-deleted/40",
        !row.saveError && !row.isDeleted && row.isNew && "bg-staged-new",
        !row.saveError && !row.isDeleted && !row.isNew && row.isUpdated && "bg-staged-updated"
      )}
    />
  );
}

export function useAccountColumns(onEdit: (id: string) => void) {
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const revertEntity = useStagedStore((s) => s.revertEntity);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  return useMemo(
    () => [
      col.display({
        id: "_indicator",
        size: 12,
        enableResizing: false,
        header: () => null,
        cell: ({ row }) => <RowIndicator row={row.original} />,
      }),

      col.accessor((row) => row.entity.name, {
        id: "name",
        header: "Account Name",
        cell: ({ getValue, row }) => {
          const { entity, isDeleted } = row.original;
          if (isDeleted) {
            return (
              <span className="text-muted-foreground line-through">
                {getValue() as string}
              </span>
            );
          }
          return (
            <InlineTextCell
              value={getValue() as string}
              onCommit={(val) => {
                pushUndo();
                stageUpdate("accounts", entity.id, { name: val });
              }}
              placeholder="Account name"
            />
          );
        },
      }),

      col.accessor((row) => row.entity.offBudget, {
        id: "offBudget",
        header: "Budget",
        size: 130,
        cell: ({ getValue, row }) => {
          const { entity, isDeleted } = row.original;
          const isOffBudget = getValue() as boolean;
          return (
            <button
              disabled={isDeleted}
              onClick={() => {
                pushUndo();
                stageUpdate("accounts", entity.id, { offBudget: !isOffBudget });
              }}
              className="disabled:pointer-events-none"
              title="Click to toggle"
            >
              <Badge variant={isOffBudget ? "secondary" : "outline"}>
                {isOffBudget ? "Off Budget" : "On Budget"}
              </Badge>
            </button>
          );
        },
      }),

      col.accessor((row) => row.entity.closed, {
        id: "status",
        header: "Status",
        size: 110,
        cell: ({ getValue }) => {
          const closed = getValue() as boolean;
          return (
            <Badge variant={closed ? "secondary" : "default"}>
              {closed ? "Closed" : "Open"}
            </Badge>
          );
        },
      }),

      col.display({
        id: "_actions",
        size: 200,
        header: () => null,
        cell: ({ row }) => {
          const { entity, isNew, isUpdated, isDeleted } = row.original;
          const canRevert = isNew || isUpdated || isDeleted;

          return (
            <div className="flex items-center justify-end gap-1">
              {isDeleted ? (
                <span className="text-xs italic text-muted-foreground">
                  Pending deletion
                </span>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Edit"
                    onClick={() => onEdit(entity.id)}
                  >
                    <Pencil />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      pushUndo();
                      stageUpdate("accounts", entity.id, { closed: !entity.closed });
                    }}
                  >
                    {entity.closed ? "Reopen" : "Close"}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Delete"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      pushUndo();
                      stageDelete("accounts", entity.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}

              {canRevert && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Revert changes"
                  onClick={() => revertEntity("accounts", entity.id)}
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
          );
        },
      }),
    ],
    // Zustand action selectors are stable references — they never change
    // between renders, so including them in the dep array is safe and explicit.
    [stageUpdate, stageDelete, revertEntity, pushUndo, onEdit]
  );
}
