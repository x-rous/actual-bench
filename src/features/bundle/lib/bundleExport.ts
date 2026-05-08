import { zipSync, strToU8 } from "fflate";
import { exportAccountsToCsv } from "@/features/accounts/csv/accountsCsvExport";
import { exportPayeesToCsv } from "@/features/payees/csv/payeesCsvExport";
import { exportCategoriesToCsv } from "@/features/categories/csv/categoriesCsvExport";
import { exportTagsToCsv } from "@/features/tags/csv/tagsCsvExport";
import { exportSchedulesToCsv } from "@/features/schedules/csv/schedulesCsvExport";
import { exportRulesToCsv } from "@/features/rules/csv/rulesCsvExport";
import type { StagedMap } from "@/types/staged";
import type { Account, Payee, CategoryGroup, Category, Tag, Schedule, Rule } from "@/types/entities";

const BOM = "﻿";

export type BundleEntityKey =
  | "accounts"
  | "payees"
  | "categories"
  | "tags"
  | "schedules"
  | "rules";

export const BUNDLE_ENTITY_LABELS: Record<BundleEntityKey, string> = {
  accounts: "Accounts",
  payees: "Payees",
  categories: "Categories & Groups",
  tags: "Tags",
  schedules: "Schedules",
  rules: "Rules",
};

export const ALL_BUNDLE_ENTITY_KEYS: BundleEntityKey[] = [
  "accounts",
  "payees",
  "categories",
  "tags",
  "schedules",
  "rules",
];

type BundleExportInput = {
  accounts: StagedMap<Account>;
  payees: StagedMap<Payee>;
  categoryGroups: StagedMap<CategoryGroup>;
  categories: StagedMap<Category>;
  tags: StagedMap<Tag>;
  schedules: StagedMap<Schedule>;
  rules: StagedMap<Rule>;
};

export function exportBundle(
  staged: BundleExportInput,
  selected: Set<BundleEntityKey>
): Blob {
  const { accounts, payees, categoryGroups, categories, tags, schedules, rules } = staged;
  const files: Record<string, Uint8Array> = {};

  if (selected.has("accounts")) {
    files["accounts.csv"] = strToU8(BOM + exportAccountsToCsv(accounts));
  }
  if (selected.has("payees")) {
    files["payees.csv"] = strToU8(BOM + exportPayeesToCsv(payees));
  }
  if (selected.has("categories")) {
    files["category-groups-and-categories.csv"] = strToU8(
      BOM + exportCategoriesToCsv(categoryGroups, categories)
    );
  }
  if (selected.has("tags")) {
    files["tags.csv"] = strToU8(BOM + exportTagsToCsv(tags));
  }
  if (selected.has("schedules")) {
    files["schedules.csv"] = strToU8(
      BOM + exportSchedulesToCsv(schedules, { payees, accounts })
    );
  }
  if (selected.has("rules")) {
    files["rules.csv"] = strToU8(
      BOM + exportRulesToCsv(rules, { payees, categories, accounts, categoryGroups })
    );
  }

  const zipped = zipSync(files);
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}
