"use client";

import { useCallback, useState } from "react";

/** Keep the inspector aligned with the adjacent table as its header resizes. */
export function useTableHeaderHeight() {
  const [headerHeight, setHeaderHeight] = useState<number>();
  const headerRef = useCallback((node: HTMLTableSectionElement | null) => {
    if (!node) return;
    const measure = () => {
      const height = node.getBoundingClientRect().height;
      if (height > 0) setHeaderHeight(height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { headerHeight, headerRef };
}
