import { AlertTriangle } from "lucide-react";

export function NeedsConnectionsNotice() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="font-medium">Budget File Sync needs at least two connections.</p>
        <p className="mt-1 text-muted-foreground">
          Connect two budgets - in Direct mode, HTTP API Server mode, or any
          combination - to create a cross-budget sync flow.
        </p>
      </div>
    </div>
  );
}
