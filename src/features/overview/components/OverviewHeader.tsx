import { Button } from "@/components/ui/button";
import { Download, RefreshCw, Upload } from "lucide-react";

type OverviewHeaderProps = {
  refreshButtonLabel: string;
  refreshStatusLabel: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onExportBundle?: () => void;
  onImportBundle?: () => void;
};

export function OverviewHeader({
  refreshButtonLabel,
  refreshStatusLabel,
  isRefreshing,
  onRefresh,
  onExportBundle,
  onImportBundle,
}: OverviewHeaderProps) {
  return (
    <header className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-xl font-semibold tracking-tight">Budget Overview</h1>

      <div className="flex flex-wrap items-center gap-2 self-start sm:ml-auto sm:self-auto">
        {onExportBundle && (
          <Button variant="ghost" size="sm" onClick={onExportBundle}>
            <Upload />
            Export Bundle
          </Button>
        )}
        {onImportBundle && (
          <Button variant="ghost" size="sm" onClick={onImportBundle}>
            <Download />
            Import Bundle
          </Button>
        )}
        {(onExportBundle || onImportBundle) && (
          <div className="h-4 w-px bg-border/60" aria-hidden />
        )}
        <div className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
          {refreshStatusLabel}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void onRefresh()}
          disabled={isRefreshing}
        >
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
          {refreshButtonLabel}
        </Button>
      </div>
    </header>
  );
}
