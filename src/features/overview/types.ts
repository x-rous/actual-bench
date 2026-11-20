export type OverviewStatKey =
  | "transactions"
  | "accounts"
  | "payees"
  | "categories"
  | "rules"
  | "schedules";

export type BudgetOverviewStats = Record<OverviewStatKey, number | null>;

export type BudgetMode = "Envelope" | "Tracking" | "Unidentified";

/** What a headline count includes, so it can be read correctly ("54 · 12 closed"). Null when it could not be read. */
export type OverviewDetailKey = "closedAccounts" | "transferPayees" | "hiddenCategories" | "completedSchedules";

export type BudgetOverviewDetails = Record<OverviewDetailKey, number | null>;

export type BudgetOverviewSnapshot = {
  stats: BudgetOverviewStats;
  details: BudgetOverviewDetails;
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
