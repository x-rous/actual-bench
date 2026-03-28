import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  /** Page heading shown in the toolbar left side */
  title: string;
  /** Optional subtitle / count string shown next to the title */
  count?: string;
  /** Action buttons rendered in the toolbar right side */
  actions?: React.ReactNode;
  /** When true shows skeleton rows in the content area (toolbar stays visible) */
  isLoading?: boolean;
  /** When true shows an error message with an optional retry button */
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Rendered in the content area instead of children when the list is empty */
  emptyState?: React.ReactNode;
  /**
   * When true, children are rendered inside a flex column without an extra
   * scroll wrapper — use when the child manages its own scroll (e.g. RulesTable).
   * When false (default), children are inside a `min-h-0 flex-1 overflow-auto` div.
   */
  scrollManaged?: boolean;
  children: React.ReactNode;
}

function SkeletonRows() {
  return (
    <div className="flex flex-col divide-y divide-border/30" aria-busy="true" aria-label="Loading…">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-muted" />
          <div
            className={cn(
              "h-3 animate-pulse rounded bg-muted",
              i % 3 === 0 ? "w-48" : i % 3 === 1 ? "w-36" : "w-56"
            )}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Standard page container for all entity list pages.
 *
 * Owns the flex/overflow layout chain, the page toolbar, and the
 * loading/error/empty states so individual Views don't repeat this structure.
 *
 * Usage:
 *   <PageLayout title="Accounts" count="15 total" actions={<AddButton />}>
 *     <AccountsTable />
 *   </PageLayout>
 */
export function PageLayout({
  title,
  count,
  actions,
  isLoading,
  isError,
  error,
  onRetry,
  emptyState,
  scrollManaged = false,
  children,
}: PageLayoutProps) {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "An error occurred";

  let content: React.ReactNode;
  if (isLoading) {
    content = <SkeletonRows />;
  } else if (isError) {
    content = (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm">
        <p className="text-destructive">{errorMessage}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  } else if (emptyState) {
    content = emptyState;
  } else {
    content = children;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Toolbar — always visible regardless of loading/error state */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">{title}</h1>
          {count && (
            <span className="text-xs text-muted-foreground">{count}</span>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>

      {/* Content area */}
      {(isLoading || isError || emptyState) ? (
        <div className="min-h-0 flex-1 overflow-auto">{content}</div>
      ) : scrollManaged ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">{content}</div>
      )}
    </div>
  );
}
