import {
  ArrowLeftRight,
  Calendar,
  ClipboardCheck,
  Database,
  DatabaseBackup,
  FileSearch,
  Landmark,
  LayoutList,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Tag,
  Terminal,
  Timer,
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

/**
 * In the same order as the Tools section of the sidebar.
 *
 * Two lists of the same links in two different orders makes the overview read
 * as a different set of tools rather than the same ones — so this follows the
 * navigation.
 *
 * Not every navigation entry earns a card: FX Rates exists to support currency
 * conversion in Budget File Sync rather than as somewhere to go in its own
 * right, so it stays in the sidebar and out of here.
 */
export const TOOL_CARDS: OverviewActionCard[] = [
  {
    id: "rule-diagnostics",
    label: "Rule Diagnostics",
    description:
      "Analyse rule coverage and conflicts across your transactions to identify gaps and overlapping conditions.",
    icon: ShieldCheck,
    tone: "tool",
    href: "/rules/diagnostics",
  },
  {
    id: "payee-cleanup",
    label: "Payee Cleanup",
    description:
      "Find payees that are really the same merchant under different bank spellings, with the evidence behind every suggestion.",
    icon: Sparkles,
    tone: "tool",
    href: "/payees/cleanup",
  },
  {
    id: "reconciliation",
    label: "Bank Reconciliation",
    description:
      "Check a bank statement against an account, settle the differences row by row, and apply only what you have reviewed.",
    icon: ClipboardCheck,
    tone: "tool",
    href: "/reconciliation",
  },
  {
    id: "sync",
    label: "Budget File Sync",
    description:
      "Copy transactions, payees, and categories between budget files as preview-first, one-way flows with run history and safe automation.",
    icon: ArrowLeftRight,
    tone: "tool",
    href: "/sync",
  },
  {
    id: "backups",
    label: "Backups",
    description:
      "Keep verified copies of your budget on a schedule, in more than one place, and know what you would get back if you needed it.",
    icon: DatabaseBackup,
    tone: "tool",
    href: "/backups",
  },
  {
    id: "automations",
    label: "Automations",
    description:
      "Schedule bank syncs, backups and budget file syncs - then see what ran, when, what it did, and whether it runs on the server or only while Bench is open.",
    icon: Timer,
    tone: "tool",
    href: "/automations",
  },
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
    id: "data-browser",
    label: "Data Browser",
    description:
      "Browse the budget file's SQLite tables, views, and rows directly, with schema inspection and CSV export.",
    icon: Database,
    tone: "tool",
    href: "/data-browser",
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
];
