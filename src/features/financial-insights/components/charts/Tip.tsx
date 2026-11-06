"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

/**
 * The one tooltip every Financial Insights chart uses. A chart hands it content and the pointer position; it stays inside the
 * window. Content is built from numbers the page already holds, so hovering never reads anything.
 */
type TipApi = { show: (content: ReactNode, event: { clientX: number; clientY: number }) => void; hide: () => void };
const TipContext = createContext<TipApi>({ show: () => undefined, hide: () => undefined });
export const useTip = () => useContext(TipContext);

export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ content: ReactNode; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const show = useCallback<TipApi["show"]>((content, e) => setTip({ content, x: e.clientX, y: e.clientY }), []);
  const hide = useCallback(() => setTip(null), []);
  // The position is set on the element itself once its size is known, so it stays inside the window without another render.
  useLayoutEffect(() => {
    const el = box.current;
    if (!tip || !el) return;
    const r = el.getBoundingClientRect();
    let left = tip.x + 14, top = tip.y + 14;
    if (left + r.width > window.innerWidth - 8) left = tip.x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = tip.y - r.height - 14;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }, [tip]);
  useEffect(() => { const off = () => setTip(null); window.addEventListener("scroll", off, true); return () => window.removeEventListener("scroll", off, true); }, []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <TipContext.Provider value={api}>
      {children}
      {tip && (
        <div ref={box} role="tooltip" style={{ position: "fixed", left: tip.x + 14, top: tip.y + 14, zIndex: 80 }}
          className="pointer-events-none w-max min-w-52 max-w-[min(30rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
          {tip.content}
        </div>
      )}
    </TipContext.Provider>
  );
}

/**
 * A line of a tooltip: an optional colour key, a name and a value. `strong` is for the line that is the answer (the total, the
 * net, the closing figure), so it reads first among the parts it sums up: both its name and its value are bold and full strength.
 */
export function TipRow({ colour, name, value, strong = false }: { colour?: string; name: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className={strong ? "flex min-w-0 items-center gap-1.5 font-semibold text-foreground" : "flex min-w-0 items-center gap-1.5 text-muted-foreground"}>{colour && <span className="size-2 shrink-0 rounded-sm" style={{ background: colour }} aria-hidden />}{name}</span>
      <span className={strong ? "shrink-0 whitespace-nowrap font-semibold tabular-nums text-foreground" : "shrink-0 whitespace-nowrap font-medium tabular-nums"}>{value}</span>
    </div>
  );
}
export const TipTitle = ({ children }: { children: ReactNode }) => <p className="mb-1 font-semibold">{children}</p>;
export const TipNote = ({ children }: { children: ReactNode }) => <div className="mt-1 border-t border-border pt-1 text-muted-foreground">{children}</div>;

/** The width of an element, kept current, so a chart can draw at its real size. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 600): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
