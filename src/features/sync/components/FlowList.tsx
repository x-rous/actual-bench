"use client";

import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import type { SyncFlow } from "@/lib/app-db/types";

type FlowListProps = {
  flows: SyncFlow[];
  selectedFlowId: string | null;
  onSelect: (flowId: string) => void;
  onCreate: () => void;
  onDelete: (flowId: string) => void;
};

export function FlowList({ flows, selectedFlowId, onSelect, onCreate, onDelete }: FlowListProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Flows</h2>
        <Button size="sm" variant="outline" onClick={onCreate} aria-label="Create sync flow">
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {flows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No sync flows yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {flows.map((flow) => {
            const config = decodeFlowPlanConfig(flow);
            const selected = flow.id === selectedFlowId;
            return (
              <li key={flow.id}>
                <div
                  className={cn(
                    "group flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                    selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(flow.id)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{flow.name}</span>
                      <Badge variant={flow.enabled ? "status-active" : "secondary"} className="text-[10px]">
                        {flow.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {config.sourceBudgetName || config.sourceBudgetId || "?"}
                      {" → "}
                      {config.targetBudgetName || config.targetBudgetId || "?"}
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100"
                    aria-label={`Delete ${flow.name}`}
                    onClick={() => onDelete(flow.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
