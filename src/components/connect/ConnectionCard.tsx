"use client";

import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isBrowserApiConnection, type ConnectionInstance } from "@/store/connection";
import { deriveLabel, getConnectionModeBadge } from "./utils";

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
  const isDirect = isBrowserApiConnection(instance);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
        isActive ? "border-primary bg-primary/5" : "border-border bg-background",
        isDirect && "border-amber-200 bg-amber-50/40"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{instance.label}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              isDirect
                ? "bg-amber-100 text-amber-700"
                : "bg-muted text-muted-foreground"
            )}
          >
            {getConnectionModeBadge(instance.mode)}
          </span>
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
          disabled={anyBusy || isDirect}
          onClick={() => onConnect(instance)}
          title={isDirect ? "Direct app transport is not active yet" : "Connect"}
          className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Connecting…
            </>
          ) : isDirect ? (
            "Saved"
          ) : (
            "Connect"
          )}
        </button>
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => onRemove(instance.id)}
          title="Remove"
          aria-label={
            "Remove " + instance.label
          }
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
