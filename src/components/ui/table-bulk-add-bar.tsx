"use client";

import { Button } from "@/components/ui/button";

type TableBulkAddBarProps = {
  bulkCount: number;
  onBulkCountChange: (count: number) => void;
  onAdd: (count: number) => void;
};

function normalizeBulkCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

export function TableBulkAddBar({
  bulkCount,
  onBulkCountChange,
  onAdd,
}: TableBulkAddBarProps) {
  return (
    <div className="flex items-center gap-2 border-t border-border/30 px-3 py-1.5">
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onAdd(1)}
      >
        + Add row
      </Button>
      <span className="text-xs text-muted-foreground">or add</span>
      <input
        type="number"
        min={1}
        max={100}
        value={bulkCount}
        onChange={(e) => onBulkCountChange(normalizeBulkCount(Number(e.target.value)))}
        className="h-6 w-12 rounded border border-border bg-background px-1.5 text-center text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <span className="text-xs text-muted-foreground">rows</span>
      <Button variant="outline" size="xs" onClick={() => onAdd(normalizeBulkCount(bulkCount))}>
        Add
      </Button>
    </div>
  );
}
