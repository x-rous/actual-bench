import type React from "react";

export type EntityUsageData = {
  entityId: string;
  entityType: "account" | "payee" | "category" | "categoryGroup" | "tag" | "schedule";
  entityLabel: string;
  ruleCount: number;
  /** undefined = not applicable (tags) or still loading */
  txCount?: number;
  txLoading: boolean;
  /** Accounts only — from useAccountBalances */
  balance?: number;
  /** categoryGroups only */
  childCount?: number;
  /** schedules only */
  linkedRuleId?: string;
  /** schedules only */
  postsTransaction?: boolean;
  warnings: React.ReactNode[];
};
