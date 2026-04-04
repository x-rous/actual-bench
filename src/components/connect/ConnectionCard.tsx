"use client";

import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ConnectionInstance } from "@/store/connection";
import { deriveLabel } from "./utils";

export function ConnectionCard({
  instance,
  isActive,
  onConnect,
  onRemove,
  connectBusyId,
}: {
  instance: ConnectionInstance;
  isActive: boolean;
  onConnect: (instance: ConnectionInstance) => void;
  onRemove: (id: string) => void;
  connectBusyId: string | null;
}) {
  const busy = connectBusyId === instance.id;
  const anyBusy = connectBusyId !== null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
        isActive ? "border-primary bg-primary/5" : "border-border bg-background"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{instance.label}</span>
          {isActive && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              active
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground truncate">
          {deriveLabel(instance.baseUrl)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => onConnect(instance)}
          className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Connecting…
            </>
          ) : (
            "Connect"
          )}
        </button>
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => onRemove(instance.id)}
          title="Remove"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
