"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Columns3, Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export const PdfSourcePreview = memo(function PdfSourcePreview({
  page,
  previewDataUrl,
  regions,
  columns,
  highlightedSourceIds,
  selectedRowId,
  calibration,
  showPageMetadata = true,
  drawRegion = false,
  zoom,
  onZoomChange,
  columnMappingsVisible,
  onToggleColumnMappings,
  focusColumnRequest = null,
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
  zoom: number;
  onZoomChange: (zoom: number) => void;
  columnMappingsVisible?: boolean;
  onToggleColumnMappings?: () => void;
  focusColumnRequest?: { columnId: string; requestId: number } | null;
  onSelectRow: (rowId: string) => void;
  onToggleRegion: (regionId: string) => void;
  onColumnChange: (columnId: string, edge: "start" | "end", value: number) => void;
  onDrawRegion?: (box: { x: number; y: number; width: number; height: number }) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingZoomAnchor = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const [drag, setDrag] = useState<{ columnId: string; edge: "start" | "end" } | null>(null);
  const [regionStart, setRegionStart] = useState<{ x: number; y: number } | null>(null);
  const [regionDraft, setRegionDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  function pagePointAtViewportCenter() {
    const container = scrollRef.current;
    const pageElement = pageRef.current;
    if (!container || !pageElement || pageElement.offsetWidth === 0 || pageElement.offsetHeight === 0) {
      return { x: 0.5, y: 0.5 };
    }
    return {
      x: clamp((container.scrollLeft + container.clientWidth / 2 - pageElement.offsetLeft) / pageElement.offsetWidth),
      y: clamp((container.scrollTop + container.clientHeight / 2 - pageElement.offsetTop) / pageElement.offsetHeight),
    };
  }

  function scrollToPagePoint(x: number, y: number, behavior: ScrollBehavior) {
    const container = scrollRef.current;
    const pageElement = pageRef.current;
    if (!container || !pageElement) return;
    scrollContainer(container, {
      left: pageElement.offsetLeft + x * pageElement.offsetWidth - container.clientWidth / 2,
      top: pageElement.offsetTop + y * pageElement.offsetHeight - container.clientHeight / 2,
      behavior,
    });
  }

  function changeZoom(nextZoom: number) {
    const normalized = Math.max(PDF_MIN_ZOOM, Math.min(PDF_MAX_ZOOM, nextZoom));
    if (normalized === zoom) return;
    pendingZoomAnchor.current = { ...pagePointAtViewportCenter(), zoom: normalized };
    onZoomChange(normalized);
  }

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchor.current;
    if (!anchor || anchor.zoom !== zoom) return;
    scrollToPagePoint(anchor.x, anchor.y, "auto");
    pendingZoomAnchor.current = null;
  }, [zoom]);

  useEffect(() => {
    const matching = page.tokens.filter((token) => highlightedSourceIds.has(token.id));
    if (!matching.length) return;
    const left = Math.min(...matching.map((token) => token.x));
    const right = Math.max(...matching.map((token) => token.x + token.width));
    const top = Math.min(...matching.map((token) => token.y));
    const bottom = Math.max(...matching.map((token) => token.y + token.height));
    const frame = requestAnimationFrame(() => {
      if (isPageBoxComfortablyVisible(scrollRef.current, pageRef.current, page.width, page.height, { left, right, top, bottom })) return;
      scrollToPagePoint((left + right) / 2 / page.width, (top + bottom) / 2 / page.height, "smooth");
    });
    return () => cancelAnimationFrame(frame);
  }, [highlightedSourceIds, page.height, page.pageNumber, page.tokens, page.width]);

  useEffect(() => {
    if (!focusColumnRequest) return;
    const column = columns.find((entry) => entry.id === focusColumnRequest.columnId && columnAppliesToPage(entry, page.pageNumber));
    if (!column) return;
    const bounds = columnBoundsForPage(column, page.width);
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      const pageElement = pageRef.current;
      if (!container || !pageElement) return;
      const x = (bounds.xStart + bounds.xEnd) / 2 / page.width;
      scrollContainer(container, {
        left: pageElement.offsetLeft + x * pageElement.offsetWidth - container.clientWidth / 2,
        top: container.scrollTop,
        behavior: "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [columns, focusColumnRequest, page.pageNumber, page.width]);

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
      <div className="relative min-h-0 flex-1">
        <div className="absolute left-2 top-2 z-[70] flex gap-1" role="group" aria-label="PDF viewer controls">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Zoom out PDF"
            title={`Zoom out PDF (${Math.round(zoom * 100)}%)`}
            disabled={zoom <= PDF_MIN_ZOOM}
            onClick={() => changeZoom(zoom - PDF_ZOOM_STEP)}
          >
            <Minus aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Zoom in PDF"
            title={`Zoom in PDF (${Math.round(zoom * 100)}%)`}
            disabled={zoom >= PDF_MAX_ZOOM}
            onClick={() => changeZoom(zoom + PDF_ZOOM_STEP)}
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Fit PDF to width"
            title={`Fit PDF to width (currently ${Math.round(zoom * 100)}%)`}
            disabled={zoom === PDF_DEFAULT_ZOOM}
            onClick={() => changeZoom(PDF_DEFAULT_ZOOM)}
          >
            <Maximize2 aria-hidden="true" className="size-3.5" />
          </Button>
          {onToggleColumnMappings && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-label={columnMappingsVisible ? "Hide column mappings" : "Show column mappings"}
              aria-pressed={columnMappingsVisible}
              title={columnMappingsVisible ? "Hide column mappings" : "Show column mappings"}
              className={cn(columnMappingsVisible && "bg-accent text-accent-foreground")}
              onClick={onToggleColumnMappings}
            >
              <Columns3 aria-hidden="true" className="mr-1 size-3.5" />
              Columns
            </Button>
          )}
        </div>
        <div
          ref={scrollRef}
          tabIndex={0}
          aria-label={`PDF page ${page.pageNumber} viewer`}
          className="h-full overflow-auto rounded-md border bg-muted/30 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              changeZoom(zoom + PDF_ZOOM_STEP);
            } else if (event.key === "-") {
              event.preventDefault();
              changeZoom(zoom - PDF_ZOOM_STEP);
            } else if (event.key === "0") {
              event.preventDefault();
              changeZoom(PDF_DEFAULT_ZOOM);
            }
          }}
        >
        <div
          ref={pageRef}
          data-pdf-page-number={page.pageNumber}
          className="relative mx-auto bg-white text-black shadow-sm select-none"
          style={{
            aspectRatio: `${page.width} / ${page.height}`,
            width: `${zoom * 100}%`,
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
                highlightedSourceIds.has(token.id) && cn(
                  "z-20 rounded-sm",
                  calibration ? "bg-sky-300/35" : "bg-sky-300/45"
                )
              )}
              data-pdf-source-highlight={highlightedSourceIds.has(token.id) ? "true" : undefined}
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
              data-pdf-region-overlay={calibration ? "detection" : "review"}
              className={cn(
                "pointer-events-none absolute z-10",
                calibration
                  ? cn(
                      "border-2",
                      region.included ? "border-emerald-500/70" : "border-amber-500/60",
                      !drag && (region.included ? "bg-emerald-300/5" : "bg-amber-300/10")
                    )
                  : cn("border", region.included ? "border-emerald-500/45" : "border-amber-500/45")
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
    </div>
  );
});

export const PDF_MIN_ZOOM = 0.75;
export const PDF_DEFAULT_ZOOM = 1;
export const PDF_MAX_ZOOM = 2;
export const PDF_ZOOM_STEP = 0.25;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function isPageBoxComfortablyVisible(
  container: HTMLDivElement | null,
  pageElement: HTMLDivElement | null,
  pageWidth: number,
  pageHeight: number,
  box: { left: number; right: number; top: number; bottom: number }
) {
  if (!container || !pageElement || pageElement.offsetWidth === 0 || pageElement.offsetHeight === 0) return false;
  const padding = 24;
  const left = pageElement.offsetLeft + box.left / pageWidth * pageElement.offsetWidth;
  const right = pageElement.offsetLeft + box.right / pageWidth * pageElement.offsetWidth;
  const top = pageElement.offsetTop + box.top / pageHeight * pageElement.offsetHeight;
  const bottom = pageElement.offsetTop + box.bottom / pageHeight * pageElement.offsetHeight;
  return left >= container.scrollLeft + padding
    && right <= container.scrollLeft + container.clientWidth - padding
    && top >= container.scrollTop + padding
    && bottom <= container.scrollTop + container.clientHeight - padding;
}

function scrollContainer(element: HTMLDivElement, options: ScrollToOptions) {
  const left = Math.max(0, options.left ?? element.scrollLeft);
  const top = Math.max(0, options.top ?? element.scrollTop);
  if (typeof element.scrollTo === "function") element.scrollTo({ ...options, left, top });
  else {
    element.scrollLeft = left;
    element.scrollTop = top;
  }
}
