"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ArrowUpDown, FileText, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ReconciliationSessionRecord } from "../lib/reconciliationApi";

/**
 * Screen 1 — the reconciliation home (UX §3).
 *
 * The feature opens onto persistent sessions rather than an uploader: a user
 * can stop midway and come back without losing staged decisions. With several
 * sessions per account — reruns, months, corrections — the list has to be
 * scannable, so it is a table with the facts that tell two sessions apart:
 * which account, which statement, what period, how many rows, and where it got
 * to.
 */

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  parsed: "Parsed",
  matching: "Matching",
  needs_review: "In progress",
  ready: "Ready to apply",
  applying: "Applying",
  partial: "Applied with problems",
  completed: "Applied",
  failed: "Failed",
};

/** Tone carries meaning only alongside the label, never instead of it. */
function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "partial":
    case "failed":
      return "border-destructive/40 text-destructive";
    case "ready":
      return "border-sky-500/40 text-sky-600 dark:text-sky-400";
    case "needs_review":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    default:
      return "border-border text-muted-foreground";
  }
}

type SortKey = "updated" | "created" | "account" | "status" | "rows";

function rowCountOf(session: ReconciliationSessionRecord): number | null {
  const totals = session.totals as { rowCount?: number } | null;
  return typeof totals?.rowCount === "number" ? totals.rowCount : null;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function periodOf(session: ReconciliationSessionRecord): string {
  if (!session.statementStart || !session.statementEnd) return "—";
  return `${session.statementStart} → ${session.statementEnd}`;
}

/**
 * Declared outside the list so it is not recreated on every render, which would
 * reset its state and defeat React's reconciliation.
 *
 * `aria-sort` belongs on the header cell, not the button inside it — the column
 * is what is sorted.
 */
function SortableHeader({
  column,
  label,
  sortKey,
  ascending,
  onSort,
}: {
  column: SortKey;
  label: string;
  sortKey: SortKey;
  ascending: boolean;
  onSort: (column: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <th
      scope="col"
      className="px-3 py-2 text-left font-medium"
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "flex items-center gap-1 transition-colors hover:text-foreground",
          active && "text-foreground"
        )}
      >
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>
    </th>
  );
}

type SessionListProps = {
  sessions: ReconciliationSessionRecord[];
  onOpen: (session: ReconciliationSessionRecord) => void;
  onDelete: (session: ReconciliationSessionRecord) => void;
  onNew: () => void;
};

export function SessionList({ sessions, onOpen, onDelete, onNew }: SessionListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [ascending, setAscending] = useState(false);

  const statuses = useMemo(
    () => [...new Set(sessions.map((session) => session.status))].sort(),
    [sessions]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = sessions.filter((session) => {
      if (statusFilter !== "all" && session.status !== statusFilter) return false;
      if (!needle) return true;
      return [session.accountName, session.statementName, session.statementStart]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    const direction = ascending ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "account":
          return direction * (a.accountName ?? "").localeCompare(b.accountName ?? "");
        case "status":
          return direction * a.status.localeCompare(b.status);
        case "rows":
          return direction * ((rowCountOf(a) ?? 0) - (rowCountOf(b) ?? 0));
        case "created":
          return direction * a.createdAt.localeCompare(b.createdAt);
        default:
          return direction * a.updatedAt.localeCompare(b.updatedAt);
      }
    });
  }, [sessions, search, statusFilter, sortKey, ascending]);

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">No reconciliation sessions yet</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Check transactions you entered by hand or through automation against the bank
            statement, then apply only the changes you have reviewed.
          </p>
        </div>
        <Button onClick={onNew}>Start reconciliation</Button>
      </div>
    );
  }

  function sortBy(key: SortKey) {
    if (sortKey === key) setAscending((previous) => !previous);
    else {
      setSortKey(key);
      setAscending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search account or statement…"
            aria-label="Search reconciliation sessions"
            className="h-8 w-64 pl-7 text-xs"
          />
        </div>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Status
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status] ?? status}
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visible.length} of {sessions.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Reconciliation sessions</caption>
          <thead className="sticky top-0 z-10 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border/50">
              <SortableHeader column="account" label="Account" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th scope="col" className="px-3 py-2 text-left font-medium">Statement</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Period</th>
              <SortableHeader column="rows" label="Rows" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader column="status" label="Status" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader column="created" label="Created" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader column="updated" label="Last worked on" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th scope="col" className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((session) => (
              <tr
                key={session.id}
                className="cursor-pointer border-b border-border/30 hover:bg-accent/40"
                onClick={() => onOpen(session)}
              >
                <td className="px-3 py-1.5 font-medium">
                  {session.accountName ?? "Unnamed account"}
                </td>
                <td className="max-w-0 truncate px-3 py-1.5 text-muted-foreground">
                  {session.statementName ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                  {periodOf(session)}
                </td>
                <td className="px-3 py-1.5 tabular-nums">{rowCountOf(session) ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <Badge variant="outline" className={cn("text-[11px]", statusTone(session.status))}>
                    {STATUS_LABELS[session.status] ?? session.status}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                  {formatTimestamp(session.createdAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                  {formatTimestamp(session.updatedAt)}
                </td>
                <td className="px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Delete the reconciliation for ${session.accountName ?? "this account"} created ${formatTimestamp(session.createdAt)}`}
                      onClick={() => onDelete(session)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => onOpen(session)}>
                      {session.status === "completed" ? "View" : "Open"}
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No sessions match that search.
          </p>
        )}
      </div>
    </div>
  );
}
