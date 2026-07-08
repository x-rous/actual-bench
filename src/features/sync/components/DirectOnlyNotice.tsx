import { AlertTriangle } from "lucide-react";

export function DirectOnlyNotice() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="font-medium">Budget File Sync currently supports Direct mode only.</p>
        <p className="mt-1 text-muted-foreground">
          Connect at least two Direct (browser API) budgets to create a cross-budget sync flow.
          HTTP API connections are not supported for this feature yet.
        </p>
      </div>
    </div>
  );
}
