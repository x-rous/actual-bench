import type { ComponentType } from "react";

export type OverviewStatKey =
  | "transactions"
  | "accounts"
  | "payees"
  | "categoryGroups"
  | "categories"
  | "rules"
  | "schedules";

export type BudgetOverviewStats = Record<OverviewStatKey, number | null>;

export type BudgetOverviewSnapshot = {
  stats: BudgetOverviewStats;
  budgetMode: string | null;
  budgetingSince: string | null;
};

export type OverviewActionTone = "entity" | "tool" | "disabled";

export type OverviewActionCard = {
  id: string;
  label: string;
  description: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  tone: OverviewActionTone;
  comingSoon?: boolean;
};

export type OverviewRefreshResult = {
  ok: boolean;
  hasPartialFailure: boolean;
};

export type UseBudgetOverviewResult = {
  snapshot: BudgetOverviewSnapshot | null;
  isLoading: boolean;
  isError: boolean;
  hasPartialFailure: boolean;
  refresh: () => Promise<OverviewRefreshResult>;
};
