import type { LoadedCategory, LoadedGroup } from "../types";

export type CategorySearchOption = {
  categoryId: string;
  name: string;
  groupId: string;
  groupName: string;
  isIncome: boolean;
  hidden: boolean;
  groupHidden: boolean;
};

type BuildCategorySearchOptionsInput = {
  groupOrder: string[];
  groupsById: Record<string, LoadedGroup>;
  categoriesById: Record<string, LoadedCategory>;
};

export function buildCategorySearchOptions({
  groupOrder,
  groupsById,
  categoriesById,
}: BuildCategorySearchOptionsInput): CategorySearchOption[] {
  const expenseIds = groupOrder.filter((id) => !groupsById[id]?.isIncome);
  const incomeIds = groupOrder.filter((id) => groupsById[id]?.isIncome);
  const options: CategorySearchOption[] = [];

  for (const groupId of [...expenseIds, ...incomeIds]) {
    const group = groupsById[groupId];
    if (!group) continue;
    for (const categoryId of group.categoryIds) {
      const category = categoriesById[categoryId];
      if (!category) continue;
      options.push({
        categoryId: category.id,
        name: category.name,
        groupId: group.id,
        groupName: group.name,
        isIncome: category.isIncome,
        hidden: category.hidden,
        groupHidden: group.hidden,
      });
    }
  }

  return options;
}

export function filterCategorySearchOptions(
  options: CategorySearchOption[],
  query: string
): CategorySearchOption[] {
  const term = normalizeSearchText(query);
  if (!term) return options;
  const tokens = term.split(" ");
  return options
    .map((option, index) => {
      const rank = scoreCategorySearchOption(option, term, tokens);
      return rank === null ? null : { option, rank, index };
    })
    .filter(
      (match): match is { option: CategorySearchOption; rank: number; index: number } =>
        match !== null
    )
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((match) => match.option);
}

function scoreCategorySearchOption(
  option: CategorySearchOption,
  term: string,
  tokens: string[]
): number | null {
  const name = normalizeSearchText(option.name);
  const groupName = normalizeSearchText(option.groupName);
  const combined = `${name} ${groupName} ${option.isIncome ? "income" : "expense"}`;

  const exactName = scoreText(name, term);
  if (exactName !== null) return exactName;

  const exactGroup = scoreText(groupName, term);
  if (exactGroup !== null) return exactGroup + 30;

  const tokenScore = scoreTokens(combined, tokens);
  if (tokenScore !== null) return tokenScore + 60;

  const fuzzyName = scoreSubsequence(name, term);
  if (fuzzyName !== null) return fuzzyName + 90;

  const fuzzyCombined = scoreSubsequence(combined, term);
  if (fuzzyCombined !== null) return fuzzyCombined + 130;

  return null;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreText(text: string, term: string): number | null {
  if (text === term) return 0;
  if (text.startsWith(term)) return 10;
  if (text.split(" ").some((word) => word.startsWith(term))) return 20;
  if (text.includes(term)) return 30;
  return null;
}

function scoreTokens(text: string, tokens: string[]): number | null {
  let total = 0;
  for (const token of tokens) {
    const score = scoreText(text, token) ?? scoreSubsequence(text, token);
    if (score === null) return null;
    total += score;
  }
  return total;
}

function scoreSubsequence(text: string, term: string): number | null {
  if (!term) return 0;
  let lastIndex = -1;
  let firstIndex = -1;

  for (const char of term) {
    const nextIndex = text.indexOf(char, lastIndex + 1);
    if (nextIndex === -1) return null;
    if (firstIndex === -1) firstIndex = nextIndex;
    lastIndex = nextIndex;
  }

  const spread = lastIndex - firstIndex - term.length + 1;
  return 40 + Math.max(0, spread);
}
