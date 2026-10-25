"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { Bucket, Marker, MarkerKind } from "./timeline";

export const MARKER_COLORS: Record<MarkerKind, string> = { in: "#16a34a", revalue: "#f59e0b", out: "#dc2626", depreciation: "#64748b", operating: "#94a3b8", financing: "#6366f1" };
/** Left and right space that match the charts' Y-axis and margins, so each column sits under its bar. */
const LEFT = 8 + 64; const RIGHT = 16;

function Glyph({ kind }: { kind: MarkerKind }) {
  const color = MARKER_COLORS[kind];
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    {kind === "depreciation" ? <rect x="5" y="1" width="2" height="10" rx="1" fill={color} /> : kind === "operating" ? <circle cx="6" cy="6" r="2.5" fill="none" stroke={color} strokeWidth="1.5" /> : kind === "financing" ? <circle cx="6" cy="6" r="4" fill={color} /> : <path d="M6 0.5l5 5.5-5 5.5-5-5.5z" fill={color} />}
  </svg>;
}

/**
 * The chart's event markers as one toolbar (a single tab stop; arrow keys, Home and End move between markers; Enter
 * opens the transactions behind one). Columns line up with the charts' buckets.
 */
export function MarkerLane({ label, buckets, markers, describe, onSelect, onFocusBucket }: { label: string; buckets: Bucket[]; markers: Marker[]; describe: (marker: Marker) => string; onSelect: (marker: Marker) => void; /** Called when a marker takes focus, so a summary can follow the keyboard as it follows the pointer. */ onFocusBucket?: (index: number) => void }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (markers.length === 0) return null;
  const sorted = [...markers].sort((a, b) => a.index - b.index);
  const move = (to: number) => { const next = Math.max(0, Math.min(sorted.length - 1, to)); setActive(next); refs.current[next]?.focus(); };
  function onKeyDown(event: KeyboardEvent) {
    const keys: Record<string, number> = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: sorted.length - 1 };
    if (event.key in keys) { event.preventDefault(); move(keys[event.key]); }
  }
  return <div role="toolbar" aria-label={label} aria-orientation="horizontal" onKeyDown={onKeyDown} className="grid h-6 items-center" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`, paddingLeft: LEFT, paddingRight: RIGHT }}>
    {buckets.map((_, index) => <div key={index} className="flex justify-center gap-0.5">
      {sorted.map((marker, position) => marker.index !== index ? null : <button key={`${marker.kind}-${marker.types.join()}-${marker.note ?? ""}`} ref={(el) => { refs.current[position] = el; }} type="button" tabIndex={position === active ? 0 : -1} aria-label={describe(marker)} title={describe(marker)}
        onFocus={() => { setActive(position); onFocusBucket?.(marker.index); }} onClick={() => onSelect(marker)} className={cn("flex h-5 min-w-4 items-center justify-center gap-0.5 rounded px-0.5 text-[9px] leading-none text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring")}>
        <Glyph kind={marker.kind} />{marker.count > 1 && <span aria-hidden>{marker.count}</span>}
      </button>)}
    </div>)}
  </div>;
}
