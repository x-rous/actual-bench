/**
 * Built-in ActualQL example query packs.
 *
 * All queries are stored in the full wrapped format that the editor uses:
 *   { "ActualQLquery": { "table": "...", ... } }
 *
 * Grouped by purpose. Each example is insertable into the editor in one click.
 */

export type QueryPack = {
  id: string;
  name: string;
  description?: string;
  group: string;
  /**
   * Full wrapped JSON string, or a factory that produces it at insertion time.
   * Use a factory for queries that embed dynamic values (e.g. the current month)
   * so the string is computed fresh when the user clicks the example.
   */
  query: string | (() => string);
};

export type QueryPackGroup = {
  id: string;
  label: string;
  packs: QueryPack[];
};

// ─── Dynamic date helpers ─────────────────────────────────────────────────────

function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ─── Data inspection ──────────────────────────────────────────────────────────

const DATA_INSPECTION: QueryPack[] = [
  {
    id: "list-payees",
    name: "List payees",
    description: "All payees ordered by name.",
    group: "data",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "payees",
          select: ["id", "name"],
          orderBy: ["name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "list-categories",
    name: "List categories",
    description: "All categories with their category group.",
    group: "data",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "categories",
          select: ["id", "name", "group", "group.name"],
          orderBy: ["name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "list-schedules",
    name: "List schedules",
    description: "All schedules with their next due date.",
    group: "data",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "schedules",
          select: ["id", "name", "next_date"],
          orderBy: ["next_date", "name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "latest-transactions",
    name: "Latest 20 transactions",
    description: "The 20 most recent transactions.",
    group: "data",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          select: [
            "id",
            "date",
            "amount",
            "payee.name",
            "category.name",
            "notes",
          ],
          orderBy: [{ date: "desc" }],
          limit: 20,
        },
      },
      null,
      2
    ),
  },
  {
    id: "transactions-this-month",
    name: "Transactions this month",
    description: "Transactions in the current month.",
    group: "data",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            date: {
              $transform: "$month",
              $eq: getCurrentMonth(),
            },
          },
          select: [
            "id",
            "date",
            "amount",
            "payee.name",
            "category.name",
            "notes",
          ],
          orderBy: [{ date: "desc" }],
          limit: 100,
        },
      },
      null,
      2
    ),
  },
];

// ─── Cleanup / validation ─────────────────────────────────────────────────────

const CLEANUP: QueryPack[] = [
  {
    id: "uncategorized-transactions",
    name: "Uncategorized transactions",
    description:
      "Current-month transactions with no category, excluding transfers and off-budget activity.",
    group: "cleanup",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            $and: [
              {
                date: {
                  $transform: "$month",
                  $eq: getCurrentMonth(),
                },
              },
              { category: null },
              { "account.offbudget": false },
              { transfer_id: null },
              { "payee.transfer_acct": null },
            ],
          },
          select: ["id", "date", "amount", "payee.name", "notes"],
          orderBy: [{ date: "desc" }],
          limit: 100,
        },
      },
      null,
      2
    ),
  },
  {
    id: "payees-high-transaction-count",
    name: "Payee transaction counts",
    description:
      "Transaction counts grouped by payee for the current month, excluding transfers and off-budget activity.",
    group: "cleanup",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            $and: [
              {
                date: {
                  $transform: "$month",
                  $eq: getCurrentMonth(),
                },
              },
              { "account.offbudget": false },
              { transfer_id: null },
              { "payee.transfer_acct": null },
            ],
          },
          groupBy: ["payee", "payee.name"],
          select: [
            "payee",
            "payee.name",
            { transactionCount: { $count: "$id" } },
          ],
          orderBy: ["payee.name"],
          limit: 20,
        },
      },
      null,
      2
    ),
  },
  {
    id: "least-used-categories",
    name: "Category usage counts",
    description:
      "Transaction counts grouped by category for the current month (note: this does not include truly unused categories).",
    group: "cleanup",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            $and: [
              {
                date: {
                  $transform: "$month",
                  $eq: getCurrentMonth(),
                },
              },
              { category: { $ne: null } },
              { "account.offbudget": false },
              { transfer_id: null },
              { "payee.transfer_acct": null },
            ],
          },
          groupBy: ["category", "category.name"],
          select: [
            "category",
            "category.name",
            { transactionCount: { $count: "$id" } },
          ],
          orderBy: ["category.name"],
          limit: 20,
        },
      },
      null,
      2
    ),
  },
  {
    id: "schedules-missing-linked-rule",
    name: "Schedules missing linked rule",
    description: "Schedules that do not appear to have a linked rule.",
    group: "cleanup",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "schedules",
          filter: {
            $or: [{ rule: null }, { rule: "" }],
          },
          select: ["id", "name", "next_date", "posts_transaction"],
          orderBy: ["name"],
        },
      },
      null,
      2
    ),
  },
];

// ─── Aggregation ──────────────────────────────────────────────────────────────

const AGGREGATION: QueryPack[] = [
  {
    id: "count-rules",
    name: "Count rules",
    description: "Total number of rules defined in the budget.",
    group: "aggregation",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "rules",
          calculate: { $count: "$id" },
        },
      },
      null,
      2
    ),
  },
  {
    id: "transactions-per-payee",
    name: "Transactions per payee",
    description: "Count of non-transfer transactions grouped by payee this month.",
    group: "aggregation",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            $and: [
              {
                date: {
                  $transform: "$month",
                  $eq: getCurrentMonth(),
                },
              },
              { "account.offbudget": false },
              { transfer_id: null },
              { "payee.transfer_acct": null },
            ],
          },
          groupBy: ["payee", "payee.name"],
          select: [
            "payee",
            "payee.name",
            { transactionCount: { $count: "$id" } },
          ],
          orderBy: ["payee.name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "amount-by-category",
    name: "Amount by category this month",
    description:
      "Total non-transfer transaction amount grouped by category for the current month.",
    group: "aggregation",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            $and: [
              {
                date: {
                  $transform: "$month",
                  $eq: getCurrentMonth(),
                },
              },
              { category: { $ne: null } },
              { "account.offbudget": false },
              { transfer_id: null },
              { "payee.transfer_acct": null },
            ],
          },
          groupBy: ["category", "category.name"],
          select: [
            "category",
            "category.name",
            { totalAmount: { $sum: "$amount" } },
          ],
          orderBy: ["category.name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "amount-by-payee",
    name: "Amount by payee this month",
    description:
      "Total non-transfer transaction amount grouped by payee for the current month.",
    group: "aggregation",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            $and: [
              {
                date: {
                  $transform: "$month",
                  $eq: getCurrentMonth(),
                },
              },
              { "account.offbudget": false },
              { transfer_id: null },
              { "payee.transfer_acct": null },
            ],
          },
          groupBy: ["payee", "payee.name"],
          select: [
            "payee",
            "payee.name",
            { totalAmount: { $sum: "$amount" } },
          ],
          orderBy: ["payee.name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "amount-by-category-group",
    name: "Amount by category group this month",
    description:
      "Total non-transfer transaction amount grouped by category group for the current month.",
    group: "aggregation",
    query: () => JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            $and: [
              {
                date: {
                  $transform: "$month",
                  $eq: getCurrentMonth(),
                },
              },
              { category: { $ne: null } },
              { "account.offbudget": false },
              { transfer_id: null },
              { "payee.transfer_acct": null },
            ],
          },
          groupBy: ["category.group", "category.group.name"],
          select: [
            "category.group",
            "category.group.name",
            { totalAmount: { $sum: "$amount" } },
          ],
          orderBy: ["category.group.name"],
        },
      },
      null,
      2
    ),
  },
];

// ─── Targeted subset queries ──────────────────────────────────────────────────

const TARGETED: QueryPack[] = [
  {
    id: "count-selected-payees",
    name: "Count transactions for selected payees",
    description:
      "Counts transactions for a sample set of payee IDs. Replace the sample IDs before running.",
    group: "targeted",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            payee: {
              $oneof: [
                "sample-payee-id-1",
                "sample-payee-id-2",
                "sample-payee-id-3",
              ],
            },
          },
          groupBy: ["payee", "payee.name"],
          select: [
            "payee",
            "payee.name",
            { transactionCount: { $count: "$id" } },
          ],
          orderBy: ["payee.name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "count-selected-categories",
    name: "Count transactions for selected categories",
    description:
      "Counts transactions for a sample set of category IDs. Replace the sample IDs before running.",
    group: "targeted",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            category: {
              $oneof: [
                "sample-category-id-1",
                "sample-category-id-2",
                "sample-category-id-3",
              ],
            },
          },
          groupBy: ["category", "category.name"],
          select: [
            "category",
            "category.name",
            { transactionCount: { $count: "$id" } },
          ],
          orderBy: ["category.name"],
        },
      },
      null,
      2
    ),
  },
  {
    id: "count-selected-accounts",
    name: "Count transactions for selected accounts",
    description:
      "Counts transactions for a sample set of account IDs. Replace the sample IDs before running.",
    group: "targeted",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            account: {
              $oneof: [
                "sample-account-id-1",
                "sample-account-id-2",
                "sample-account-id-3",
              ],
            },
          },
          groupBy: ["account", "account.name"],
          select: [
            "account",
            "account.name",
            { transactionCount: { $count: "$id" } },
          ],
          orderBy: ["account.name"],
        },
      },
      null,
      2
    ),
  },
];

// ─── Notes / tags ─────────────────────────────────────────────────────────────

const NOTES: QueryPack[] = [
  {
    id: "notes-hashtag-search",
    name: "Transactions with hashtag in notes",
    description:
      "Searches for transactions whose notes contain a sample hashtag. Update the hashtag before running.",
    group: "notes",
    query: JSON.stringify(
      {
        ActualQLquery: {
          table: "transactions",
          options: { splits: "inline" },
          filter: {
            notes: {
              $like: "%#sample-tag%",
            },
          },
          select: [
            "id",
            "date",
            "amount",
            "payee.name",
            "category.name",
            "notes",
          ],
          orderBy: [{ date: "desc" }],
          limit: 100,
        },
      },
      null,
      2
    ),
  },
];

// ─── Exported groups ──────────────────────────────────────────────────────────

export const QUERY_PACK_GROUPS: QueryPackGroup[] = [
  { id: "data", label: "Data inspection", packs: DATA_INSPECTION },
  { id: "cleanup", label: "Cleanup & validation", packs: CLEANUP },
  { id: "aggregation", label: "Aggregation", packs: AGGREGATION },
  { id: "targeted", label: "Targeted subset", packs: TARGETED },
  { id: "notes", label: "Notes & tags", packs: NOTES },
];