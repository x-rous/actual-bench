"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Paging for a statement that may be two pages or two hundred.
 *
 * Short statements get a plain label: a jump box beside "Page 1 of 2" is a
 * control for a problem nobody has. Once there are enough pages for stepping
 * to be tedious, the number becomes the way to get there directly.
 */
const JUMP_THRESHOLD = 5;

export function PdfPageControls({
  pageNumber,
  pageCount,
  onChange,
}: {
  pageNumber: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Previous PDF page"
        disabled={pageNumber <= 1}
        onClick={() => onChange(pageNumber - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      {pageCount > JUMP_THRESHOLD ? (
        <span className="flex items-center gap-1 text-xs whitespace-nowrap">
          <label htmlFor="pdf-page-number" className="sr-only">Go to PDF page</label>
          <input
            id="pdf-page-number"
            type="number"
            min={1}
            max={pageCount}
            value={pageNumber}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 1 && next <= pageCount) onChange(next);
            }}
            className="h-6 w-12 rounded border border-border bg-background px-1 text-center tabular-nums outline-none focus:ring-1 focus:ring-ring"
          />
          of {pageCount}
        </span>
      ) : (
        <span className="min-w-20 text-center text-xs">Page {pageNumber} of {pageCount}</span>
      )}
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Next PDF page"
        disabled={pageNumber >= pageCount}
        onClick={() => onChange(pageNumber + 1)}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
