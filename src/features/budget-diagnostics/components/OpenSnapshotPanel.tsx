import { AlertCircle, CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProgressStage } from "../types";

type OpenSnapshotPanelProps = {
  status: "loading" | "error";
  stage: ProgressStage | null;
  errorMessage: string | null;
  onRetry: () => void;
};

const SNAPSHOT_STAGES: ReadonlyArray<{
  id: Exclude<ProgressStage, "ready">;
  label: string;
}> = [
  { id: "exporting", label: "Exporting ZIP" },
  { id: "unpacking", label: "Unpacking ZIP" },
  { id: "opening", label: "Opening SQLite" },
  { id: "readingSchema", label: "Reading schema" },
  { id: "computingOverview", label: "Computing overview" },
  { id: "runningDiagnostics", label: "Running diagnostics" },
];

function stageIndex(stage: ProgressStage | null): number {
  if (stage === "ready") return SNAPSHOT_STAGES.length;
  return SNAPSHOT_STAGES.findIndex((entry) => entry.id === stage);
}

function StageDot({
  complete,
  active,
  error,
}: {
  complete: boolean;
  active: boolean;
  error: boolean;
}) {
  if (error) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
      </span>
    );
  }

  if (active) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }

  if (complete) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    );
  }

  return <span className="h-2 w-2 rounded-full bg-muted-foreground/35" />;
}

export function OpenSnapshotPanel({
  status,
  stage,
  errorMessage,
  onRetry,
}: OpenSnapshotPanelProps) {
  const currentIndex = stageIndex(stage);
  const errorIndex = status === "error" ? Math.max(currentIndex, 0) : -1;
  const title =
    status === "error"
      ? "Snapshot export failed"
      : stage === "runningDiagnostics"
        ? "Running diagnostics"
        : "Opening budget snapshot";
  const description =
    status === "error"
      ? (errorMessage ?? "Unable to open the exported budget snapshot.")
      : stage === "runningDiagnostics"
        ? "Checking the local snapshot before diagnostics are complete."
        : "Preparing a read-only local copy for diagnostics.";

  return (
    <div
      className={cn(
        "rounded-md p-4",
        status === "error"
          ? "border border-destructive/25 bg-destructive/5"
          : "border border-dashed border-border bg-muted/20"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm font-medium",
              status === "error" && "text-destructive"
            )}
          >
            {title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {status === "error" && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCw data-icon="inline-start" />
            Retry
          </Button>
        )}
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {SNAPSHOT_STAGES.map((entry, index) => {
          const complete = currentIndex > index || stage === "ready";
          const active = status === "loading" && currentIndex === index;
          const failed = status === "error" && errorIndex === index;
          return (
            <li
              key={entry.id}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md bg-background/70 px-2.5 py-2 text-xs",
                active && "text-foreground",
                failed && "text-destructive"
              )}
            >
              <StageDot complete={complete} active={active} error={failed} />
              <span className="truncate">{entry.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
