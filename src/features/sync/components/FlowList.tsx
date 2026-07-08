"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import { latestRunLabel } from "../lib/runsView";
import type { BrowserApiConnection } from "@/store/connection";
import type { SyncFlow, SyncFlowRun } from "@/lib/app-db/types";

type FlowListProps = {
  flows: SyncFlow[];
  selectedFlowId: string | null;
  latestRuns: Map<string, SyncFlowRun>;
  connections: BrowserApiConnection[];
  onSelect: (flowId: string) => void;
  onCreate: () => void;
};

function connectionAvailable(fingerprint: string, connections: BrowserApiConnection[]): boolean {
  if (!fingerprint) return false;
  return connections.some((c) => connectionFingerprint(c) === fingerprint);
}

export function FlowList({ flows, selectedFlowId, latestRuns, connections, onSelect, onCreate }: FlowListProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((flow) => {
      const config = decodeFlowPlanConfig(flow);
      return (
        flow.name.toLowerCase().includes(q) ||
        config.sourceBudgetName.toLowerCase().includes(q) ||
        config.targetBudgetName.toLowerCase().includes(q)
      );
    });
  }, [flows, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-28 flex-col justify-center gap-2 border-b border-border px-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sync flows</span>
          <Button size="sm" variant="outline" className="text-xs" onClick={onCreate} aria-label="Create sync flow">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search sync flows"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search flows"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {flows.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">No sync flows yet.</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">No flows match your search.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.map((flow) => {
              const selected = flow.id === selectedFlowId;
              const config = decodeFlowPlanConfig(flow);
              const connected =
                connectionAvailable(config.sourceConnectionFingerprint, connections) &&
                connectionAvailable(config.targetConnectionFingerprint, connections);
              return (
                <button
                  key={flow.id}
                  type="button"
                  onClick={() => onSelect(flow.id)}
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left transition-colors",
                    selected ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted/60"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{flow.name}</span>
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", flow.enabled ? "bg-green-500" : "bg-muted-foreground/40")}
                      aria-hidden
                    />
                    <span className="sr-only">{flow.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {connected ? (
                      latestRunLabel(latestRuns.get(flow.id))
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">Needs connection</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
