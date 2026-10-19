"use client";

import { createElement, useEffect, useState, type ComponentType, type ReactNode } from "react";

/**
 * A chart module loaded on demand without Suspense. `next/dynamic` suspends, and React holds a
 * Suspense fallback for at least ~300 ms, so even a preloaded chart appeared late. Here the chart
 * renders directly once its module is in memory, and `preload` warms it in idle time.
 */
export function lazyChart<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () => (pending ??= load().then((module) => (loaded = module.default)));

  function LazyChart({ fallback, ...props }: P & { fallback?: ReactNode }) {
    const [ready, setReady] = useState(() => loaded !== null);
    useEffect(() => {
      if (ready) return;
      let live = true;
      void preload().then(() => { if (live) setReady(true); });
      return () => { live = false; };
    }, [ready]);
    return ready && loaded ? createElement(loaded, props as unknown as P) : <>{fallback ?? null}</>;
  }
  return { Chart: LazyChart, preload };
}

/** Warm chart modules when the browser is idle, so the first chart a user opens draws at once. */
export function preloadWhenIdle(preload: () => unknown) {
  if (typeof window === "undefined") return () => {};
  const idle = window.requestIdleCallback?.(() => preload(), { timeout: 3000 });
  const timer = idle === undefined ? window.setTimeout(() => preload(), 1500) : undefined;
  return () => {
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
