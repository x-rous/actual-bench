"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  computeThumb,
  scrollPosFromThumbDelta,
  type ThumbGeometry,
} from "../lib/overlayScrollbar";

type Props = {
  children: ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
};

/**
 * A scroll container whose scrollbars float over the content.
 *
 * Native scrollbars reserve layout width on Windows and Linux, so expanding a
 * category group took width from the grid and shifted the column the pointer
 * was over. Reserving the gutter permanently fixes the shift but spends the
 * width all the time; drawing the thumb ourselves spends none of it.
 *
 * The element that scrolls is still a plain `overflow-auto` div, so the wheel,
 * keyboard, touch, sticky headers and `scrollIntoView` all behave exactly as
 * they did - only the painted scrollbar is ours.
 */
export function OverlayScrollArea({ children, className = "", onClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vertical, setVertical] = useState<ThumbGeometry>(null);
  const [horizontal, setHorizontal] = useState<ThumbGeometry>(null);
  const [active, setActive] = useState(false);
  const dragRef = useRef<{
    axis: "y" | "x";
    startPointer: number;
    startScroll: number;
  } | null>(null);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setVertical(
      computeThumb(el.scrollTop, el.clientHeight, el.scrollHeight, el.clientHeight)
    );
    setHorizontal(
      computeThumb(el.scrollLeft, el.clientWidth, el.scrollWidth, el.clientWidth)
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    // Content changes as often as the viewport does - expanding a group, or
    // switching months - so watch both rather than only the window.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, children]);

  const beginDrag = (axis: "y" | "x") => (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      axis,
      startPointer: axis === "y" ? e.clientY : e.clientX,
      startScroll: axis === "y" ? el.scrollTop : el.scrollLeft,
    };
    setActive(true);
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag || !el) return;
    const delta =
      (drag.axis === "y" ? e.clientY : e.clientX) - drag.startPointer;
    const next =
      drag.axis === "y"
        ? scrollPosFromThumbDelta(
            drag.startScroll,
            delta,
            el.clientHeight,
            el.scrollHeight,
            el.clientHeight
          )
        : scrollPosFromThumbDelta(
            drag.startScroll,
            delta,
            el.clientWidth,
            el.scrollWidth,
            el.clientWidth
          );
    if (drag.axis === "y") el.scrollTop = next;
    else el.scrollLeft = next;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setActive(false);
  };

  // Fade the thumbs back out once scrolling stops, so a static grid is clean.
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = () => {
    measure();
    setActive(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (!dragRef.current) setActive(false);
    }, 900);
  };
  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const thumbClass =
    "pointer-events-auto absolute rounded-full bg-foreground/30 hover:bg-foreground/45 transition-opacity";

  return (
    <div className={`relative min-h-0 ${className}`} onMouseEnter={() => setActive(true)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={onClick}
        // The native bars are hidden, not removed: this is still the element
        // that scrolls, so sticky offsets and scrollIntoView are unaffected.
        className="h-full w-full overflow-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {vertical && (
        <div
          aria-hidden="true"
          className={`${thumbClass} right-0.5 w-1.5 ${active ? "opacity-100" : "opacity-0"}`}
          style={{ top: vertical.offset, height: vertical.size }}
          onPointerDown={beginDrag("y")}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
      {horizontal && (
        <div
          aria-hidden="true"
          className={`${thumbClass} bottom-0.5 h-1.5 ${active ? "opacity-100" : "opacity-0"}`}
          style={{ left: horizontal.offset, width: horizontal.size }}
          onPointerDown={beginDrag("x")}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
    </div>
  );
}
