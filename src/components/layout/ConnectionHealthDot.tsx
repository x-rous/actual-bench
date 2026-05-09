"use client";

import { cn } from "@/lib/utils";
import { useConnectionHealthContext, type HealthStatus } from "@/hooks/useConnectionHealth";

function statusLabel(status: HealthStatus, latencyMs: number | null): string {
  const latency = latencyMs !== null ? ` · ${Math.round(latencyMs)}ms` : "";
  switch (status) {
    case "healthy":  return `Connected${latency}`;
    case "checking": return "Checking…";
    case "degraded": return `Slow${latency}`;
    case "offline":  return "Offline";
    case "unknown":  return "Unknown";
  }
}

export function ConnectionHealthDot() {
  const { status, latencyMs } = useConnectionHealthContext();

  if (status === "unknown") return null;

  const label = statusLabel(status, latencyMs);

  return (
    <span
      title={`Connection: ${label}`}
      aria-label={`Connection status: ${label}`}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "healthy"  && "bg-green-500",
        status === "checking" && "animate-pulse bg-amber-400",
        status === "degraded" && "bg-amber-400",
        status === "offline"  && "bg-red-500",
      )}
    />
  );
}
