"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Reads a `?highlight=<id>` query param, scrolls the matching
 * `[data-row-id]` element into view, briefly highlights it, then
 * clears the param from the URL.
 *
 * Returns `highlightedId` — apply to table rows as:
 *   className={highlightedId === entity.id ? "bg-primary/20 ring-2 ring-inset ring-primary/40" : ""}
 */
export function useHighlight() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    const id = searchParams.get("highlight");
    if (!id) return;

    const el = document.querySelector(`[data-row-id="${id}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });

    // Defer setState to avoid synchronous setState-in-effect lint error
    const tSet   = setTimeout(() => setHighlightedId(id), 0);
    const tClear = setTimeout(() => {
      setHighlightedId(null);
      router.replace(pathname, { scroll: false });
    }, 2500);

    return () => { clearTimeout(tSet); clearTimeout(tClear); };
  }, [searchParams, pathname, router]);

  return highlightedId;
}
