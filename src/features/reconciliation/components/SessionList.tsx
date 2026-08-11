"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ArrowUpDown, FileText, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditableCellInput } from "@/components/ui/editable-cell";
import { MultiPillGroup } from "@/components/ui/pill-group";
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

/**
 * The order statuses are offered in, which is the order a session moves through
 * them — not alphabetical, which would put "Applied" before "Draft" and read as
 * nonsense.
 */
const STATUS_ORDER = [
  "draft",
  "parsed",
  "matching",
  "needs_review",
  "ready",
  "applying",
  "partial",
  "completed",
  "failed",
];

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The months a session's statement covers, as `YYYY-MM`.
 *
 * A statement period regularly straddles two months (a card cycle running the
 * 2nd to the 6th of the next), so a session has to answer to either of them or
 * filtering by the month you remember would hide it.
 */
function monthsCovered(session: ReconciliationSessionRecord): string[] {
  const start = session.statementStart;
  const end = session.statementEnd;
  if (!start || !end) return [];

  const months: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const lastYear = Number(end.slice(0, 4));
  const lastMonth = Number(end.slice(5, 7));
  if (!year || !month || !lastYear || !lastMonth) return [];

  // Bounded rather than while(true): a corrupt period must not spin here.
  for (let guard = 0; guard < 240; guard += 1) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    if (year > lastYear || (year === lastYear && month >= lastMonth)) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function rowCountOf(session: ReconciliationSessionRecord): number | null {
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
      className="border-b border-border bg-background px-3 py-2 text-left font-medium"
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
  onRetag: (session: ReconciliationSessionRecord, tag: string | null) => void;
  onNew: () => void;
};

export function SessionList({ sessions, onOpen, onDelete, onRetag, onNew }: SessionListProps) {
  /** Which row's tag is being edited. A mistyped label should not be permanent. */
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("all");
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [ascending, setAscending] = useState(false);

  // Only statuses actually present are offered — a filter for a state no
  // session is in is a dead control that costs the reader a moment to dismiss.
  const statusOptions = useMemo(() => {
    const present = new Set<string>(sessions.map((session) => session.status));
    const counts = new Map<string, number>();
    for (const session of sessions) {
      counts.set(session.status, (counts.get(session.status) ?? 0) + 1);
    }
    return STATUS_ORDER.filter((status) => present.has(status)).map((status) => ({
      value: status,
      label: STATUS_LABELS[status] ?? status,
      count: counts.get(status),
    }));
  }, [sessions]);

  /** Months each session covers, computed once rather than per keystroke. */
  const monthsBySession = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const session of sessions) map.set(session.id, monthsCovered(session));
    return map;
  }, [sessions]);

  const tags = useMemo(
    () =>
      [
        ...new Set(
          sessions.map((session) => session.tag).filter((tag): tag is string => Boolean(tag))
        ),
      ].sort(),
    [sessions]
  );

  const years = useMemo(() => {
    const present = new Set<string>();
    for (const months of monthsBySession.values()) {
      for (const entry of months) present.add(entry.slice(0, 4));
    }
    return [...present].sort().reverse();
  }, [monthsBySession]);

  const filtersActive =
    search.trim().length > 0 ||
    statusFilters.length > 0 ||
    tagFilter !== "all" ||
    year !== "all" ||
    month !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilters([]);
    setTagFilter("all");
    setYear("all");
    setMonth("all");
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const selectedStatuses = new Set(statusFilters);
    const filtered = sessions.filter((session) => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(session.status)) return false;
      if (tagFilter !== "all" && (session.tag ?? "") !== tagFilter) return false;

      if (year !== "all" || month !== "all") {
        const months = monthsBySession.get(session.id) ?? [];
        const matchesPeriod = months.some((entry) => {
          if (year !== "all" && entry.slice(0, 4) !== year) return false;
          if (month !== "all" && entry.slice(5, 7) !== month) return false;
          return true;
        });
        if (!matchesPeriod) return false;
      }

      if (!needle) return true;
      return [session.accountName, session.statementName, session.tag, session.statementStart]
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
  }, [sessions, search, statusFilters, tagFilter, year, month, monthsBySession, sortKey, ascending]);

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
      {/* One filter row, matching the other list pages: search, then the
          filters, then the count. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
        <div className="relative flex items-center">
          <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search…"
            aria-label="Search reconciliation sessions"
            className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear the search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {statusOptions.length > 1 && (
          <MultiPillGroup
            options={statusOptions}
            values={statusFilters}
            onChange={setStatusFilters}
          />
        )}

        {tags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            aria-label="Filter by tag"
            className="h-6 rounded border border-border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">Any tag</option>
            {tags.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        )}

        {/* The statement's own period, not when the session was worked on —
            "the June statement" is how anyone refers to these. */}
        {years.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Period</span>
            <select
              value={year}
              onChange={(event) => setYear(event.target.value)}
              aria-label="Filter by statement year"
              className="h-6 rounded border border-border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">Any year</option>
              {years.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <select
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              aria-label="Filter by statement month"
              className="h-6 rounded border border-border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">Any month</option>
              {MONTH_LABELS.map((label, index) => (
                <option key={label} value={String(index + 1).padStart(2, "0")}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}

        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {visible.length} of {sessions.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Reconciliation sessions</caption>
          {/* Background on each cell, not on the `<thead>`: under
              `border-collapse` the latter is not painted, and the rows scroll
              through a sticky header that looks solid but is not. */}
          <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortableHeader column="account" label="Account" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th scope="col" className="border-b border-border bg-background px-3 py-2 text-left font-medium">
                Tag
              </th>
              <th scope="col" className="border-b border-border bg-background px-3 py-2 text-left font-medium">
                Statement
              </th>
              <th scope="col" className="border-b border-border bg-background px-3 py-2 text-left font-medium">
                Period
              </th>
              <SortableHeader column="rows" label="Rows" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader column="status" label="Status" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader column="created" label="Created" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader column="updated" label="Last worked on" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th scope="col" className="w-24 border-b border-border bg-background px-3 py-2" />
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
                <td className="px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                  {editingTagId === session.id ? (
                    <EditableCellInput
                      initialValue={session.tag ?? ""}
                      allowEmpty
                      trimOnCommit
                      className="h-6 w-32 rounded border border-border bg-background px-1 text-xs"
                      onDone={(value, action) => {
                        setEditingTagId(null);
                        if (action === "cancel") return;
                        const next = value.trim() || null;
                        if (next !== (session.tag ?? null)) onRetag(session, next);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingTagId(session.id)}
                      className="text-left"
                      aria-label={
                        session.tag
                          ? `Change the tag "${session.tag}"`
                          : "Add a tag to this reconciliation"
                      }
                    >
                      {session.tag ? (
                        <Badge variant="outline" className="text-[11px]">
                          {session.tag}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground hover:text-foreground">＋ Tag</span>
                      )}
                    </button>
                  )}
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
            No sessions match these filters.
          </p>
        )}
      </div>
    </div>
  );
}
