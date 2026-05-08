import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, Upload } from "lucide-react";

type OverviewHeaderProps = {
  budgetLabel: string;
  statusLabel: string;
  statusDotClass: string;
  refreshButtonLabel: string;
  refreshStatusLabel: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onExportBundle?: () => void;
  onImportBundle?: () => void;
};

export function OverviewHeader({
  budgetLabel,
  statusLabel,
  statusDotClass,
  refreshButtonLabel,
  refreshStatusLabel,
  isRefreshing,
  onRefresh,
  onExportBundle,
  onImportBundle,
}: OverviewHeaderProps) {
  const hasConnection = Boolean(budgetLabel);

  return (
    <header className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Budget Overview</h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="outline" className="gap-1.5">
            <span className={statusDotClass} />
            {statusLabel}
          </Badge>
          {budgetLabel ? (
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              {budgetLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 self-start sm:ml-auto sm:self-auto">
        {onExportBundle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onExportBundle}
            disabled={!hasConnection}
          >
            <Upload />
            Export
          </Button>
        )}
        {onImportBundle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onImportBundle}
            disabled={!hasConnection}
          >
            <Download />
            Import
          </Button>
        )}
        <div className="h-4 w-px bg-border/60" aria-hidden />
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
