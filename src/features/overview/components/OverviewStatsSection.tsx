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
  /** A refresh is running: the figures shown are the previous ones, dimmed. */
  isRefreshing?: boolean;
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

/** A figure that failed to load. It used to show "...", which read as still loading, indefinitely. */
const UNREADABLE = "Could not be read. Press Refresh to try again.";

/** What each count includes, where its name does not say. */
const COUNT_HINTS: Record<CountStatConfig["key"], string> = {
  transactions: "Each line of a split counts once (the split itself does not); starting balances are included.",
  accounts: "Open and closed accounts.",
  payees: "Includes the transfer payee Actual keeps for each account.",
  categories: "Income and expense categories, hidden ones included.",
  schedules: "Active and completed schedules.",
  rules: "Includes the rule each schedule keeps.",
};

/** The part of a count worth naming under it ("12 closed"); nothing when it could not be read. */
function countDetail(key: CountStatConfig["key"], snapshot: BudgetOverviewSnapshot | undefined): string | undefined {
  const details = snapshot?.details;
  const part = (value: number | null | undefined, label: string) =>
    value == null ? undefined : `${numberFormatter.format(value)} ${label}`;
  switch (key) {
    case "accounts": return part(details?.closedAccounts, "closed");
    case "payees": return part(details?.transferPayees, "transfer");
    case "categories": return part(details?.hiddenCategories, "hidden");
    case "schedules": return part(details?.completedSchedules, "completed");
    case "rules": return part(snapshot?.stats.schedules, "from schedules");
    default: return undefined;
  }
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

function Unreadable() {
  return <span aria-label={UNREADABLE}>-</span>;
}

function SnapshotCount({
  label,
  icon: Icon,
  value,
  isLoading,
  hint,
  detail,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  value: number | null | undefined;
  isLoading: boolean;
  hint?: string;
  detail?: string;
}) {
  const shouldShowLoadingIndicator = isLoading && value == null;
  const unreadable = !isLoading && value === null;

  return (
    <div className="min-w-0 text-center" title={unreadable ? UNREADABLE : hint}>
      <dt className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground sm:text-[10px]">
        <Icon className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
        <span className="truncate">{label}</span>
      </dt>
      {shouldShowLoadingIndicator ? (
        <LoadingMetric />
      ) : (
        <dd className="mt-1 text-center text-base font-semibold tabular-nums text-foreground sm:text-lg">
          {unreadable ? <Unreadable /> : value == null ? "..." : numberFormatter.format(value)}
          {detail && !unreadable && (
            <span className="block truncate text-[10px] font-normal text-muted-foreground">{detail}</span>
          )}
        </dd>
      )}
    </div>
  );
}

function SnapshotText({
  label,
  value,
  isLoading,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  isLoading: boolean;
  hint?: string;
}) {
  const shouldShowLoadingIndicator = isLoading && value == null;
  const unreadable = !isLoading && value === null;

  return (
    <div className="min-w-0 text-center" title={unreadable ? UNREADABLE : hint}>
      <dt className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground sm:text-[10px]">
        {label}
      </dt>
      {shouldShowLoadingIndicator ? (
        <LoadingMetric />
      ) : (
        <dd className="mt-1 truncate text-center text-sm font-medium text-foreground/85 sm:text-[0.95rem]">
          {unreadable ? <Unreadable /> : value ?? "..."}
        </dd>
      )}
    </div>
  );
}

export function OverviewStatsSection({
  snapshot,
  isLoading,
  isRefreshing = false,
}: OverviewStatsSectionProps) {
  const stats: BudgetOverviewStats | undefined = snapshot?.stats;

  return (
    <section
      aria-busy={isLoading || isRefreshing}
      className={`w-full rounded-xl border border-border/70 bg-muted/15 px-4 pt-2 pb-3 transition-opacity sm:px-5 sm:pt-2.5 sm:pb-3.5 ${isRefreshing ? "opacity-60" : ""}`}
    >
      <div className="space-y-3">
        {/* No heading: a row of labelled counts does not need a word above it
            saying that it is a row of labelled counts. */}
        {/* The row spans the full width of a wider page now, so the columns get
            room to breathe rather than staying packed as though they were still
            fighting for space. */}
        <dl className="mx-auto grid w-full grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 md:grid-cols-8 md:gap-x-5 lg:gap-x-8">
          {COUNT_STATS.map(({ key, label, icon }) => (
            <SnapshotCount
              key={key}
              label={label}
              icon={icon}
              value={stats?.[key]}
              isLoading={isLoading}
              hint={COUNT_HINTS[key]}
              detail={countDetail(key, snapshot)}
            />
          ))}
          <SnapshotText
            label="Budget Mode"
            value={snapshot?.budgetMode}
            isLoading={isLoading}
          />
          <SnapshotText
            label="First transaction"
            value={snapshot?.budgetingSince}
            isLoading={isLoading}
            hint="The month of the oldest transaction in the budget, starting balances included."
          />
        </dl>
      </div>
    </section>
  );
}
