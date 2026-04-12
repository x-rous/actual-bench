import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

type OverviewHeaderProps = {
  budgetLabel: string;
  statusLabel: string;
  statusDotClass: string;
  refreshButtonLabel: string;
  refreshStatusLabel: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
};

export function OverviewHeader({
  budgetLabel,
  statusLabel,
  statusDotClass,
  refreshButtonLabel,
  refreshStatusLabel,
  isRefreshing,
  onRefresh,
}: OverviewHeaderProps) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Budget Overview</h1>
          <Badge variant="outline" className="gap-1.5">
            <span className={statusDotClass} />
            {statusLabel}
          </Badge>
          <span className="text-sm font-medium text-foreground/85">{budgetLabel}</span>
        </div>
      </div>

      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={isRefreshing}>
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
          {refreshButtonLabel}
        </Button>
        <div className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
          {refreshStatusLabel}
        </div>
      </div>
    </header>
  );
}
