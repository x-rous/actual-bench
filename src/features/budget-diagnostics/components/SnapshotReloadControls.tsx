"use client";

import { useEffect, useState } from "react";

function formatLoadedAgo(loadedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - loadedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/** Self-updating "loaded X ago" label (refreshes once a minute). */
function LoadedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return <>{formatLoadedAgo(at, now)}</>;
}

/**
 * "Loaded X ago" + Reload control for the cached budget snapshot. Shared by the
 * diagnostics workbench and the standalone Data Browser. Renders nothing until
 * the snapshot is ready.
 */
export function SnapshotReloadControls({
  status,
  loadedAt,
  onReload,
}: {
  status: "idle" | "loading" | "ready" | "error";
  loadedAt: number | null;
  onReload: () => void;
}) {
  if (status !== "ready") return null;
  return (
    <div className="flex items-center gap-3">
      {loadedAt != null && (
        <span className="text-[11px] text-muted-foreground">
          Loaded <LoadedAgo at={loadedAt} />
        </span>
      )}
      <button
        type="button"
        onClick={onReload}
        className="text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        title="Re-download the budget export and rebuild the snapshot"
      >
        Reload
      </button>
    </div>
  );
}
