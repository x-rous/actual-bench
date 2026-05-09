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

async function pingServer(baseUrl: string, apiKey: string): Promise<number> {
  const start = performance.now();
  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connection: { baseUrl, apiKey },
      path: "/v1/actualhttpapiversion",
      method: "GET",
    }),
  });
  const latencyMs = performance.now() - start;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return latencyMs;
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

    try {
      const ms = await pingServer(baseUrl, apiKey);
      consecutiveFailures.current = 0;
      setShowBanner(false);
      setLatencyMs(ms);
      setStatus(ms > DEGRADED_THRESHOLD_MS ? "degraded" : "healthy");
    } catch {
      consecutiveFailures.current += 1;
      setLatencyMs(null);
      setStatus("offline");
      if (consecutiveFailures.current >= OFFLINE_BANNER_THRESHOLD) {
        setShowBanner(true);
      }
    } finally {
      isChecking.current = false;
    }
  }, []);

  useEffect(() => {
    // Reset guards on connection change so a stale check doesn't block the new one.
    consecutiveFailures.current = 0;
    isChecking.current = false;

    if (!activeInstance) {
      setStatus("unknown");
      setLatencyMs(null);
      setShowBanner(false);
      return;
    }

    const { baseUrl, apiKey } = activeInstance;
    void runCheck(baseUrl, apiKey);

    let timeoutId: ReturnType<typeof setTimeout>;

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
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeInstance, runCheck]);

  return { status, latencyMs, showBanner };
}
