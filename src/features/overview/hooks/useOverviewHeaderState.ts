"use client";

import { useEffect, useState } from "react";
import type { OverviewRefreshResult } from "../types";

type UseOverviewHeaderStateParams = {
  hasStats: boolean;
  isLoading: boolean;
  refresh: () => Promise<OverviewRefreshResult>;
};

function getRelativeRefreshLabel(date: Date | null, now: number): string | null {
  if (!date) return null;

  const diffMs = Math.max(0, now - date.getTime());
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 10) return "Updated just now";
  if (diffSeconds < 60) return `Updated ${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `Last refreshed ${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Last refreshed ${diffHours}h ago`;

  return `Last refreshed ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

const ELLIPSIS_FRAMES = [".", "..", "..."] as const;

export function useOverviewHeaderState({
  hasStats,
  isLoading,
  refresh,
}: UseOverviewHeaderStateParams) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [ellipsisIndex, setEllipsisIndex] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (hasStats && !lastRefreshedAt) {
      setLastRefreshedAt(new Date());
    }
  }, [hasStats, lastRefreshedAt]);

  useEffect(() => {
    if (!isRefreshing) return;

    const intervalId = window.setInterval(() => {
      setEllipsisIndex((current) => (current + 1) % ELLIPSIS_FRAMES.length);
    }, 420);

    return () => window.clearInterval(intervalId);
  }, [isRefreshing]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function handleRefresh() {
    setIsRefreshing(true);
    setEllipsisIndex(0);

    try {
      let result: OverviewRefreshResult;

      try {
        result = await refresh();
      } catch (error) {
        console.warn("[overview] Refresh failed", error);
        result = { ok: false, hasPartialFailure: false };
      }

      if (result.ok) {
        setLastRefreshedAt(new Date());
        setNow(Date.now());
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  const isHeaderLoading = isLoading || isRefreshing;

  return {
    isRefreshing,
    isHeaderLoading,
    refreshButtonLabel: isRefreshing ? "Refreshing" : "Refresh",
    refreshStatusLabel: isRefreshing
      ? `Refreshing${ELLIPSIS_FRAMES[ellipsisIndex]}`
      : getRelativeRefreshLabel(lastRefreshedAt, now),
    statusLabel: isHeaderLoading ? "Loading budget" : "Connected",
    statusDotClass: isHeaderLoading
      ? "h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
      : "h-1.5 w-1.5 rounded-full bg-green-500",
    handleRefresh,
  };
}
