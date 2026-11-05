"use client";

import { useEffect, useState } from "react";

/**
 * The current time in milliseconds, read once when the component first renders and again every `refreshMs`. A component that shows
 * "runs in 5 minutes" takes the time from here rather than calling `Date.now()` while rendering, which is not pure: it would show
 * a different answer for the same props, and the time it shows would only move when something else happened to re-render it.
 */
export function useNowMs(refreshMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
  return now;
}
