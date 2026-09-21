"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import type { PdfColumn, PdfColumnRole } from "@/lib/reconciliation/statement/pdf";
import { columnRoleLabel, PDF_COLUMN_ROLE_GROUPS } from "../lib/pdfReviewTable";
import { pdfColumnColor } from "./PdfSourcePreview";

/**
 * What each column of the statement holds.
 *
 * One row per mapping. A statement can carry a dozen columns, and a list that
 * needs two rows each is a list you scroll instead of read: the whole point of
 * this panel is seeing the mapping as a set, against the coloured columns
 * drawn on the page beside it.
 */
export function PdfColumnMappingList({
  columns,
  examples,
  disabled,
  onChangeRole,
  onMove,
  onInsertAfter,
  onRemove,
  onFocusColumn,
}: {
  columns: PdfColumn[];
  examples: Map<string, string[]>;
  disabled: boolean;
  onChangeRole: (id: string, role: PdfColumnRole) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onInsertAfter: (afterId: string) => void;
  onRemove: (id: string) => void;
  onFocusColumn: (column: PdfColumn) => void;
}) {
  return (
    <div className="space-y-2">
      {columns.map((column, columnIndex) => {
        const values = examples.get(column.id) ?? [];
        const label = columnRoleLabel(column.role);
        return (
          <div
            key={column.id}
            className="grid grid-cols-[0.25rem_minmax(10rem,1fr)_minmax(0,0.8fr)_auto] items-center gap-2 rounded-md border px-2 py-1"
            onPointerDownCapture={() => onFocusColumn(column)}
            onFocusCapture={() => onFocusColumn(column)}
          >
            <span
              aria-hidden="true"
              className="h-7 w-1 rounded-full"
              style={{ backgroundColor: pdfColumnColor(columnIndex).border }}
            />
            <SelectField
              aria-label={`Role for mapped column ${columnIndex + 1}`}
              value={column.role}
              disabled={disabled}
              onChange={(event) => onChangeRole(column.id, event.target.value as PdfColumnRole)}
              className="text-xs font-medium"
            >
              {PDF_COLUMN_ROLE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.roles.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </optgroup>
              ))}
            </SelectField>
            <p
              className="min-w-0 truncate text-[10px] text-muted-foreground"
              title={values.join(" · ")}
            >
              Examples: {values.join(" · ") || "No matching value read yet"}
            </p>
            <div className="flex items-center">
              {/*
                The list runs down the panel while the columns run across the
                page, so the arrows follow the axis the reader is looking at
                and the title says what happens to the page.
              */}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${column.role} column up`}
                title={`Swap ${label} with the mapping above, moving it left on the page`}
                disabled={disabled || columnIndex === 0}
                onClick={() => onMove(column.id, -1)}
              >
                <ChevronUp className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${column.role} column down`}
                title={`Swap ${label} with the mapping below, moving it right on the page`}
                disabled={disabled || columnIndex === columns.length - 1}
                onClick={() => onMove(column.id, 1)}
              >
                <ChevronDown className="size-3.5" />
              </Button>
              {/* A statement often has a column the detection missed between
                  two it found, and the place to say so is between them. */}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Add a column after ${column.role}`}
                title={`Map a column between ${label} and the one to its right`}
                disabled={disabled}
                onClick={() => onInsertAfter(column.id)}
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${column.role} column`}
                title={`Stop reading a ${label.toLowerCase()} from this part of the page`}
                disabled={disabled}
                onClick={() => onRemove(column.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
