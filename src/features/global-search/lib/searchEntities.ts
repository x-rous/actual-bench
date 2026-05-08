import type { StagedMap } from "@/types/staged";
import type {
  Account,
  Payee,
  Category,
  CategoryGroup,
  Rule,
  Schedule,
  Tag,
} from "@/types/entities";
import { rulePreview } from "@/features/rules/utils/rulePreview";
import type { SearchResult, SearchResultGroup, SearchEntityType } from "../types";

export type SearchSlices = {
  accounts: StagedMap<Account>;
  payees: StagedMap<Payee>;
  categoryGroups: StagedMap<CategoryGroup>;
  categories: StagedMap<Category>;
  rules: StagedMap<Rule>;
  schedules: StagedMap<Schedule>;
  tags: StagedMap<Tag>;
};

const MAX_PER_GROUP = 5;

const PLACEHOLDER_NAMES = new Set(["New Account", "New Payee", "New Category", "New Tag", "NewTag"]);

const GROUP_LABELS: Record<SearchEntityType, string> = {
  payee: "Payees",
  category: "Categories",
  account: "Accounts",
  rule: "Rules",
  schedule: "Schedules",
  tag: "Tags",
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const re = new RegExp(`(?:^|[ \\-/(])${escapeRegex(needle)}`);
  return re.test(haystack);
}

function scoreMatch(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  if (wordBoundaryMatch(h, n)) return 60;
  if (h.includes(n)) return 40;
  return 0;
}

function bestScore(fields: string[], needle: string): number {
  let best = 0;
  for (const f of fields) {
    const s = scoreMatch(f, needle);
    if (s > best) best = s;
  }
  return best;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function searchPayees(
  slices: SearchSlices,
  needle: string
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of Object.values(slices.payees)) {
    if (entry.isDeleted) continue;
    if (entry.isNew && PLACEHOLDER_NAMES.has(entry.entity.name)) continue;
    const s = bestScore([entry.entity.name], needle);
    if (s === 0) continue;
    results.push({
      entityType: "payee",
      id: entry.entity.id,
      label: entry.entity.name,
      href: `/payees?highlight=${entry.entity.id}`,
      score: s,
    });
  }
  return results;
}

function searchCategories(
  slices: SearchSlices,
  needle: string
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of Object.values(slices.categories)) {
    if (entry.isDeleted) continue;
    if (entry.isNew && PLACEHOLDER_NAMES.has(entry.entity.name)) continue;
    const group = slices.categoryGroups[entry.entity.groupId];
    const groupName = group?.entity.name ?? "";
    const s = bestScore([entry.entity.name, groupName], needle);
    if (s === 0) continue;
    results.push({
      entityType: "category",
      id: entry.entity.id,
      label: entry.entity.name,
      sublabel: groupName || undefined,
      href: `/categories?highlight=${entry.entity.id}`,
      score: s,
    });
  }
  return results;
}

function searchAccounts(
  slices: SearchSlices,
  needle: string
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of Object.values(slices.accounts)) {
    if (entry.isDeleted) continue;
    if (entry.isNew && PLACEHOLDER_NAMES.has(entry.entity.name)) continue;
    const s = bestScore([entry.entity.name], needle);
    if (s === 0) continue;
    results.push({
      entityType: "account",
      id: entry.entity.id,
      label: entry.entity.name,
      sublabel: entry.entity.offBudget ? "Off budget" : "On budget",
      href: `/accounts?highlight=${entry.entity.id}`,
      score: s,
    });
  }
  return results;
}

function searchRules(
  slices: SearchSlices,
  needle: string
): SearchResult[] {
  const entityMaps = {
    payees: slices.payees,
    categories: slices.categories,
    accounts: slices.accounts,
    categoryGroups: slices.categoryGroups,
    schedules: slices.schedules,
  };

  const results: SearchResult[] = [];
  for (const entry of Object.values(slices.rules)) {
    if (entry.isDeleted) continue;
    const rule = entry.entity;
    const preview = truncate(rulePreview(rule, entityMaps), 80);
    const stageLabel = rule.stage ?? "default";
    const s = bestScore([preview, stageLabel], needle);
    if (s === 0) continue;
    results.push({
      entityType: "rule",
      id: rule.id,
      label: preview,
      sublabel: stageLabel,
      href: `/rules?highlight=${rule.id}`,
      score: s,
    });
  }
  return results;
}

function searchSchedules(
  slices: SearchSlices,
  needle: string
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of Object.values(slices.schedules)) {
    if (entry.isDeleted) continue;
    const schedule = entry.entity;
    const name = schedule.name ?? "Unnamed schedule";
    const payeeName = schedule.payeeId
      ? (slices.payees[schedule.payeeId]?.entity.name ?? "")
      : "";
    const s = bestScore([name, payeeName], needle);
    if (s === 0) continue;
    results.push({
      entityType: "schedule",
      id: schedule.id,
      label: name,
      sublabel: payeeName || undefined,
      href: `/schedules?highlight=${schedule.id}`,
      score: s,
    });
  }
  return results;
}

function searchTags(
  slices: SearchSlices,
  needle: string
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of Object.values(slices.tags)) {
    if (entry.isDeleted) continue;
    if (entry.isNew && PLACEHOLDER_NAMES.has(entry.entity.name)) continue;
    const tag = entry.entity;
    const s = bestScore([tag.name, tag.description ?? ""], needle);
    if (s === 0) continue;
    results.push({
      entityType: "tag",
      id: tag.id,
      label: tag.name,
      sublabel: tag.description ? truncate(tag.description, 40) : undefined,
      href: `/tags?highlight=${tag.id}`,
      score: s,
    });
  }
  return results;
}

function toGroup(
  entityType: SearchEntityType,
  results: SearchResult[]
): SearchResultGroup | null {
  if (results.length === 0) return null;
  const sorted = results
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_GROUP);
  return { entityType, groupLabel: GROUP_LABELS[entityType], results: sorted };
}

const GROUP_ORDER: SearchEntityType[] = [
  "payee",
  "category",
  "account",
  "rule",
  "schedule",
  "tag",
];

export function searchEntities(
  rawQuery: string,
  slices: SearchSlices
): SearchResultGroup[] {
  const needle = rawQuery.trim();
  if (needle.length === 0) return [];

  const candidates: Record<SearchEntityType, SearchResult[]> = {
    payee: searchPayees(slices, needle),
    category: searchCategories(slices, needle),
    account: searchAccounts(slices, needle),
    rule: searchRules(slices, needle),
    schedule: searchSchedules(slices, needle),
    tag: searchTags(slices, needle),
  };

  const groups: SearchResultGroup[] = [];
  for (const type of GROUP_ORDER) {
    const group = toGroup(type, candidates[type]);
    if (group) groups.push(group);
  }
  return groups;
}
