export type OverviewStatKey =
  | "transactions"
  | "accounts"
  | "payees"
  | "categoryGroups"
  | "categories"
  | "rules"
  | "schedules";

export type BudgetOverviewStats = Record<OverviewStatKey, number | null>;

export type BudgetMode = "Envelope" | "Tracking" | "Unidentified";

export type BudgetOverviewSnapshot = {
  stats: BudgetOverviewStats;
  budgetMode: BudgetMode | null;
  budgetingSince: string | null;
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
  /** When the snapshot was last read, in milliseconds; null before anything has been read. */
  dataUpdatedAt: number | null;
  refresh: () => Promise<OverviewRefreshResult>;
};
