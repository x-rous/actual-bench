"use client";

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export type HealthStatus = "unknown" | "checking" | "healthy" | "degraded" | "offline";

export type ConnectionHealthState = {
  status: HealthStatus;
  latencyMs: number | null;
  /** True only after 2+ consecutive offline checks — triggers the banner. */
  showBanner: boolean;
};

const POLL_INTERVAL_MS = 30_000;
const DEGRADED_THRESHOLD_MS = 3_000;
const OFFLINE_BANNER_THRESHOLD = 2;

export const ConnectionHealthContext = createContext<ConnectionHealthState>({
  status: "unknown",
  latencyMs: null,
  showBanner: false,
});

export function useConnectionHealthContext(): ConnectionHealthState {
  return useContext(ConnectionHealthContext);
}

async function pingServer(
  baseUrl: string,
  apiKey: string
): Promise<{ latencyMs: number; ok: boolean }> {
  const start = performance.now();
  const [result] = await Promise.allSettled([
    fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connection: { baseUrl, apiKey },
        path: "/v1/actualhttpapiversion",
        method: "GET",
      }),
    }),
  ]);
  const latencyMs = performance.now() - start;
  if (result.status === "rejected") return { latencyMs, ok: false };
  return { latencyMs, ok: result.value.ok };
}

export function useConnectionHealth(): ConnectionHealthState {
  const activeInstance = useConnectionStore(selectActiveInstance);
  const [status, setStatus] = useState<HealthStatus>("unknown");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const consecutiveFailures = useRef(0);
  const isChecking = useRef(false);

  const runCheck = useCallback(async (baseUrl: string, apiKey: string) => {
    if (isChecking.current) return;
    isChecking.current = true;
    setStatus("checking");

    const { latencyMs: ms, ok } = await pingServer(baseUrl, apiKey);

    if (ok) {
      consecutiveFailures.current = 0;
      setShowBanner(false);
      setLatencyMs(ms);
      setStatus(ms > DEGRADED_THRESHOLD_MS ? "degraded" : "healthy");
    } else {
      consecutiveFailures.current += 1;
      setLatencyMs(null);
      setStatus("offline");
      if (consecutiveFailures.current >= OFFLINE_BANNER_THRESHOLD) {
        setShowBanner(true);
      }
    }

    isChecking.current = false;
  }, []);

  useEffect(() => {
    // Reset guards on connection change so a stale check doesn't block the new one.
    consecutiveFailures.current = 0;
    isChecking.current = false;

    if (!activeInstance) return;

    const { baseUrl, apiKey } = activeInstance;
    let timeoutId: ReturnType<typeof setTimeout>;

    // runCheck calls setStatus("checking") before its first await; deferring
    // keeps it out of the synchronous effect body to satisfy the lint rule.
    const initialId = setTimeout(() => void runCheck(baseUrl, apiKey), 0);

    function scheduleNext() {
      timeoutId = setTimeout(() => {
        if (document.visibilityState === "visible") {
          void runCheck(baseUrl, apiKey);
        }
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }

    scheduleNext();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        clearTimeout(timeoutId);
        void runCheck(baseUrl, apiKey);
        scheduleNext();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(initialId);
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeInstance, runCheck]);

  // When no connection is active derive the reset values during render rather
  // than calling setState in the effect body (which triggers cascading renders).
  if (!activeInstance) return { status: "unknown", latencyMs: null, showBanner: false };
  return { status, latencyMs, showBanner };
}
