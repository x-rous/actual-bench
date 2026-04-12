"use client";

import { useState } from "react";
import { Star, Trash2, Copy, Play, Pencil, CopyPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SavedQuery, QueryHistoryEntry } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function copyQuery(query: string) {
  navigator.clipboard
    .writeText(query)
    .then(() => toast.success("Query JSON copied"))
    .catch(() => toast.error("Failed to copy"));
}

function formatExecTime(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Derives a short human-readable operation label from a raw ActualQL JSON string.
 * Priority: calculate > groupBy > filter > limit > table name only.
 *
 * Examples:
 *   "transactions · calculate"
 *   "transactions · grouped by payee"
 *   "transactions · filtered"
 *   "transactions · limit 20"
 *   "payees"
 */
function deriveOperationLabel(query: string): string {
  try {
    const parsed = JSON.parse(query) as Record<string, unknown>;
    // Accept both the wrapped { ActualQLquery: {...} } format and bare query objects.
    const inner = (parsed.ActualQLquery ?? parsed) as Record<string, unknown>;
    if (!inner || typeof inner.table !== "string") return "query";

    const table = inner.table;

    if (inner.calculate) {
      return `${table} · calculate`;
    }

    if (Array.isArray(inner.groupBy) && inner.groupBy.length > 0) {
      // Take the first entry that has no dot (the ID field, not the name path).
      const field =
        (inner.groupBy as string[]).find((f) => !f.includes(".")) ??
        String(inner.groupBy[0]).split(".")[0];
      return `${table} · grouped by ${field}`;
    }

    if (
      inner.filter &&
      typeof inner.filter === "object" &&
      Object.keys(inner.filter).length > 0
    ) {
      return `${table} · filtered`;
    }

    if (typeof inner.limit === "number") {
      return `${table} · limit ${inner.limit}`;
    }

    return table;
  } catch {
    return "query";
  }
}

// ─── Shared icon button ───────────────────────────────────────────────────────

export function ActionButton({
  title,
  onClick,
  children,
  className,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        "rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

// ─── Sub-section label (used within Saved tab for Favorites vs. All) ──────────

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-3 mb-0.5 mt-3 border-t border-border pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 first:mt-1 first:border-0 first:pt-0">
      {children}
    </div>
  );
}

// ─── History item ─────────────────────────────────────────────────────────────

function HistoryItem({
  entry,
  onLoad,
  onRun,
}: {
  entry: QueryHistoryEntry;
  onLoad: () => void;
  onRun: () => void;
}) {
  const label = deriveOperationLabel(entry.query);

  // Build the metadata line: "47 rows · 142ms" (only fields that exist)
  const metaParts: string[] = [];
  if (entry.rowCount !== undefined) {
    metaParts.push(`${entry.rowCount} row${entry.rowCount !== 1 ? "s" : ""}`);
  }
  if (entry.execTime !== undefined) {
    metaParts.push(formatExecTime(entry.execTime));
  }
  const metaLine = metaParts.join(" · ");

  return (
    <div
      className={cn(
        "group flex items-start gap-1 border-l-2 border-transparent px-2 py-1.5 transition-colors",
        "hover:border-primary/40 hover:bg-accent/60"
      )}
    >
      <button
        type="button"
        onClick={onLoad}
        title={entry.query}
        className="min-w-0 flex-1 text-left"
      >
        {/* Primary line: operation label + timestamp */}
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-mono text-[11px] leading-snug text-foreground/90">
            {label}
          </span>
          <span className="shrink-0 font-sans text-[10px] text-muted-foreground/50">
            {formatTime(entry.executedAt)}
          </span>
        </div>
        {/* Secondary line: row count + exec time */}
        {metaLine && (
          <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground/60">
            {metaLine}
          </div>
        )}
      </button>
      <div className="flex shrink-0 items-center opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
        <ActionButton title="Load and run" onClick={onRun}>
          <Play className="h-3 w-3" />
        </ActionButton>
        <ActionButton title="Copy query JSON" onClick={() => copyQuery(entry.query)}>
          <Copy className="h-3 w-3" />
        </ActionButton>
      </div>
    </div>
  );
}

// ─── Saved query item ─────────────────────────────────────────────────────────

function SavedItem({
  query,
  onLoad,
  onRun,
  onDelete,
  onToggleFavorite,
  onRename,
  onDuplicate,
}: {
  query: SavedQuery;
  onLoad: () => void;
  onRun: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(query.name);

  function submitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== query.name) {
      onRename(trimmed);
    } else {
      setRenameValue(query.name);
    }
    setIsRenaming(false);
  }

  function startRename(e: React.MouseEvent) {
    e.stopPropagation();
    setRenameValue(query.name);
    setIsRenaming(true);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 border-l-2 border-transparent px-2 py-1.5 transition-colors",
        "hover:border-primary/40 hover:bg-accent/60"
      )}
      onMouseLeave={() => {
        if (isRenaming) submitRename();
      }}
    >
      {isRenaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submitRename(); }
            if (e.key === "Escape") {
              setRenameValue(query.name);
              setIsRenaming(false);
            }
          }}
          className="flex-1 min-w-0 rounded border border-input bg-transparent px-1 py-px font-sans text-[11px] text-foreground outline-none focus:border-ring"
        />
      ) : (
        <button
          type="button"
          onClick={onLoad}
          title={query.name}
          className="flex-1 truncate text-left text-[11px] leading-relaxed text-foreground/90"
        >
          {query.name}
        </button>
      )}

      {!isRenaming && (
        <div className="flex shrink-0 items-center opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
          <ActionButton title="Load and run" onClick={onRun}>
            <Play className="h-3 w-3" />
          </ActionButton>
          <ActionButton
            title={query.isFavorite ? "Unpin favorite" : "Pin as favorite"}
            onClick={onToggleFavorite}
            className={query.isFavorite ? "text-amber-500" : undefined}
          >
            <Star
              className="h-3 w-3"
              fill={query.isFavorite ? "currentColor" : "none"}
            />
          </ActionButton>
          <ActionButton title="Rename" onClick={startRename}>
            <Pencil className="h-3 w-3" />
          </ActionButton>
          <ActionButton title="Duplicate" onClick={onDuplicate}>
            <CopyPlus className="h-3 w-3" />
          </ActionButton>
          <ActionButton title="Copy query JSON" onClick={() => copyQuery(query.query)}>
            <Copy className="h-3 w-3" />
          </ActionButton>
          <ActionButton
            title="Delete"
            onClick={onDelete}
            className="hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </ActionButton>
        </div>
      )}
    </div>
  );
}

// ─── HistoryPanel ─────────────────────────────────────────────────────────────

interface HistoryPanelProps {
  history: QueryHistoryEntry[];
  onLoad: (query: string) => void;
  onLoadAndRun: (query: string) => void;
}

export function HistoryPanel({ history, onLoad, onLoadAndRun }: HistoryPanelProps) {
  if (history.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground/60">
        No history yet. Run a query to see it here.
      </div>
    );
  }

  return (
    <div className="flex flex-col text-xs">
      {history.map((entry) => (
        <HistoryItem
          key={entry.id}
          entry={entry}
          onLoad={() => onLoad(entry.query)}
          onRun={() => onLoadAndRun(entry.query)}
        />
      ))}
    </div>
  );
}

// ─── SavedPanel ───────────────────────────────────────────────────────────────

interface SavedPanelProps {
  savedQueries: SavedQuery[];
  onLoad: (query: string) => void;
  onLoadAndRun: (query: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
}

export function SavedPanel({
  savedQueries,
  onLoad,
  onLoadAndRun,
  onDelete,
  onToggleFavorite,
  onRename,
  onDuplicate,
}: SavedPanelProps) {
  const favorites = savedQueries.filter((q) => q.isFavorite);
  const regular = savedQueries.filter((q) => !q.isFavorite);

  if (savedQueries.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground/60">
        No saved queries yet. Run a query and click Save.
      </div>
    );
  }

  function renderItem(q: SavedQuery) {
    return (
      <SavedItem
        key={q.id}
        query={q}
        onLoad={() => onLoad(q.query)}
        onRun={() => onLoadAndRun(q.query)}
        onDelete={() => onDelete(q.id)}
        onToggleFavorite={() => onToggleFavorite(q.id)}
        onRename={(name) => onRename(q.id, name)}
        onDuplicate={() => onDuplicate(q.id)}
      />
    );
  }

  return (
    <div className="flex flex-col text-xs">
      {favorites.length > 0 && (
        <>
          <SubLabel>Favorites</SubLabel>
          {favorites.map(renderItem)}
        </>
      )}
      {regular.length > 0 && (
        <>
          {favorites.length > 0 && <SubLabel>All saved</SubLabel>}
          {regular.map(renderItem)}
        </>
      )}
    </div>
  );
}

