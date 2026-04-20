"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BudgetDiagnostic, DiagnosticSeverity } from "../types";

type SeverityFilter = "all" | DiagnosticSeverity;

const FILTERS: Array<{ id: SeverityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "error", label: "Errors" },
  { id: "warning", label: "Warnings" },
  { id: "info", label: "Infos" },
];

function SeverityBadge({ severity }: { severity: DiagnosticSeverity }) {
  const variant =
    severity === "error"
      ? "destructive"
      : severity === "warning"
        ? "status-warning"
        : "outline";
  return <Badge variant={variant}>{severity}</Badge>;
}

function SortIcon({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="h-3 w-3" />;
  if (sorted === "desc") return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3" />;
}

export function DiagnosticsTable({
  findings,
}: {
  findings: BudgetDiagnostic[];
}) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "severity", desc: false },
  ]);

  const filteredFindings = useMemo(() => {
    if (severityFilter === "all") return findings;
    return findings.filter((finding) => finding.severity === severityFilter);
  }, [findings, severityFilter]);

  const columns = useMemo<ColumnDef<BudgetDiagnostic>[]>(
    () => [
      {
        accessorKey: "severity",
        header: "Severity",
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
        sortingFn: (a, b) => {
          const rank: Record<DiagnosticSeverity, number> = {
            error: 0,
            warning: 1,
            info: 2,
          };
          return rank[a.original.severity] - rank[b.original.severity];
        },
      },
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <div className="font-mono text-xs text-foreground">{row.original.code}</div>
        ),
      },
      {
        accessorKey: "title",
        header: "Finding",
        cell: ({ row }) => (
          <div className="min-w-72">
            <div className="text-sm font-medium">{row.original.title}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {row.original.message}
            </div>
            {row.original.details && row.original.details.length > 0 && (
              <div className="mt-1 text-[11px] text-muted-foreground/80">
                {row.original.details.join(", ")}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "row",
        header: "Row",
        cell: ({ row }) => {
          const finding = row.original;
          if (!finding.table && !finding.rowId) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="max-w-56 truncate text-xs" title={`${finding.table ?? ""}:${finding.rowId ?? ""}`}>
              {finding.table}
              {finding.rowId ? `:${finding.rowId}` : ""}
            </div>
          );
        },
      },
      {
        id: "related",
        header: "Related",
        cell: ({ row }) => {
          const finding = row.original;
          if (!finding.relatedTable && !finding.relatedId) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div
              className="max-w-56 truncate text-xs"
              title={`${finding.relatedTable ?? ""}:${finding.relatedId ?? ""}`}
            >
              {finding.relatedTable}
              {finding.relatedId ? `:${finding.relatedId}` : ""}
            </div>
          );
        },
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredFindings,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => {
          const active = severityFilter === filter.id;
          return (
            <Button
              key={filter.id}
              type="button"
              variant={active ? "secondary" : "outline"}
              size="xs"
              onClick={() => setSeverityFilter(filter.id)}
            >
              {filter.label}
            </Button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="bg-muted/35 text-xs text-muted-foreground">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className="border-b border-border px-3 py-2 text-left font-medium"
                      >
                        {header.column.getCanSort() ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIcon sorted={sorted} />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No findings for this filter.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="align-top px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
