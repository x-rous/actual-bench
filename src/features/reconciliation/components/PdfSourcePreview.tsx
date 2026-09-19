"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PdfColumn, PdfReconstructedPage, PdfRegion } from "@/lib/reconciliation/statement/pdf";
import { columnAppliesToPage, columnBoundsForPage, columnCoordinateToReference } from "@/lib/reconciliation/statement/pdf/columns";

export function pdfColumnColor(index: number) {
  // Transaction regions already use green and amber. Keep column mappings in a
  // deliberately alternating palette so adjacent mappings remain easy to tell apart.
  const colors = [
    "#2563eb", // blue
    "#c026d3", // fuchsia
    "#0891b2", // cyan
    "#dc2626", // red
    "#7c3aed", // violet
    "#475569", // slate
    "#db2777", // pink
    "#1e40af", // navy
    "#0e7490", // deep cyan
    "#9f1239", // maroon
    "#4338ca", // indigo
    "#86198f", // deep fuchsia
  ];
  const border = colors[index % colors.length];
  return {
    border,
    fill: `${border}18`,
  };
}

export function PdfSourcePreview({
  page,
  previewDataUrl,
  regions,
  columns,
  highlightedSourceIds,
  selectedRowId,
  calibration,
  showPageMetadata = true,
  drawRegion = false,
  onSelectRow,
  onToggleRegion,
  onColumnChange,
  onDrawRegion,
}: {
  page: PdfReconstructedPage;
  previewDataUrl?: string | null;
  regions: PdfRegion[];
  columns: PdfColumn[];
  highlightedSourceIds: Set<string>;
  selectedRowId: string | null;
  calibration: boolean;
  showPageMetadata?: boolean;
  drawRegion?: boolean;
  onSelectRow: (rowId: string) => void;
  onToggleRegion: (regionId: string) => void;
  onColumnChange: (columnId: string, edge: "start" | "end", value: number) => void;
  onDrawRegion?: (box: { x: number; y: number; width: number; height: number }) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ columnId: string; edge: "start" | "end" } | null>(null);
  const [regionStart, setRegionStart] = useState<{ x: number; y: number } | null>(null);
  const [regionDraft, setRegionDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  function position(event: React.PointerEvent<HTMLDivElement>) {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(page.width, ((event.clientX - rect.left) / rect.width) * page.width));
  }

  function point(event: React.PointerEvent<HTMLDivElement>) {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(page.width, ((event.clientX - rect.left) / rect.width) * page.width)),
      y: Math.max(0, Math.min(page.height, ((event.clientY - rect.top) / rect.height) * page.height)),
    };
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (drawRegion && regionStart) {
      const current = point(event);
      setRegionDraft({
        x: Math.min(regionStart.x, current.x),
        y: Math.min(regionStart.y, current.y),
        width: Math.abs(current.x - regionStart.x),
        height: Math.abs(current.y - regionStart.y),
      });
      return;
    }
    if (!drag) return;
    const column = columns.find((entry) => entry.id === drag.columnId);
    const value = position(event);
    onColumnChange(
      drag.columnId,
      drag.edge,
      column ? columnCoordinateToReference(column, page.width, value) : value
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {showPageMetadata && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page.pageNumber}</span>
          <span>{Math.round(page.coverage * 1000) / 10}% text coverage</span>
        </div>
      )}
      {calibration && (
        <section aria-label="Page sections" className="flex shrink-0 items-center gap-2 overflow-x-auto rounded-md border bg-muted/20 px-2 py-1.5">
          <h4 className="shrink-0 text-xs font-medium">Sections</h4>
          {regions.length === 0 && <p className="whitespace-nowrap text-[11px] text-muted-foreground">No sections detected. Draw a transaction region to add one.</p>}
          {regions.map((region, index) => (
            <button
              key={region.id}
              type="button"
              aria-label={`${region.included ? "Ignore" : "Include"} section ${index + 1} from page sections`}
              aria-pressed={region.included}
              onClick={() => onToggleRegion(region.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                region.included
                  ? "border-emerald-600/70 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-200"
                  : "border-amber-600/70 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 dark:text-amber-200"
              )}
            >
              {index + 1} · {region.kind.replaceAll("-", " ")} · {region.included ? "Included" : "Ignored"}
            </button>
          ))}
        </section>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-3">
        <div
          ref={pageRef}
          className="relative mx-auto bg-white text-black shadow-sm select-none"
          style={{
            aspectRatio: `${page.width} / ${page.height}`,
            width: "min(100%, 52rem)",
            backgroundImage: previewDataUrl ? `url(${previewDataUrl})` : undefined,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "100% 100%",
          }}
          onPointerMove={move}
          onPointerDown={(event) => {
            if (!drawRegion) return;
            const start = point(event);
            setRegionStart(start);
            setRegionDraft({ ...start, width: 0, height: 0 });
          }}
          onPointerUp={() => {
            setDrag(null);
            if (drawRegion && regionDraft && regionDraft.width > 8 && regionDraft.height > 8) onDrawRegion?.(regionDraft);
            setRegionStart(null);
            setRegionDraft(null);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          {page.tokens.map((token) => (
            <span
              key={token.id}
              className={cn(
                "absolute overflow-hidden whitespace-nowrap leading-none",
                previewDataUrl && "text-transparent",
                highlightedSourceIds.has(token.id) && "z-20 rounded-sm bg-sky-300/80 ring-1 ring-sky-700"
              )}
              style={{
                left: `${token.x / page.width * 100}%`,
                top: `${token.y / page.height * 100}%`,
                width: `${Math.max(token.width / page.width * 100, 0.1)}%`,
                height: `${Math.max(token.height / page.height * 100, 0.1)}%`,
                fontSize: `${Math.max(5, token.fontHeight / page.height * 800)}px`,
              }}
              title={token.rawText}
            >
              {token.rawText}
            </span>
          ))}
          {page.rows.map((row) => (
            <button
              key={row.id}
              type="button"
              aria-label={`Select source row ${row.text}`}
              onClick={() => onSelectRow(row.id)}
              className={cn(
                "absolute z-30 border border-transparent bg-transparent",
                calibration && "hover:border-sky-500/70 hover:bg-sky-300/10",
                selectedRowId === row.id && "border-sky-600 bg-sky-300/15",
                drawRegion && "pointer-events-none"
              )}
              style={{
                left: `${row.x / page.width * 100}%`,
                top: `${row.y / page.height * 100}%`,
                width: `${row.width / page.width * 100}%`,
                height: `${Math.max(row.height / page.height * 100, 0.6)}%`,
              }}
            />
          ))}
          {regions.map((region) => (
            <div
              key={region.id}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute z-10 border-2",
                region.included ? "border-emerald-500/70" : "border-amber-500/60",
                !drag && (region.included ? "bg-emerald-300/5" : "bg-amber-300/10")
              )}
              style={{
                left: `${region.x / page.width * 100}%`,
                top: `${region.y / page.height * 100}%`,
                width: `${region.width / page.width * 100}%`,
                height: `${region.height / page.height * 100}%`,
              }}
            />
          ))}
          {calibration && !drawRegion && columns.filter((column) => columnAppliesToPage(column, page.pageNumber)).map((column) => {
            const columnIndex = columns.findIndex((entry) => entry.id === column.id);
            const color = pdfColumnColor(columnIndex);
            const bounds = columnBoundsForPage(column, page.width);
            return (
              <div
                key={column.id}
                className="pointer-events-none absolute inset-y-0 z-40 border-x"
                style={{
                  left: `${bounds.xStart / page.width * 100}%`,
                  width: `${Math.max(1, bounds.xEnd - bounds.xStart) / page.width * 100}%`,
                  borderColor: color.border,
                  backgroundColor: color.fill,
                }}
              >
                <span
                  aria-hidden="true"
                  className="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded px-1 py-0.5 text-[9px] font-semibold text-white shadow-sm"
                  style={{ backgroundColor: color.border }}
                >
                  {column.role.replaceAll("-", " ")}
                </span>
                {(["start", "end"] as const).map((edge) => (
                  <button
                    key={edge}
                    type="button"
                    aria-label={`Move ${column.role} column ${edge} boundary`}
                    className={cn(
                      "pointer-events-auto absolute inset-y-0 w-3 cursor-ew-resize bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      edge === "start" ? "-left-1.5" : "-right-1.5"
                    )}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      setDrag({ columnId: column.id, edge });
                    }}
                    onLostPointerCapture={() => setDrag(null)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const current = edge === "start" ? column.xStart : column.xEnd;
                      onColumnChange(column.id, edge, current + (event.key === "ArrowLeft" ? -2 : 2));
                    }}
                  />
                ))}
              </div>
            );
          })}
          {calibration && !drawRegion && regions.map((region, index) => (
            <button
              key={`region-control-${region.id}`}
              type="button"
              aria-label={`${region.included ? "Ignore" : "Include"} section ${index + 1} in PDF`}
              aria-pressed={region.included}
              onClick={() => onToggleRegion(region.id)}
              className={cn(
                "absolute z-50 max-w-44 truncate rounded border px-1.5 py-0.5 text-[9px] font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                region.included
                  ? "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700"
                  : "border-amber-700 bg-amber-400 text-amber-950 hover:bg-amber-500"
              )}
              style={{
                left: `${region.x / page.width * 100}%`,
                top: `${region.y / page.height * 100}%`,
                transform: "translate(0.25rem, 0.25rem)",
              }}
            >
              Section {index + 1} · {region.included ? "Included" : "Ignored"}
            </button>
          ))}
          {regionDraft && (
            <div
              className="pointer-events-none absolute z-50 border-2 border-sky-600 bg-sky-300/15"
              style={{
                left: `${regionDraft.x / page.width * 100}%`,
                top: `${regionDraft.y / page.height * 100}%`,
                width: `${regionDraft.width / page.width * 100}%`,
                height: `${regionDraft.height / page.height * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
