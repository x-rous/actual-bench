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
  // A failed import (a chunk error after a redeploy, a network blip) is forgotten, so the next mount retries.
  const preload = () => (pending ??= load().then((module) => (loaded = module.default), (error: unknown) => {
    pending = null;
    throw error;
  }));

  function LazyChart({ fallback, ...props }: P & { fallback?: ReactNode }) {
    const [ready, setReady] = useState(() => loaded !== null);
    useEffect(() => {
      if (ready) return;
      let live = true;
      preload().then(() => { if (live) setReady(true); }, () => {});
      return () => { live = false; };
    }, [ready]);
    return ready && loaded ? createElement(loaded, props as unknown as P) : <>{fallback ?? null}</>;
  }
  return { Chart: LazyChart, preload };
}

/** Warm chart modules when the browser is idle, so the first chart a user opens draws at once. */
export function preloadWhenIdle(preload: () => unknown) {
  if (typeof window === "undefined") return () => {};
  // Warming is best effort: a failure is retried when the chart mounts.
  const warm = () => { Promise.resolve(preload()).catch(() => {}); };
  const idle = window.requestIdleCallback?.(warm, { timeout: 3000 });
  const timer = idle === undefined ? window.setTimeout(warm, 1500) : undefined;
  return () => {
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
