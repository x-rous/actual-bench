"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditableCellInput } from "@/components/ui/editable-cell";
import { MultiPillGroup } from "@/components/ui/pill-group";
import { cn } from "@/lib/utils";
import { formatDateLabel } from "../lib/pdfReviewTable";
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

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `24 Feb 2025, 09:15`.
 *
 * The year is always there rather than only on dates outside this one. A
 * column where some rows carry a year and some do not is read as ragged before
 * it is read as a shorthand, and the reader who has just filtered by year is
 * the one most likely to want it confirmed on the row.
 *
 * Written the same way for everyone rather than left to the browser's locale,
 * which is how the rest of this feature states a date, and how a reader
 * comparing this list against a statement expects to read one.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = String(date.getDate()).padStart(2, "0");
  const month = MONTH_NAMES[date.getMonth()];
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${day} ${month} ${date.getFullYear()}, ${time}`;
}

function periodOf(session: ReconciliationSessionRecord): string {
  if (!session.statementStart || !session.statementEnd) return "-";
  return `${formatDateLabel(session.statementStart)} → ${formatDateLabel(session.statementEnd)}`;
}

function accountNameOf(session: ReconciliationSessionRecord): string {
  return session.accountName ?? "Unnamed account";
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
  className,
}: {
  column: SortKey;
  label: string;
  sortKey: SortKey;
  ascending: boolean;
  onSort: (column: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === column;
  return (
    <th
      scope="col"
      className={cn("border-b border-border bg-background px-3 py-2 text-left font-medium", className)}
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground",
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
  const [accountFilter, setAccountFilter] = useState("all");
  const [accountExpansion, setAccountExpansion] = useState<Record<string, boolean>>({});
  /*
    Grouping is off by default because most accounts have one session: a
    heading over a single row doubles the height of the table and indents the
    data under a line that says nothing the row does not. It earns its place
    when an account has several and the rows under one heading are a set worth
    reading together, so it stays available rather than removed.
  */
  const [groupByAccount, setGroupByAccount] = useState(false);
  const [year, setYear] = useState(() => {
    const thisYear = String(new Date().getFullYear());
    // Read through monthsCovered, the same way the filter itself matches: a
    // cycle running December to January belongs to both years, and starting
    // on a year that hides it would be the filter disagreeing with itself.
    return sessions.some((session) => monthsCovered(session).some((entry) => entry.startsWith(thisYear)))
      ? thisYear
      : "all";
  });
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

  const accounts = useMemo(() => {
    const byId = new Map<string, string>();
    for (const session of sessions) {
      if (!byId.has(session.accountId)) byId.set(session.accountId, accountNameOf(session));
    }
    return [...byId]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions]);

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
    accountFilter !== "all" ||
    year !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilters([]);
    setTagFilter("all");
    setAccountFilter("all");
    setYear("all");
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const selectedStatuses = new Set(statusFilters);
    const filtered = sessions.filter((session) => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(session.status)) return false;
      if (tagFilter !== "all" && (session.tag ?? "") !== tagFilter) return false;
      if (accountFilter !== "all" && session.accountId !== accountFilter) return false;

      if (year !== "all") {
        const months = monthsBySession.get(session.id) ?? [];
        if (!months.some((entry) => entry.slice(0, 4) === year)) return false;
      }

      if (!needle) return true;
      return [session.accountName, session.statementName, session.tag, session.statementStart]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    return filtered;
  }, [sessions, search, statusFilters, tagFilter, accountFilter, year, monthsBySession]);

  const accountGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { accountId: string; accountName: string; sessions: ReconciliationSessionRecord[] }
    >();
    // Ungrouped, every session sits in one unnamed group, so the table below
    // renders one way and the sort applies to the whole list rather than
    // inside each account.
    if (!groupByAccount) {
      grouped.set("", { accountId: "", accountName: "", sessions: [...visible] });
    }
    for (const session of groupByAccount ? visible : []) {
      const group = grouped.get(session.accountId) ?? {
        accountId: session.accountId,
        accountName: accountNameOf(session),
        sessions: [],
      };
      group.sessions.push(session);
      grouped.set(session.accountId, group);
    }

    const direction = ascending ? 1 : -1;
    const compareSessions = (a: ReconciliationSessionRecord, b: ReconciliationSessionRecord) => {
      switch (sortKey) {
        case "status":
          return direction * a.status.localeCompare(b.status);
        case "rows":
          return direction * ((rowCountOf(a) ?? 0) - (rowCountOf(b) ?? 0));
        case "created":
          return direction * a.createdAt.localeCompare(b.createdAt);
        default:
          return direction * a.updatedAt.localeCompare(b.updatedAt);
      }
    };

    const groups = [...grouped.values()];
    groups.sort((a, b) => {
      const order = a.accountName.localeCompare(b.accountName);
      return sortKey === "account" ? direction * order : order;
    });
    for (const group of groups) {
      group.sessions.sort(
        sortKey === "account"
          ? (a, b) => direction * (a.accountName ?? "").localeCompare(b.accountName ?? "")
            || b.updatedAt.localeCompare(a.updatedAt)
          : compareSessions
      );
    }
    return groups.map((group) => ({
      ...group,
      needsAttention: group.sessions.filter((session) => session.status !== "completed").length,
    }));
  }, [visible, sortKey, ascending, groupByAccount]);

  const filterContext = [
    search.trim().toLowerCase(),
    [...statusFilters].sort().join(","),
    tagFilter,
    accountFilter,
    year,
  ].join("\u0000");

  function expansionKey(accountId: string): string {
    return JSON.stringify([filterContext, accountId]);
  }

  function groupIsExpanded(group: (typeof accountGroups)[number]): boolean {
    return (
      accountExpansion[expansionKey(group.accountId)] ??
      (filtersActive || group.needsAttention > 0)
    );
  }

  function setGroupExpanded(accountId: string, expanded: boolean) {
    const key = expansionKey(accountId);
    setAccountExpansion((previous) => ({ ...previous, [key]: expanded }));
  }

  const allGroupsCollapsed =
    accountGroups.length > 0 && accountGroups.every((group) => !groupIsExpanded(group));

  function toggleAllGroups() {
    const expanded = allGroupsCollapsed;
    setAccountExpansion((previous) => {
      const next = { ...previous };
      for (const group of accountGroups) next[expansionKey(group.accountId)] = expanded;
      return next;
    });
  }

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

        {accounts.length > 0 && (
          <select
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            aria-label="Filter by account"
            className="h-6 max-w-56 rounded border border-border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">Any account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
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
          </div>
        )}

        <Button
          size="xs"
          variant={groupByAccount ? "secondary" : "ghost"}
          aria-pressed={groupByAccount}
          onClick={() => setGroupByAccount((current) => !current)}
        >
          <Users />
          Group by account
        </Button>

        {groupByAccount && accountGroups.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            onClick={toggleAllGroups}
            aria-label={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
          >
            {allGroupsCollapsed ? (
              <>
                <ChevronsUpDown />
                Expand All
              </>
            ) : (
              <>
                <ChevronsDownUp />
                Collapse All
              </>
            )}
          </Button>
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
              {/* The account and the statement are read; the rest are
                  glanced at, so they take only what their values need. */}
              {/* Under a grouping heading the account cell is empty, so it
                  gives its width back to the statement rather than holding a
                  column of blanks. */}
              <SortableHeader className={groupByAccount ? "w-0" : "w-[22%]"} column="account" label="Account" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th scope="col" className="w-28 border-b border-border bg-background px-3 py-2 text-left font-medium">
                Tag
              </th>
              <th scope="col" className={cn("border-b border-border bg-background px-3 py-2 text-left font-medium", groupByAccount ? "w-[48%]" : "w-[26%]")}>
                Statement
              </th>
              <th scope="col" className="w-52 border-b border-border bg-background px-3 py-2 text-left font-medium">
                Period
              </th>
              <SortableHeader className="w-20 text-right" column="rows" label="Rows" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader className="w-28" column="status" label="Status" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              {/* Wide enough for `24 Feb 2025, 09:15` and for the heading over it:
                  under-measured, "Last worked on" wrapped to two lines and took
                  the whole header row's height with it. */}
              <SortableHeader className="w-36" column="created" label="Created" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <SortableHeader className="w-44" column="updated" label="Last worked on" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th scope="col" className="w-16 border-b border-border bg-background px-3 py-2" />
            </tr>
          </thead>
          {accountGroups.map((group) => {
            const expanded = !groupByAccount || groupIsExpanded(group);
            return (
              <tbody key={group.accountId}>
                {groupByAccount && (
                <tr className="border-y border-border bg-muted/50">
                  <th scope="rowgroup" colSpan={9} className="p-0 text-left">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={
                        (expanded ? "Collapse " : "Expand ") + group.accountName + " sessions"
                      }
                      onClick={() => setGroupExpanded(group.accountId, !expanded)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-medium outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      {/* The account, and nothing else. A count of sessions
                          and a count of those needing attention restated what
                          the rows underneath already say, twice per heading,
                          and a table is read by scanning down one column - a
                          second sentence on every heading row is what stops
                          that scan. */}
                      <span>{group.accountName}</span>
                    </button>
                  </th>
                </tr>
                )}
                {expanded &&
                  group.sessions.map((session) => (
              <tr
                key={session.id}
                className="cursor-pointer border-b border-border/30 hover:bg-accent/40"
                onClick={() => onOpen(session)}
              >
                {/* Empty under a group heading, which already names the
                    account for every row beneath it. */}
                {groupByAccount ? (
                  <td className="p-0" />
                ) : (
                  <td className="max-w-0 truncate px-3 py-0.5 font-medium" title={accountNameOf(session)}>
                    {accountNameOf(session)}
                  </td>
                )}
                <td className="px-3 py-0.5" onClick={(event) => event.stopPropagation()}>
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
                {/* The format leads, so a column of mixed statements can be
                    read down its left edge rather than by reading each name
                    to its extension - which a truncated name loses anyway. */}
                {/*
                  The statement is the way in from the keyboard: a `tr` takes
                  no focus and Enter does nothing on one, and this is the cell
                  that names what would open. Clicking the row still works.
                */}
                <td
                  className="max-w-0 px-3 py-0.5 text-muted-foreground"
                  title={[session.statementFormat?.toUpperCase(), session.statementName].filter(Boolean).join(" · ") || undefined}
                >
                  <button
                    type="button"
                    aria-label={`Open the reconciliation for ${accountNameOf(session)} of ${session.statementName ?? "no statement yet"}`}
                    className="flex min-w-0 max-w-full items-center gap-1.5 rounded text-left hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(session);
                    }}
                  >
                    {session.statementFormat && (
                      <Badge variant="outline" className="shrink-0 px-1 text-[10px] tracking-wide uppercase">
                        {session.statementFormat}
                      </Badge>
                    )}
                    <span className="truncate">{session.statementName ?? "-"}</span>
                  </button>
                </td>
                <td
                  className="whitespace-nowrap px-3 py-0.5 text-muted-foreground"
                  title={periodOf(session)}
                >
                  {/* Two equal tracks around the arrow, so the arrow lands at
                      the same x on every row. Left to flow, "05 May" and
                      "12 August" put it in a different place each time and a
                      column meant to be read down became a zigzag. */}
                  {session.statementStart && session.statementEnd ? (
                    <span className="flex items-center gap-1 tabular-nums">
                      <span className="flex-1 text-right">{formatDateLabel(session.statementStart)}</span>
                      <span aria-hidden="true">→</span>
                      <span className="flex-1">{formatDateLabel(session.statementEnd)}</span>
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-0.5 text-right tabular-nums">{rowCountOf(session) ?? "-"}</td>
                <td className="px-3 py-0.5">
                  <Badge variant="outline" className={cn("text-[11px]", statusTone(session.status))}>
                    {STATUS_LABELS[session.status] ?? session.status}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-0.5 text-muted-foreground">
                  {formatTimestamp(session.createdAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-0.5 text-muted-foreground">
                  {formatTimestamp(session.updatedAt)}
                </td>
                <td className="px-3 py-0.5" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label={`Delete the reconciliation for ${session.accountName ?? "this account"} created ${formatTimestamp(session.createdAt)}`}
                      onClick={() => onDelete(session)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6" onClick={() => onOpen(session)}>
                      {session.status === "completed" ? "View" : "Open"}
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
                  ))}
              </tbody>
            );
          })}
        </table>

        {visible.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">No sessions match these filters.</p>
            {/* The filter bar's own control, not a second one beside it: two
                buttons that clear the same filters are two things to keep in
                step for one thing to do. */}
            {filtersActive && (
              <Button className="mt-2" size="xs" variant="outline" onClick={clearFilters}>
                Show all sessions
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
