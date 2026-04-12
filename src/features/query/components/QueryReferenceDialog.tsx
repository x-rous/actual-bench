"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QueryReferenceDialogProps {
  open: boolean;
  onClose: () => void;
}

// ─── Snippet copy helper ──────────────────────────────────────────────────────

function Snippet({ code }: { code: string }) {
  function copy() {
    navigator.clipboard
      .writeText(code)
      .then(() => toast.success("Snippet copied"))
      .catch(() => toast.error("Failed to copy"));
  }

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        title="Copy snippet"
        className="absolute right-1.5 top-1.5 flex rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-xs leading-relaxed text-foreground/80">{children}</p>;
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex gap-2 text-xs">
      <code className="shrink-0 rounded bg-muted/60 px-1 font-mono text-[11px] text-foreground">
        {label}
      </code>
      <span className="text-foreground/70">{children}</span>
    </div>
  );
}

// ─── QueryReferenceDialog ─────────────────────────────────────────────────────

export function QueryReferenceDialog({
  open,
  onClose,
}: QueryReferenceDialogProps) {
  const [section, setSection] = useState<
    "basics" | "filters" | "joins" | "aggregates" | "transactions" | "snippets" | "datamodel"
  >("basics");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="flex h-[80vh] sm:max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="text-sm">ActualQL quick reference</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Section nav */}
          <nav className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border p-2 pt-3">
            {(
              [
                ["basics", "Basics"],
                ["filters", "Filters"],
                ["joins", "Joins"],
                ["aggregates", "Aggregates"],
                ["transactions", "Transactions"],
                ["snippets", "Snippets"],
                ["datamodel", "Data model"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  section === id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {section === "basics" && <BasicsSection />}
            {section === "filters" && <FiltersSection />}
            {section === "joins" && <JoinsSection />}
            {section === "aggregates" && <AggregatesSection />}
            {section === "transactions" && <TransactionsSection />}
            {section === "snippets" && <SnippetsSection />}
            {section === "datamodel" && <DataModelSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function BasicsSection() {
  return (
    <div className="flex flex-col gap-4">
      <Para>
        ActualQL is a JSON-based query language for reading data from an Actual Budget.
        All queries must be wrapped in <code className="font-mono text-[11px]">{"{ \"ActualQLquery\": { ... } }"}</code>.
      </Para>

      <div>
        <Heading>Required field</Heading>
        <Kv label="table">Target table name — e.g. <code className="font-mono text-[11px]">transactions</code>, <code className="font-mono text-[11px]">payees</code>, <code className="font-mono text-[11px]">categories</code>, <code className="font-mono text-[11px]">schedules</code>, <code className="font-mono text-[11px]">rules</code></Kv>
      </div>

      <div>
        <Heading>Optional fields</Heading>
        <Kv label="filter">Filter conditions — see Filters section</Kv>
        <Kv label="select">Fields to return — array of field names or aggregate objects</Kv>
        <Kv label="groupBy">Array of fields to group by — pair with aggregates in select</Kv>
        <Kv label="calculate">Scalar aggregate — returns a single value instead of rows</Kv>
        <Kv label="orderBy">Array of field names or <code className="font-mono text-[11px]">{"{ field: \"asc\" | \"desc\" }"}</code></Kv>
        <Kv label="limit">Maximum number of rows to return</Kv>
        <Kv label="offset">Number of rows to skip (for pagination)</Kv>
      </div>

      <div>
        <Heading>Minimal example</Heading>
        <Snippet
          code={`{\n  "ActualQLquery": {\n    "table": "payees",\n    "limit": 10\n  }\n}`}
        />
      </div>
    </div>
  );
}

function FiltersSection() {
  return (
    <div className="flex flex-col gap-4">
      <Para>Filters go inside the <code className="font-mono text-[11px]">filter</code> object.</Para>

      <div>
        <Heading>Equality</Heading>
        <Snippet code={`"filter": { "payee": "abc-id-123" }`} />
      </div>

      <div>
        <Heading>Null check</Heading>
        <Snippet code={`"filter": { "category": null }`} />
      </div>

      <div>
        <Heading>Comparison — $gte, $lte</Heading>
        <Snippet
          code={`"filter": {\n  "date": { "$gte": "2025-01-01", "$lte": "2025-01-31" }\n}`}
        />
      </div>

      <div>
        <Heading>$oneof — match any in a list</Heading>
        <Snippet
          code={`"filter": { "payee": { "$oneof": ["id-1", "id-2", "id-3"] } }`}
        />
      </div>

      <div>
        <Heading>$and — all conditions must match</Heading>
        <Snippet
          code={`"filter": {\n  "$and": [\n    { "date": { "$gte": "2025-01-01" } },\n    { "category": null }\n  ]\n}`}
        />
      </div>

      <div>
        <Heading>$or — any condition must match</Heading>
        <Snippet
          code={`"filter": {\n  "$or": [\n    { "payee": "id-1" },\n    { "payee": "id-2" }\n  ]\n}`}
        />
      </div>

      <div>
        <Heading>$like — pattern match</Heading>
        <Snippet code={`"filter": { "notes": { "$like": "%refund%" } }`} />
      </div>
    </div>
  );
}

function JoinsSection() {
  return (
    <div className="flex flex-col gap-4">
      <Para>
        ActualQL supports dotted paths to traverse relationships. This lets you
        select and filter on fields from linked tables without writing explicit
        joins.
      </Para>

      <div>
        <Heading>Common dotted paths</Heading>
        <Kv label="payee.name">Name of the transaction payee</Kv>
        <Kv label="category.name">Name of the transaction category</Kv>
        <Kv label="category.group.name">Name of the category group</Kv>
        <Kv label="account.name">Name of the account</Kv>
      </div>

      <div>
        <Heading>Using dotted paths in select</Heading>
        <Snippet
          code={`"select": [\n  "date",\n  "amount",\n  "payee.name",\n  "category.name",\n  "category.group.name"\n]`}
        />
      </div>

      <div>
        <Heading>Using dotted paths in groupBy</Heading>
        <Snippet
          code={`"groupBy": ["payee", "payee.name"],\n"select": [\n  "payee",\n  "payee.name",\n  { "count": { "$count": "$id" } }\n]`}
        />
      </div>

      <div>
        <Heading>Using dotted paths in filter</Heading>
        <Snippet
          code={`"filter": { "payee.name": { "$like": "%Amazon%" } }`}
        />
      </div>
    </div>
  );
}

function AggregatesSection() {
  return (
    <div className="flex flex-col gap-4">
      <Para>
        Aggregates compute values across grouped rows. Use them in{" "}
        <code className="font-mono text-[11px]">select</code> (per group) or{" "}
        <code className="font-mono text-[11px]">calculate</code> (single scalar).
      </Para>

      <div>
        <Heading>Functions</Heading>
        <Kv label="$count">Count rows — typically <code className="font-mono text-[11px]">{"{ \"$count\": \"$id\" }"}</code></Kv>
        <Kv label="$sum">Sum a numeric field — typically amount</Kv>
        <Kv label="$avg">Average a numeric field</Kv>
        <Kv label="$min">Minimum value</Kv>
        <Kv label="$max">Maximum value</Kv>
      </div>

      <div>
        <Heading>Grouped count in select</Heading>
        <Snippet
          code={`"groupBy": ["payee", "payee.name"],\n"select": [\n  "payee",\n  "payee.name",\n  { "count": { "$count": "$id" } }\n],\n"orderBy": [{ "count": "desc" }]`}
        />
      </div>

      <div>
        <Heading>Grouped sum in select</Heading>
        <Snippet
          code={`"groupBy": ["category", "category.name"],\n"select": [\n  "category",\n  "category.name",\n  { "total": { "$sum": "$amount" } }\n]`}
        />
      </div>

      <div>
        <Heading>Scalar result with calculate</Heading>
        <Para>
          Returns a single number, not a list of rows. Useful for totals and counts.
        </Para>
        <Snippet
          code={`"table": "transactions",\n"calculate": { "$count": "$id" }`}
        />
      </div>
    </div>
  );
}

function TransactionsSection() {
  return (
    <div className="flex flex-col gap-4">
      <Para>
        The <code className="font-mono text-[11px]">transactions</code> table is the most common query target.
        Keep these notes in mind.
      </Para>

      <div>
        <Heading>Amounts</Heading>
        <Para>
          Amounts are stored in cents (integer). Divide by 100 to get the value
          in your budget&apos;s currency unit (e.g. <code className="font-mono text-[11px]">1200</code> = $12.00).
          Negative values are expenses.
        </Para>
      </div>

      <div>
        <Heading>Dates</Heading>
        <Para>
          Dates are ISO strings like <code className="font-mono text-[11px]">2025-01-15</code>.
          Use <code className="font-mono text-[11px]">$gte</code> and <code className="font-mono text-[11px]">$lte</code> to filter by date range.
        </Para>
      </div>

      <div>
        <Heading>options.splits</Heading>
        <Kv label="inline">Sub-transactions appear as individual rows (default)</Kv>
        <Kv label="grouped">Sub-transactions are grouped under their parent</Kv>
        <Kv label="all">Returns both parent and child transactions</Kv>
        <Snippet
          code={`"table": "transactions",\n"options": { "splits": "grouped" },\n"limit": 20`}
        />
      </div>

      <div>
        <Heading>Unbounded scan warning</Heading>
        <Para>
          Querying <code className="font-mono text-[11px]">transactions</code> without a <code className="font-mono text-[11px]">limit</code>,
          <code className="font-mono text-[11px]">groupBy</code>, or <code className="font-mono text-[11px]">calculate</code> can return
          thousands of rows and may time out (proxy enforces a 15-second limit).
        </Para>
      </div>
    </div>
  );
}

function SnippetsSection() {
  return (
    <div className="flex flex-col gap-4">
      <Para>Copyable starter snippets. Paste into the editor and edit as needed.</Para>

      <div>
        <Heading>Month filter (January 2025)</Heading>
        <Snippet
          code={`"filter": {\n  "date": { "$gte": "2025-01-01", "$lte": "2025-01-31" }\n}`}
        />
      </div>

      <div>
        <Heading>Date range filter</Heading>
        <Snippet
          code={`"filter": {\n  "date": { "$gte": "2025-01-01", "$lte": "2025-03-31" }\n}`}
        />
      </div>

      <div>
        <Heading>Selected IDs with $oneof</Heading>
        <Snippet
          code={`"filter": {\n  "payee": { "$oneof": ["id-1", "id-2", "id-3"] }\n}`}
        />
      </div>

      <div>
        <Heading>Grouped count</Heading>
        <Snippet
          code={`"groupBy": ["payee", "payee.name"],\n"select": [\n  "payee",\n  "payee.name",\n  { "count": { "$count": "$id" } }\n],\n"orderBy": [{ "count": "desc" }]`}
        />
      </div>

      <div>
        <Heading>Grouped sum</Heading>
        <Snippet
          code={`"groupBy": ["category", "category.name"],\n"select": [\n  "category",\n  "category.name",\n  { "total": { "$sum": "$amount" } }\n],\n"orderBy": [{ "total": "asc" }]`}
        />
      </div>

      <div>
        <Heading>Scalar row count</Heading>
        <Snippet
          code={`{\n  "ActualQLquery": {\n    "table": "transactions",\n    "calculate": { "$count": "$id" }\n  }\n}`}
        />
      </div>
    </div>
  );
}

function DataModelSection() {
  return (
    <div className="flex flex-col gap-5">
      <Para>
        ActualQL exposes the following tables. Use dotted paths to traverse relationships —
        e.g. <code className="font-mono text-[11px]">payee.name</code> on a{" "}
        <code className="font-mono text-[11px]">transactions</code> query resolves the linked payee&apos;s name.
      </Para>

      {/* ── transactions ──────────────────────────────────────────────────── */}
      <div>
        <Heading>transactions</Heading>
        <Para>The core table. Each row is one transaction (or split sub-transaction).</Para>
        <div className="overflow-x-auto rounded-md border border-border text-[11px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Field</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Type</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[
                ["id", "string", "UUID — primary key"],
                ["date", "string", "ISO date, e.g. 2025-01-15"],
                ["amount", "integer", "Cents (÷ 100 for dollar value). Negative = expense"],
                ["notes", "string | null", "Free-text memo"],
                ["imported_id", "string | null", "Bank-provided transaction ID"],
                ["transfer_id", "string | null", "Non-null for transfer legs"],
                ["payee", "string | null", "Foreign key → payees.id"],
                ["category", "string | null", "Foreign key → categories.id"],
                ["account", "string", "Foreign key → accounts.id"],
              ].map(([f, t, n]) => (
                <tr key={f} className="border-b border-border/40">
                  <td className="px-3 py-1 text-foreground">{f}</td>
                  <td className="px-3 py-1 text-muted-foreground">{t}</td>
                  <td className="px-3 py-1 font-sans text-muted-foreground/80">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── payees ────────────────────────────────────────────────────────── */}
      <div>
        <Heading>payees</Heading>
        <Para>All payees (merchants, transfer accounts, starting balances).</Para>
        <div className="overflow-x-auto rounded-md border border-border text-[11px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Field</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Type</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[
                ["id", "string", "UUID"],
                ["name", "string", "Human-readable payee name"],
                ["transfer_acct", "string | null", "Non-null for transfer payees"],
              ].map(([f, t, n]) => (
                <tr key={f} className="border-b border-border/40">
                  <td className="px-3 py-1 text-foreground">{f}</td>
                  <td className="px-3 py-1 text-muted-foreground">{t}</td>
                  <td className="px-3 py-1 font-sans text-muted-foreground/80">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── categories ────────────────────────────────────────────────────── */}
      <div>
        <Heading>categories</Heading>
        <Para>Budget categories. Each belongs to one category group.</Para>
        <div className="overflow-x-auto rounded-md border border-border text-[11px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Field</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Type</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[
                ["id", "string", "UUID"],
                ["name", "string", "Category name"],
                ["group", "string", "Foreign key → category_groups.id"],
                ["hidden", "boolean", "Hidden from budget view"],
              ].map(([f, t, n]) => (
                <tr key={f} className="border-b border-border/40">
                  <td className="px-3 py-1 text-foreground">{f}</td>
                  <td className="px-3 py-1 text-muted-foreground">{t}</td>
                  <td className="px-3 py-1 font-sans text-muted-foreground/80">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── accounts ──────────────────────────────────────────────────────── */}
      <div>
        <Heading>accounts</Heading>
        <Para>Bank accounts and tracking accounts.</Para>
        <div className="overflow-x-auto rounded-md border border-border text-[11px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Field</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Type</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[
                ["id", "string", "UUID"],
                ["name", "string", "Account name"],
                ["offbudget", "boolean", "true = tracking account, excluded from budget"],
                ["closed", "boolean", "true = closed account"],
              ].map(([f, t, n]) => (
                <tr key={f} className="border-b border-border/40">
                  <td className="px-3 py-1 text-foreground">{f}</td>
                  <td className="px-3 py-1 text-muted-foreground">{t}</td>
                  <td className="px-3 py-1 font-sans text-muted-foreground/80">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── schedules / rules ─────────────────────────────────────────────── */}
      <div>
        <Heading>schedules &amp; rules</Heading>
        <Para>
          <code className="font-mono text-[11px]">schedules</code> stores recurring transaction templates.
          Each schedule can link to a <code className="font-mono text-[11px]">rules</code> row which controls
          auto-matching of imported transactions.
        </Para>
        <div className="mb-2 overflow-x-auto rounded-md border border-border text-[11px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Field (schedules)</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[
                ["id", "UUID"],
                ["name", "Human-readable name"],
                ["next_date", "ISO date of next occurrence"],
                ["posts_transaction", "boolean — auto-post when due"],
                ["rule", "Foreign key → rules.id (nullable)"],
              ].map(([f, n]) => (
                <tr key={f} className="border-b border-border/40">
                  <td className="px-3 py-1 text-foreground">{f}</td>
                  <td className="px-3 py-1 font-sans text-muted-foreground/80">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Relationship map ──────────────────────────────────────────────── */}
      <div>
        <Heading>Dotted-path relationship map</Heading>
        <Para>
          These are the most useful dotted paths when querying{" "}
          <code className="font-mono text-[11px]">transactions</code>:
        </Para>
        <div className="overflow-x-auto rounded-md border border-border text-[11px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Dotted path</th>
                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Resolves to</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[
                ["payee.name", "Payee display name"],
                ["payee.transfer_acct", "Linked account ID for transfer payees"],
                ["category.name", "Category display name"],
                ["category.group", "Category group ID"],
                ["category.group.name", "Category group display name"],
                ["account.name", "Account display name"],
                ["account.offbudget", "boolean — off-budget / tracking account"],
                ["account.closed", "boolean — account is closed"],
              ].map(([p, r]) => (
                <tr key={p} className="border-b border-border/40">
                  <td className="px-3 py-1 text-foreground">{p}</td>
                  <td className="px-3 py-1 font-sans text-muted-foreground/80">{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Para>
          Dotted paths work in <code className="font-mono text-[11px]">select</code>,{" "}
          <code className="font-mono text-[11px]">filter</code>,{" "}
          <code className="font-mono text-[11px]">groupBy</code>, and{" "}
          <code className="font-mono text-[11px]">orderBy</code>. When used in{" "}
          <code className="font-mono text-[11px]">groupBy</code>, always include both the ID field and the
          name path so the result set is unambiguous.
        </Para>
      </div>
    </div>
  );
}
