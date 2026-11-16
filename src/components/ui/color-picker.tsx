"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Three tones (light, base, dark) of each hue, then greys: the palette is for a quick, good-looking choice. */
const HUES = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899"];
const TONES = [
  ["#fca5a5", "#fdba74", "#fde047", "#bef264", "#86efac", "#5eead4", "#67e8f9", "#93c5fd", "#a5b4fc", "#c4b5fd", "#f0abfc", "#f9a8d4"],
  HUES,
  ["#b91c1c", "#c2410c", "#a16207", "#4d7c0f", "#15803d", "#0f766e", "#0e7490", "#1d4ed8", "#4338ca", "#6d28d9", "#a21caf", "#be185d"],
  ["#f3f4f6", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827", "#000000", "#ffffff", "#78716c", "#44403c"],
];

const HEX = /^#[0-9a-f]{6}$/i;
const normalize = (text: string): string | null => {
  const t = text.trim().replace(/^#?/, "#").toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return HEX.test(t) ? t : null;
};

type Hsv = { h: number; s: number; v: number };
function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * One colour picker for the app. A palette for a quick choice, and a custom mode (colour field, hue slider and a hex box) for an
 * exact one. Changes apply as they are made. `children` replaces the default round swatch as what opens it.
 */
export function ColorPicker({ value, onChange, onClear, ariaLabel, fallback = "#9ca3af", children, className }: {
  value: string | null | undefined;
  onChange: (hex: string) => void;
  /** When given, a Clear button removes the colour. */
  onClear?: () => void;
  ariaLabel: string;
  /** Shown by the default swatch when there is no value. */
  fallback?: string;
  children?: ReactNode;
  className?: string;
}) {
  const current = value ? normalize(value) : null;
  const [mode, setMode] = useState<"palette" | "custom">("palette");
  // The one swatch in the tab order: the chosen colour, or the first when the colour is not from the palette.
  const inPalette = !!current && TONES.flat().includes(current);
  return (
    <Popover>
      <PopoverTrigger
        aria-label={ariaLabel}
        className={cn(children ? "" : "size-5 shrink-0 cursor-pointer rounded-full border border-border/60 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring", className)}
        style={children ? undefined : { backgroundColor: current ?? fallback }}
      >
        {children}
      </PopoverTrigger>
      {/* The popover is portalled, but React events still reach the grid it was opened from: arrows here are the picker's own. */}
      <PopoverContent align="start" className="w-64 space-y-3 p-3" onKeyDown={(e) => { if (e.key.startsWith("Arrow")) e.stopPropagation(); }}>
        <div role="tablist" aria-label="Colour mode" className="grid grid-cols-2 gap-px rounded-md border border-border bg-muted/40 p-px text-xs">
          {(["palette", "custom"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded px-2 py-1 font-medium", mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{m === "palette" ? "Palette" : "Custom"}</button>
          ))}
        </div>
        {mode === "palette" ? (
          <div
            className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Palette"
            onKeyDown={(e) => {
              // Arrows move through the colours and choose as they go; Tab leaves the palette.
              const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[e.key];
              if (!step) return;
              const swatches = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
              const at = swatches.indexOf(document.activeElement as HTMLButtonElement);
              const next = swatches[at + step];
              if (at < 0 || !next) return;
              e.preventDefault();
              next.focus();
              next.click();
            }}
          >
            {TONES.flat().map((hex, i) => (
              <button key={hex} type="button" role="radio" tabIndex={(inPalette ? current === hex : i === 0) ? 0 : -1} aria-checked={current === hex} aria-label={hex} title={hex} onClick={() => onChange(hex)} style={{ backgroundColor: hex }} className="flex size-7 items-center justify-center rounded-md border border-border/60 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring">
                {current === hex && <Check className={cn("size-3.5", isLight(hex) ? "text-black" : "text-white")} aria-hidden />}
              </button>
            ))}
          </div>
        ) : <Custom current={current ?? fallback} onChange={onChange} />}
        {onClear && current && <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">Clear colour</button>}
      </PopoverContent>
    </Popover>
  );
}

const isLight = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160; };

function Custom({ current, onChange }: { current: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(current));
  const [text, setText] = useState(current);
  const area = useRef<HTMLDivElement>(null);
  // An outside change (the palette, undo) moves the picker; its own changes keep the hue a grey would lose.
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    if (hsvToHex(hsv) !== current) { setHsv(hexToHsv(current)); setText(current); }
  }
  const apply = (next: Hsv) => { setHsv(next); const hex = hsvToHex(next); setSeen(hex); setText(hex); onChange(hex); };
  const fromPointer = (e: React.PointerEvent) => {
    const box = area.current!.getBoundingClientRect();
    apply({ ...hsv, s: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), v: 1 - Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) });
  };
  const hue = `hsl(${hsv.h} 100% 50%)`;
  return (
    <div className="space-y-3">
      <div
        ref={area} role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`} aria-valuenow={Math.round(hsv.s * 100)}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e); }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
          if (d) { e.preventDefault(); apply({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + d[0])), v: Math.min(1, Math.max(0, hsv.v + d[1])) }); }
        }}
        className="relative h-32 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ backgroundColor: hue, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}
      >
        <span aria-hidden className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hsvToHex(hsv) }} />
      </div>
      {/* eslint-disable-next-line no-restricted-syntax -- a range slider, not a text field */}
      <input
        type="range" min={0} max={360} value={Math.round(hsv.h)} aria-label="Hue" onChange={(e) => apply({ ...hsv, h: Number(e.target.value) })}
        className="h-3 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      />
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-7 shrink-0 rounded-md border border-border/60" style={{ backgroundColor: hsvToHex(hsv) }} />
        <Input
          aria-label="Hex colour" value={text} maxLength={7} spellCheck={false}
          onChange={(e) => { setText(e.target.value); const hex = normalize(e.target.value); if (hex && e.target.value.length >= 4) { setHsv(hexToHsv(hex)); setSeen(hex); onChange(hex); } }}
          onBlur={() => setText(hsvToHex(hsv))}
          className="h-7 font-mono text-xs uppercase"
        />
      </div>
    </div>
  );
}
