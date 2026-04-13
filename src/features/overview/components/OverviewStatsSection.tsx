import {
  ArrowLeftRight,
  Calendar,
  Landmark,
  LayoutList,
  ScrollText,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import type { BudgetOverviewSnapshot, BudgetOverviewStats, OverviewStatKey } from "../types";

type OverviewStatsSectionProps = {
  snapshot: BudgetOverviewSnapshot | undefined;
  isLoading: boolean;
};

type CountStatConfig = {
  key: Extract<OverviewStatKey, "transactions" | "accounts" | "payees" | "categories" | "schedules" | "rules">;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const COUNT_STATS: CountStatConfig[] = [
  { key: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { key: "accounts", label: "Accounts", icon: Landmark },
  { key: "payees", label: "Payees", icon: Users },
  { key: "categories", label: "Categories", icon: LayoutList },
  { key: "schedules", label: "Schedules", icon: Calendar },
  { key: "rules", label: "Rules", icon: ScrollText },
];

const numberFormatter = new Intl.NumberFormat();

function formatCount(value: number | null | undefined): string {
  if (value == null) return "...";
  return numberFormatter.format(value);
}

function LoadingMetric() {
  return (
    <span
      role="status"
      aria-label="Loading snapshot metric"
      className="mx-auto mt-1 block h-4 w-10 animate-pulse rounded-md bg-muted-foreground/20 sm:h-[1.125rem] sm:w-12"
    />
  );
}

function SnapshotCount({
  label,
  icon: Icon,
  value,
  isLoading,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  value: number | null | undefined;
  isLoading: boolean;
}) {
  const shouldShowLoadingIndicator = isLoading && value == null;

  return (
    <div className="min-w-0 text-center">
      <dt className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground sm:text-[10px]">
        <Icon className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
        <span className="truncate">{label}</span>
      </dt>
      {shouldShowLoadingIndicator ? (
        <LoadingMetric />
      ) : (
        <dd className="mt-1 text-center text-base font-semibold tabular-nums text-foreground sm:text-lg">
          {formatCount(value)}
        </dd>
      )}
    </div>
  );
}

function SnapshotText({ label, value, isLoading }: { label: string; value: string | null | undefined; isLoading: boolean }) {
  const shouldShowLoadingIndicator = isLoading && value == null;

  return (
    <div className="min-w-0 text-center">
      <dt className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground sm:text-[10px]">
        {label}
      </dt>
      {shouldShowLoadingIndicator ? (
        <LoadingMetric />
      ) : (
        <dd className="mt-1 truncate text-center text-sm font-medium text-foreground/85 sm:text-[0.95rem]">
          {value ?? "..."}
        </dd>
      )}
    </div>
  );
}

export function OverviewStatsSection({
  snapshot,
  isLoading,
}: OverviewStatsSectionProps) {
  const stats: BudgetOverviewStats | undefined = snapshot?.stats;

  return (
    <section className="w-full rounded-xl border border-border/70 bg-muted/15 px-4 pt-2 pb-3 sm:px-5 sm:pt-2.5 sm:pb-3.5">
      <div className="space-y-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground pb-1">
          Snapshot
        </div>

        <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 md:grid-cols-8 md:gap-x-1.5 lg:gap-x-2.5">
          {COUNT_STATS.map(({ key, label, icon }) => (
            <SnapshotCount
              key={key}
              label={label}
              icon={icon}
              value={stats?.[key]}
              isLoading={isLoading}
            />
          ))}
          <SnapshotText
            label="Budget Mode"
            value={snapshot?.budgetMode}
            isLoading={isLoading}
          />
          <SnapshotText
            label="Budgeting since"
            value={snapshot?.budgetingSince}
            isLoading={isLoading}
          />
        </dl>
      </div>
    </section>
  );
}
