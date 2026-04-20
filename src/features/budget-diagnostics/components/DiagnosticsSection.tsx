import { AlertTriangle } from "lucide-react";

export function DiagnosticsSection() {
  return (
    <section className="rounded-md border border-border bg-background p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-4 w-4 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Diagnostics</h2>
          <p className="mt-1 text-sm text-muted-foreground">Coming soon</p>
        </div>
      </div>
    </section>
  );
}
