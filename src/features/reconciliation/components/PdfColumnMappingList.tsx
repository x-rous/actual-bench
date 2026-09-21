"use client";

import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import type { PdfColumn, PdfColumnRole } from "@/lib/reconciliation/statement/pdf";
import { columnRoleLabel, PDF_COLUMN_ROLE_GROUPS } from "../lib/pdfReviewTable";
import { pdfColumnColor } from "./PdfSourcePreview";

/**
 * What each column of the statement holds.
 *
 * Each mapping reads as a card rather than a table row: the role and its
 * controls on one line, and underneath, the values actually read from the
 * page - which is the only evidence that the mapping is right, and so should
 * not be the part that gets truncated first.
 */
export function PdfColumnMappingList({
  columns,
  examples,
  disabled,
  onChangeRole,
  onMove,
  onRemove,
  onFocusColumn,
}: {
  columns: PdfColumn[];
  examples: Map<string, string[]>;
  disabled: boolean;
  onChangeRole: (id: string, role: PdfColumnRole) => void;
  onMove: (id: string, offset: -1 | 1) => void;
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
            className="grid grid-cols-[0.25rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5"
            onPointerDownCapture={() => onFocusColumn(column)}
            onFocusCapture={() => onFocusColumn(column)}
          >
            <span
              aria-hidden="true"
              className="row-span-2 h-full min-h-7 w-1 rounded-full"
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
            <div className="flex items-center">
              {/*
                These swap two mappings, and the columns they describe swap
                places on the page with them - which is the point, but is not
                what "move left" says on its own, so the title says it.
              */}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${column.role} column left`}
                title={`Swap ${label} with the mapping to its left, on the page too`}
                disabled={disabled || columnIndex === 0}
                onClick={() => onMove(column.id, -1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${column.role} column right`}
                title={`Swap ${label} with the mapping to its right, on the page too`}
                disabled={disabled || columnIndex === columns.length - 1}
                onClick={() => onMove(column.id, 1)}
              >
                <ChevronRight className="size-3.5" />
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
            <p
              className="col-start-2 col-end-4 min-w-0 truncate text-[11px] text-muted-foreground"
              title={values.join(" · ")}
            >
              Examples: {values.join(" · ") || "No matching value read yet"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
