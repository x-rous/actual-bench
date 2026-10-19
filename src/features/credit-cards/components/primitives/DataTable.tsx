"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import { observeElementRect, useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortState = { key: string; direction: "asc" | "desc" };

export type Column<T> = {
  key: string;
  header: string;
  /** One-sentence definition shown as the header tooltip. */
  description?: string;
  /** Header group (for example "On the bank statement"); neighbours with the same group share a heading. */
  group?: string;
  /** Pixel width; for a `grow` column, its minimum. */
  width: number;
  /** Takes all leftover width (one per table, usually the text column such as Notes or Card). */
  grow?: boolean;
  align?: "left" | "right" | "center";
  sticky?: "start" | "end";
  /** Header text for screen readers only (icon columns). */
  hiddenHeader?: boolean;
  /** Visual header in place of the text (for example the Cleared check); the text stays the accessible name. */
  headerIcon?: ReactNode;
  cell: (row: T) => ReactNode;
  footer?: ReactNode;
  sortable?: boolean;
};

export type TableController = { focusRow: (key: string) => void };

type Props<T> = {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** The row's accessible name: visible text such as "payee · date · amount", never ids. */
  rowLabel: (row: T) => string;
  onOpen?: (row: T) => void;
  /** The row shown in a side panel; it is highlighted and keeps the tab stop. */
  activeKey?: string | null;
  rowClassName?: (row: T) => string | undefined;
  /** Screen keys such as T, Space or Y/N; return true when handled. */
  onRowKeys?: (event: KeyboardEvent<HTMLTableRowElement>, row: T) => boolean;
  /** Virtualise long tables with fixed-height rows. */
  rowHeight?: number;
  sort?: SortState | null;
  onSort?: (sort: SortState) => void;
  empty?: ReactNode;
  controller?: MutableRefObject<TableController | null>;
  /** 12 px text, for dense transaction tables. */
  compact?: boolean;
  /** 12.5 px text and 30 px rows (or the given row height), for the long transaction lists. */
  dense?: boolean | number;
  /**
   * Entity summary lists only (DESIGN §4.1): 56 px rows where a cell may stack a related, self-labelled
   * figure under its value (`Stack`). Every second line in a column is the same kind of fact.
   */
  stacked?: boolean;
  className?: string;
};

/** Header row heights, so a docked panel's header can line up with the table's (px). */
export const GROUP_ROW_HEIGHT = 24;
export const HEADER_ROW_HEIGHT = 32;

const FALLBACK_RECT = { width: 1200, height: 800 };

/** Without layout (jsdom, a hidden tab) the viewport measures 0; assume a nominal one so rows render. */
function observeViewport(instance: Virtualizer<HTMLDivElement, Element>, notify: (rect: { width: number; height: number }) => void) {
  return observeElementRect(instance, (rect) => notify(rect.height ? rect : FALLBACK_RECT));
}

const INTERACTIVE = "button, a, input, select, textarea, label, [role=menuitem], [role=checkbox], [role=radio], [role=combobox]";

/**
 * The feature's table (§9.4, UI-14): grouped headers, two-line cells, sticky first and last
 * columns, sticky footer totals and optional virtualisation. The body is one tab stop: ↑/↓,
 * Home/End and Page Up/Down move between rows, Enter opens the row. Controls inside cells are
 * reached with the screen's keys, never Tab, so value cells are text, not buttons.
 */
export function DataTable<T>(props: Props<T>) {
  const { label, columns, rows, rowKey, rowLabel, onOpen, activeKey, rowClassName, onRowKeys, rowHeight, sort, onSort, empty, controller, compact, dense = false, stacked = false, className } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const keys = rows.map(rowKey);
  const current = [focused, activeKey].find((key) => key && keys.includes(key)) ?? keys[0];
  const virtualizer = useVirtualizer({
    count: rowHeight ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight ?? 40,
    overscan: 12,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeViewport,
  });
  const virtualRows = rowHeight ? virtualizer.getVirtualItems() : [];
  const visible = rowHeight ? virtualRows.map((item) => ({ row: rows[item.index], index: item.index })) : rows.map((row, index) => ({ row, index }));
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  function focusKey(key: string) {
    const index = keys.indexOf(key);
    if (index < 0) return;
    setFocused(key);
    const node = scrollRef.current?.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"]`);
    if (node) {
      node.focus({ preventScroll: true });
      node.scrollIntoView?.({ block: "nearest" });
      return;
    }
    pending.current = key;
    if (rowHeight) virtualizer.scrollToIndex(index, { align: "auto" });
  }
  useEffect(() => {
    if (!pending.current) return;
    const node = scrollRef.current?.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(pending.current)}"]`);
    if (node) {
      node.focus({ preventScroll: true });
      pending.current = null;
    }
  });
  useEffect(() => {
    if (!controller) return;
    controller.current = { focusRow: (key) => focusKey(key) };
    return () => { controller.current = null; };
  });

  function move(event: KeyboardEvent<HTMLTableRowElement>, index: number) {
    const target = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
        : event.key === "PageDown" ? index + 10 : event.key === "PageUp" ? index - 10 : null;
    if (target === null) return false;
    focusKey(keys[Math.max(0, Math.min(rows.length - 1, target))]);
    return true;
  }
  function rowKeys(event: KeyboardEvent<HTMLTableRowElement>, row: T, index: number) {
    if (event.target !== event.currentTarget && (event.target as HTMLElement).closest("input, textarea, select")) return;
    if (move(event, index)) {
      event.preventDefault();
      return;
    }
    if (onRowKeys?.(event, row)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && onOpen) {
      event.preventDefault();
      onOpen(row);
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      // The row menu (⋯) is reached from the row, not with Tab.
      const menu = event.currentTarget.querySelector<HTMLElement>("[data-row-menu]");
      if (menu) {
        event.preventDefault();
        menu.click();
      }
    }
  }
  function click(event: MouseEvent<HTMLTableRowElement>, row: T) {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    setFocused(rowKey(row));
    onOpen?.(row);
  }

  const denseHeight = dense === true ? 30 : dense || null;
  const groups = columns.some((column) => column.group)
    ? columns.reduce<{ label: string; span: number }[]>((all, column) => {
      const last = all.at(-1);
      const name = column.group ?? "";
      if (last && last.label === name && name) last.span += 1;
      else all.push({ label: name, span: 1 });
      return all;
    }, [])
    : null;
  const width = columns.reduce((total, column) => total + column.width, 0);
  const stickyClass = (column: Column<T>) => cn(
    column.sticky === "start" && "sticky left-0 z-[1]",
    column.sticky === "end" && "sticky right-0 z-[1]",
  );
  const alignClass = (column: Column<T>) => (column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left");
  const hasFooter = columns.some((column) => column.footer !== undefined);

  return <div ref={scrollRef} className={cn("min-h-0 min-w-0 flex-1 overflow-auto", className)}>
    <table className={cn("table-fixed border-separate border-spacing-0 text-left", dense ? "text-[12.5px]" : compact ? "text-xs" : "text-[13px]")} style={{ width: "100%", minWidth: width }}
      aria-label={label}>
      <colgroup>{columns.map((column) => <col key={column.key} style={column.grow ? undefined : { width: column.width }} />)}</colgroup>
      <thead className="sticky top-0 z-[2] bg-muted">
        {groups && <tr style={{ height: GROUP_ROW_HEIGHT }}>{groups.map((group, index) => {
          const className = cn("border-b border-border bg-muted px-2 py-0 text-center text-[11px] font-medium text-muted-foreground",
            index > 0 && group.label && "border-l");
          // Ungrouped columns get an empty cell, not an empty header.
          return group.label
            ? <th key={`${group.label}-${index}`} colSpan={group.span} scope="colgroup" className={className}>{group.label}</th>
            : <td key={`blank-${index}`} colSpan={group.span} className={className} />;
        })}</tr>}
        <tr style={{ height: HEADER_ROW_HEIGHT }}>{columns.map((column, index) => {
          const sorted = sort?.key === column.key ? sort.direction : null;
          const previous = columns[index - 1];
          return <th
            key={column.key}
            scope="col"
            title={column.description}
            aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : column.sortable ? "none" : undefined}
            className={cn(
              "border-b border-border bg-muted px-2 py-0 text-xs font-medium whitespace-nowrap text-muted-foreground",
              alignClass(column),
              stickyClass(column),
              groups && column.group && previous?.group !== column.group && index > 0 && "border-l",
            )}
          >
            {column.sortable && onSort
              ? <button
                type="button"
                tabIndex={-1}
                className={cn("inline-flex items-center gap-1 hover:text-foreground", column.align === "right" && "flex-row-reverse")}
                onClick={() => onSort({ key: column.key, direction: sorted === "desc" ? "asc" : "desc" })}
              >
                {column.headerIcon ?? <span className={column.hiddenHeader ? "sr-only" : undefined}>{column.header}</span>}
                {sorted === "asc" ? <ArrowUp className="size-3" aria-hidden /> : sorted === "desc" ? <ArrowDown className="size-3" aria-hidden /> : null}
              </button>
              : column.headerIcon ?? <span className={column.hiddenHeader ? "sr-only" : undefined}>{column.header}</span>}
          </th>;
        })}</tr>
      </thead>
      <tbody>
        {paddingTop > 0 && <tr aria-hidden><td colSpan={columns.length} style={{ height: paddingTop, padding: 0 }} /></tr>}
        {visible.map(({ row, index }) => {
          const key = rowKey(row);
          const active = key === activeKey;
          return <tr
            key={key}
            data-row-key={key}
            tabIndex={key === current ? 0 : -1}
            aria-label={rowLabel(row)}
            aria-selected={activeKey !== undefined ? active : undefined}
            onFocus={(event) => { if (event.target === event.currentTarget) setFocused(key); }}
            onKeyDown={(event) => rowKeys(event, row, index)}
            onClick={(event) => click(event, row)}
            style={rowHeight ? { height: rowHeight } : undefined}
            className={cn(
              "group/row outline-none focus-visible:bg-muted/40 focus-visible:[&>td:first-child]:shadow-[inset_2px_0_0_var(--ring)]",
              onOpen && "cursor-pointer",
              active ? "bg-blue-50/70 dark:bg-blue-950/30 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-blue-600)]" : "hover:bg-muted/30",
              rowClassName?.(row),
            )}
          >{columns.map((column) => <td
            key={column.key}
            className={cn(
              "border-b border-border/70 bg-inherit px-2 align-middle tabular-nums",
              stacked ? "h-14 py-1.5 whitespace-nowrap" : dense ? "py-0 whitespace-nowrap" : "h-9 py-1 whitespace-nowrap",
              alignClass(column),
              stickyClass(column),
              column.sticky && (active ? "bg-blue-50 dark:bg-blue-950" : "bg-background group-hover/row:bg-muted"),
            )}
            style={denseHeight ? { height: denseHeight } : undefined}
          >{column.cell(row)}</td>)}</tr>;
        })}
        {paddingBottom > 0 && <tr aria-hidden><td colSpan={columns.length} style={{ height: paddingBottom, padding: 0 }} /></tr>}
      </tbody>
      {hasFooter && rows.length > 0 && <tfoot className="sticky bottom-0 z-[2]">
        <tr>{columns.map((column) => <td
          key={column.key}
          className={cn("border-t border-border bg-muted px-2 py-1.5 text-xs font-medium tabular-nums", alignClass(column), stickyClass(column))}
        >{column.footer}</td>)}</tr>
      </tfoot>}
    </table>
    {!rows.length && <div className="p-4 text-sm text-muted-foreground">{empty ?? "Nothing to show."}</div>}
  </div>;
}

/**
 * One-line cell text (DESIGN §4.1): truncated text stays recoverable through its tooltip. Transaction tables never
 * use second lines; secondary facts get their own column or live in the row's panel.
 */
export function Text({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  const text = title ?? (typeof children === "string" || typeof children === "number" ? String(children) : undefined);
  return <span title={text} className={cn("block truncate", className)}>{children}</span>;
}

const HASHTAG = /(#[\p{L}\p{N}_-]+)/u;

/** A notes cell: one truncated line with every #tag (plan, card and month tags) in blue; the full notes as the tooltip. */
export function Notes({ notes }: { notes: string | null | undefined }) {
  if (!notes) return <Text className="text-muted-foreground">-</Text>;
  return <Text title={notes} className="text-muted-foreground">
    {notes.split(HASHTAG).map((part, index) => (index % 2 ? <span key={index} className="text-blue-700 dark:text-blue-400">{part}</span> : part))}
  </Text>;
}

/** A two-line cell for `stacked` tables: the value, then a muted, self-labelled related figure. */
export function Stack({ primary, secondary, strong = false, title }: { primary: ReactNode; secondary?: ReactNode; strong?: boolean; title?: string }) {
  return <div className="min-w-0" title={title}>
    <div className={cn("truncate leading-5", strong && "font-semibold")}>{primary}</div>
    <div className="truncate text-xs leading-4 text-muted-foreground">{secondary ?? "\u00a0"}</div>
  </div>;
}
