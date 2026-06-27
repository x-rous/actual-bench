import {
  Calendar,
  Database,
  FileSearch,
  Landmark,
  LayoutList,
  ScrollText,
  ShieldCheck,
  Tag,
  Terminal,
  Users,
  Wallet,
} from "lucide-react";
import type { OverviewActionCard } from "../types";

export const MANAGE_DATA_TITLE = "Advanced Data Management";

export const MANAGE_DATA_DESCRIPTION =
  "Manage accounts, payees, categories, rules, schedules, and tags with bulk editing, CSV import/export, usage visibility, and advanced rule support.";

export const ADVANCED_TOOLS_DESCRIPTION =
  "Tools for deeper inspection and analysis.";

export const ENTITY_CARDS: OverviewActionCard[] = [
  {
    id: "budget-management",
    label: "Budget Management",
    description:
      "Manage monthly budget amounts, carryover settings, and holds across all category groups.",
    href: "/budget-management",
    icon: Wallet,
    tone: "entity",
  },
  {
    id: "rules",
    label: "Rules",
    description:
      "Review, refine, and consolidate rules, with visibility into where they are used.",
    href: "/rules",
    icon: ScrollText,
    tone: "entity",
  },
  {
    id: "accounts",
    label: "Accounts",
    description:
      "Maintain accounts with balance visibility and linked rule usage.",
    href: "/accounts",
    icon: Landmark,
    tone: "entity",
  },
  {
    id: "payees",
    label: "Payees",
    description:
      "Clean up payees through editing, bulk updates, and merging multiple payees.",
    href: "/payees",
    icon: Users,
    tone: "entity",
  },
  {
    id: "categories",
    label: "Categories",
    description:
      "Review and refine the category structure, manage groups, and see which categories have linked rules.",
    href: "/categories",
    icon: LayoutList,
    tone: "entity",
  },
  {
    id: "schedules",
    label: "Schedules",
    description:
      "View and maintain schedules in one focused place, with access to the linked rule when needed.",
    href: "/schedules",
    icon: Calendar,
    tone: "entity",
  },
  {
    id: "tags",
    label: "Tags",
    description:
      "Review and clean up tags by editing names, descriptions, and colors.",
    href: "/tags",
    icon: Tag,
    tone: "entity",
  },
];

export const TOOL_CARDS: OverviewActionCard[] = [
  {
    id: "query",
    label: "ActualQL Queries",
    description:
      "Explore budget data with custom ActualQL queries, inspect the results, and export the output.",
    href: "/query",
    icon: Terminal,
    tone: "tool",
  },
  {
    id: "diagnostics",
    label: "Budget File Health",
    description:
      "Inspect the exported budget file in a read-only workspace with an overview and deterministic health checks.",
    icon: FileSearch,
    tone: "tool",
    href: "/budget-diagnostics",
  },
  {
    id: "data-browser",
    label: "Data Browser",
    description:
      "Browse the budget file's SQLite tables, views, and rows directly, with schema inspection and CSV export.",
    icon: Database,
    tone: "tool",
    href: "/data-browser",
  },
  {
    id: "rule-diagnostics",
    label: "Rule Diagnostics",
    description:
      "Analyse rule coverage and conflicts across your transactions to identify gaps and overlapping conditions.",
    icon: ShieldCheck,
    tone: "tool",
    href: "/rules/diagnostics",
  },
];
