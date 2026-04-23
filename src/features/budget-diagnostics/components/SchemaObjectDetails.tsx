import { Badge } from "@/components/ui/badge";
import type { ColumnInfo, IndexInfo, RowKeyInfo, SchemaObjectDetails as Details } from "../types";

type SchemaObjectDetailsProps = {
  details: Details;
};

function formatCount(details: Details): string {
  if (details.rowCountError) return "Count unavailable";
  return details.rowCount === null ? "Not row-browsable" : details.rowCount.toLocaleString("en-US");
}

function rowKeyLabel(rowKey: RowKeyInfo | null): string {
  if (!rowKey) return "None inferred";
  if (rowKey.source === "primaryKey") return `${rowKey.column} (primary key)`;
  if (rowKey.source === "knownKey") return `${rowKey.column} (known Actual key)`;
  return `${rowKey.column} (SQLite rowid)`;
}

function defaultValueLabel(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function typeBadgeVariant(type: Details["type"]) {
  return type === "table" || type === "view" ? "status-active" : "status-inactive";
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function ColumnsTable({ columns }: { columns: ColumnInfo[] }) {
  if (columns.length === 0) {
    return (
      <div className="py-8 text-sm text-muted-foreground">
        This object does not expose columns through PRAGMA table_info.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-muted">
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              #
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Name
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Type
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Not null
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              PK
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Default
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.cid} className="border-b border-border/40 hover:bg-muted/20">
              <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-muted-foreground">
                {column.cid}
              </td>
              <td className="max-w-56 truncate px-3 py-1.5 font-mono text-foreground" title={column.name}>
                {column.name}
              </td>
              <td className="max-w-40 truncate px-3 py-1.5 font-mono text-foreground" title={column.type}>
                {column.type || "untyped"}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {column.notNull ? "Yes" : "No"}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-muted-foreground">
                {column.primaryKeyPosition || "—"}
              </td>
              <td
                className="max-w-56 truncate px-3 py-1.5 font-mono text-muted-foreground"
                title={defaultValueLabel(column.defaultValue)}
              >
                {defaultValueLabel(column.defaultValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndexesTable({ indexes }: { indexes: IndexInfo[] }) {
  if (indexes.length === 0) {
    return (
      <div className="py-8 text-sm text-muted-foreground">
        No table indexes are available for this object.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-muted">
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Name
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Unique
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Origin
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground">
              Partial
            </th>
          </tr>
        </thead>
        <tbody>
          {indexes.map((index) => (
            <tr key={index.name} className="border-b border-border/40 hover:bg-muted/20">
              <td className="max-w-64 truncate px-3 py-1.5 font-mono text-foreground" title={index.name}>
                {index.name}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {index.unique ? "Yes" : "No"}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 font-mono text-muted-foreground">
                {index.origin ?? "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {index.partial ? "Yes" : "No"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SchemaObjectDetails({ details }: SchemaObjectDetailsProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="space-y-6 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{details.name}</h3>
          <Badge variant={typeBadgeVariant(details.type)}>{details.type}</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label="Object" value={details.name} />
          <InfoTile label="Parent table" value={details.tableName ?? "Not applicable"} />
          <InfoTile label="Rows" value={formatCount(details)} />
          <InfoTile label="Row key" value={rowKeyLabel(details.rowKey)} />
        </div>

        {details.rowCountError && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Row count could not be computed for this object: {details.rowCountError}
          </div>
        )}

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Columns</h4>
          <ColumnsTable columns={details.columns} />
        </section>

        {details.type === "table" && (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Indexes</h4>
            <IndexesTable indexes={details.indexes} />
          </section>
        )}

        {details.type === "view" && (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Indexes</h4>
            <div className="py-2 text-sm text-muted-foreground">
              Views do not have table indexes.
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Raw SQL</h4>
          {details.sql ? (
            <pre className="max-h-80 overflow-auto rounded-md bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
              {details.sql}
            </pre>
          ) : (
            <div className="py-2 text-sm text-muted-foreground">
              SQLite did not return a CREATE statement for this object.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
