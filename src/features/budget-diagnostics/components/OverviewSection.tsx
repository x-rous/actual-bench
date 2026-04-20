import { Download } from "lucide-react";

export function OverviewSection() {
  return (
    <section className="rounded-md border border-border bg-background p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">Coming soon</p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-muted-foreground opacity-60"
        >
          <Download className="h-4 w-4" />
          Download ZIP
        </button>
      </div>
    </section>
  );
}
