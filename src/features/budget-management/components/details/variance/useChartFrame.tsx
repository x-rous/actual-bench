"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Width tracking and a hover tooltip for the dialog's SVG charts.
 *
 * Charts are drawn at the width they are given rather than scaled from a fixed
 * box, so type stays the same size on every screen. The element is held in
 * state, not a ref: the dialog's contents mount after it opens, and a ref
 * would not tell the observer its element had arrived.
 */
export function useChartFrame() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; node: ReactNode } | null>(null);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const showTip = useCallback(
    (clientX: number, clientY: number, node: ReactNode) => {
      if (!element) return;
      const box = element.getBoundingClientRect();
      setTip({ x: clientX - box.left, y: clientY - box.top, node });
    },
    [element]
  );
  const hideTip = useCallback(() => setTip(null), []);

  return { attach: setElement, width, tip, showTip, hideTip };
}

/** The tooltip box, positioned inside the chart's relatively positioned frame. */
export function ChartTip({
  tip,
  width,
}: {
  tip: { x: number; y: number; node: ReactNode } | null;
  width: number;
}) {
  if (!tip) return null;
  const flip = tip.x > width * 0.6;
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-20 w-max max-w-[15rem] rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] leading-snug text-popover-foreground shadow-md"
      )}
      style={{
        top: Math.max(0, tip.y - 8),
        ...(flip ? { right: Math.max(0, width - tip.x + 12) } : { left: tip.x + 12 }),
      }}
    >
      {tip.node}
    </div>
  );
}

/** One label/value line in a tooltip. */
export function TipRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export const FAVOURABLE_TEXT = "text-emerald-600 dark:text-emerald-400";
export const UNFAVOURABLE_TEXT = "text-destructive";
