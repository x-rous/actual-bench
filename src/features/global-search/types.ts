export type SearchEntityType =
  | "payee"
  | "category"
  | "account"
  | "rule"
  | "schedule"
  | "tag";

export type SearchResult = {
  entityType: SearchEntityType;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  score: number;
};

export type SearchResultGroup = {
  entityType: SearchEntityType;
  groupLabel: string;
  results: SearchResult[];
};
