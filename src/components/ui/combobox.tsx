"use client";

import { useState, useEffect, useId, useRef } from "react";
import { Search, Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── useComboboxState ─────────────────────────────────────────────────────────

export type ComboboxStateResult = {
  open: boolean;
  openDropdown: () => void;
  closeDropdown: () => void;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

export function useComboboxState(): ComboboxStateResult {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function openDropdown() {
    setSearch("");
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closeDropdown() {
    setOpen(false);
  }

  return { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComboboxOption = { id: string; name: string; isGroupHeader?: true; hidden?: boolean };

/**
 * Filters a grouped options list (containing group headers + selectable items)
 * against a search term:
 * - A match on a group name includes all its children.
 * - A match on an option name includes that option (plus its nearest preceding group header).
 * - Groups with no matching children are hidden.
 * - If search is empty, returns the full list unchanged.
 */
export function filterGroupedOptions(
  options: ComboboxOption[],
  search: string,
  /**
   * Whether a group is itself selectable.
   *
   * It changes what a match on a group name should return. Where a group is
   * only a heading, matching it has to bring its children along or the search
   * yields a label with nothing under it to pick. Where the group *is* a
   * choice, the children are redundant: selecting the group already stands for
   * all of them, and listing eleven categories under a group the user just
   * searched for buries the row they were looking for.
   */
  groupsAreSelectable = false
): ComboboxOption[] {
  const term = search.trim().toLowerCase();
  if (!term) return options;

  const result: ComboboxOption[] = [];
  let groupMatches = false;
  let pendingGroup: ComboboxOption | null = null;

  for (const opt of options) {
    if (opt.isGroupHeader) {
      groupMatches = opt.name.toLowerCase().includes(term);
      pendingGroup = opt;
      // A selectable group that matched is a result in its own right, so it is
      // emitted now rather than waiting on a child to carry it in.
      if (groupMatches && groupsAreSelectable) {
        result.push(opt);
        pendingGroup = null;
      }
      continue;
    }
    if (groupMatches && !groupsAreSelectable) {
      // Group name matched — include all children
      if (pendingGroup) { result.push(pendingGroup); pendingGroup = null; }
      result.push(opt);
    } else if (opt.name.toLowerCase().includes(term)) {
      // Child matched — include it with its nearest group header
      if (pendingGroup) { result.push(pendingGroup); pendingGroup = null; }
      result.push(opt);
    }
  }

  return result;
}

// ─── SearchableCombobox (single-select) ───────────────────────────────────────

export function SearchableCombobox({
  options,
  value,
  onChange,
  placeholder = "- select -",
  footer,
  triggerClassName,
  ariaLabel,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  footer?: (search: string) => React.ReactNode;
  triggerClassName?: string;
  /**
   * Names the control where no visible `<label>` can point at it — the trigger
   * is a button, so `htmlFor` has nothing to bind to and the accessible name
   * would otherwise be whichever option happens to be selected.
   */
  ariaLabel?: string;
}) {
  const { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef } =
    useComboboxState();

  const selectedLabel = options.find((o) => !o.isGroupHeader && o.id === value)?.name ?? "";
  const filtered = filterGroupedOptions(options, search);

  /*
   * Everything the arrow keys can land on, in the order it is drawn. Group
   * headers are labels rather than choices, so they are skipped — pressing Down
   * should always move to something selectable, never park on a heading.
   *
   * The empty id is the "- none -" row, which is a real choice: it clears the
   * field.
   */
  const navigable = ["", ...filtered.filter((o) => !o.isGroupHeader).map((o) => o.id)];
  const indexOf = new Map(navigable.map((id, index) => [id, index]));

  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  // Ties the highlighted row to the input, so assistive technology announces
  // what the arrow keys are moving over instead of silence.
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  /** Keeps the highlighted row on screen as it moves past the visible window. */
  function moveTo(index: number) {
    setActiveIndex(index);
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // A search that matches nothing leaves nothing to walk: moving would set an
    // index no option has, and point `aria-activedescendant` at an id that is
    // not on the page.
    if (navigable.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(activeIndex >= navigable.length - 1 ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(activeIndex <= 0 ? navigable.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const id = navigable[activeIndex];
      if (id !== undefined) select(id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
    }
  }

  function select(id: string) {
    onChange(id);
    closeDropdown();
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => {
          if (open) {
            closeDropdown();
          } else {
            // Start on the selected option, so Down moves on from where the
            // user already is rather than from the top of the list.
            setActiveIndex(indexOf.get(value) ?? 0);
            openDropdown();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50",
          !selectedLabel && "text-muted-foreground",
          triggerClassName
        )}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[180px] rounded-md border border-border bg-popover shadow-md">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // The list underneath just changed, so the old highlight no
                // longer refers to the same row.
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search…"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={navigable[activeIndex] === undefined ? undefined : optionId(activeIndex)}
              aria-label="Search options"
              className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                id={optionId(0)}
                role="option"
                aria-selected={value === ""}
                data-index={0}
                onClick={() => select("")}
                onMouseEnter={() => setActiveIndex(0)}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  activeIndex === 0 && "bg-accent text-accent-foreground"
                )}
              >
                <Check className={cn("h-3 w-3 shrink-0", value === "" ? "opacity-100" : "opacity-0")} />
                - none -
              </button>
            </li>
            {filtered.filter((o) => !o.isGroupHeader).length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground italic">No results</li>
            ) : (
              filtered.map((o) =>
                o.isGroupHeader ? (
                  <li
                    key={`group-${o.id}`}
                    className={cn(
                      "px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide select-none pointer-events-none",
                      o.hidden ? "text-muted-foreground/60" : "text-muted-foreground"
                    )}
                  >
                    {o.name}
                  </li>
                ) : (
                  <li key={o.id}>
                    <button
                      type="button"
                      data-index={indexOf.get(o.id)}
                      id={optionId(indexOf.get(o.id) ?? 0)}
                      role="option"
                      aria-selected={value === o.id}
                      onClick={() => select(o.id)}
                      onMouseEnter={() => setActiveIndex(indexOf.get(o.id) ?? 0)}
                      className={cn(
                        "flex w-full items-center gap-2 pl-4 pr-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground",
                        o.hidden ? "text-foreground/60" : "text-foreground",
                        activeIndex === indexOf.get(o.id) && "bg-accent text-accent-foreground"
                      )}
                    >
                      <Check
                        className={cn("h-3 w-3 shrink-0", value === o.id ? "opacity-100" : "opacity-0")}
                      />
                      <span className="truncate">{o.name}</span>
                    </button>
                  </li>
                )
              )
            )}
          </ul>
          {footer && (
            <div className="border-t border-border">
              {footer(search)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MultiSearchableCombobox (multi-select) ───────────────────────────────────

export function MultiSearchableCombobox({
  options,
  values,
  onChange,
  placeholder = "- select -",
  triggerClassName,
  selectableGroups = false,
  ariaLabel,
  summary,
  coveredIds,
  exclusiveIds,
  onClear,
}: {
  options: ComboboxOption[];
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  triggerClassName?: string;
  /**
   * Makes the group headings choices in their own right, so picking one stands
   * for everything beneath it.
   *
   * Off by default, which is what a rule wants: there a group is a heading that
   * organises the categories you may pick, and clicking it should do nothing.
   * A report asking "how much went to Food and Transport" wants the opposite -
   * the group *is* the unit, and ticking its eleven categories one at a time to
   * say so would be the interface getting in the way. The caller decides what a
   * selected group expands to; this only makes the row selectable.
   */
  selectableGroups?: boolean;
  /**
   * Names the control where no visible `<label>` can point at it - the trigger
   * is a button, so `htmlFor` has nothing to bind to.
   */
  ariaLabel?: string;
  /**
   * Replaces the chips in the trigger with a single line of text.
   *
   * Chips do two jobs - say what is selected, and let you remove it - and only
   * the second needs a target per item, so bundling them makes the control grow
   * a row per selection. Hand it a summary and the trigger stops growing; the
   * removing moves to the panel below, which scrolls.
   */
  summary?: React.ReactNode;
  /**
   * Ids that are already included by something else selected - a category whose
   * whole group is picked, say.
   *
   * They render ticked but inert. The alternative was leaving them as they
   * were: an empty box on a row whose transactions were fully counted, which
   * clicking neither added to nor removed from. A box that cannot be clicked is
   * a smaller surprise than one that lies about what it means.
   */
  coveredIds?: ReadonlySet<string>;
  /**
   * Ids that stand for everything and so cannot be combined with anything.
   *
   * They render without a checkbox, because a checkbox invites exactly the
   * combination they rule out - "all of them, plus these two" is not a
   * selection anyone can mean. Clicking one replaces the selection and closes
   * the list: it is an answer, not a toggle.
   */
  exclusiveIds?: ReadonlySet<string>;
  /**
   * Empties the selection from the trigger. Only rendered when something is
   * selected - without the chips there is otherwise nothing left to clear from.
   */
  onClear?: () => void;
}) {
  const { open, openDropdown, closeDropdown, search, setSearch, containerRef, searchRef } =
    useComboboxState();

  const filtered = filterGroupedOptions(options, search, selectableGroups);

  const selectedOptions = options.filter(
    (o) => (selectableGroups || !o.isGroupHeader) && values.includes(o.id)
  );

  // Same arrow-key walk as the single-select, minus the "- none -" row: with
  // several selections, clearing is what the chips' own buttons are for.
  const isCovered = (id: string) => coveredIds?.has(id) ?? false;
  const isExclusive = (id: string) => exclusiveIds?.has(id) ?? false;
  const navigable = filtered
    .filter((o) => (selectableGroups || !o.isGroupHeader) && !isCovered(o.id))
    .map((o) => o.id);
  const indexOf = new Map(navigable.map((id, index) => [id, index]));

  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  function moveTo(index: number) {
    setActiveIndex(index);
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // A search that matches nothing leaves nothing to walk: moving would set an
    // index no option has, and point `aria-activedescendant` at an id that is
    // not on the page.
    if (navigable.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(activeIndex >= navigable.length - 1 ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(activeIndex <= 0 ? navigable.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter") {
      // Toggling rather than closing: picking several in a row is the whole
      // point of a multi-select.
      event.preventDefault();
      const id = navigable[activeIndex];
      if (id !== undefined) toggle(id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
    }
  }

  function toggle(id: string) {
    if (isCovered(id)) return;
    if (isExclusive(id)) {
      onChange([id]);
      closeDropdown();
      return;
    }
    // Anything else being picked ends an exclusive selection, since the two
    // cannot both be true.
    const kept = values.filter((v) => !isExclusive(v));
    onChange(kept.includes(id) ? kept.filter((v) => v !== id) : [...kept, id]);
  }

  function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(values.filter((v) => v !== id));
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={(e) => e.key === "Enter" && (open ? closeDropdown() : openDropdown())}
        className={cn(
          "flex min-h-8 w-full cursor-pointer flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50",
          triggerClassName
        )}
      >
        {selectedOptions.length === 0 ? (
          <span className="truncate text-muted-foreground">{placeholder}</span>
        ) : summary !== undefined ? (
          <span className="truncate font-medium text-foreground">{summary}</span>
        ) : (
          selectedOptions.map((o) => (
            <span
              key={o.id}
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-accent-foreground"
            >
              {o.name}
              <button
                type="button"
                onClick={(e) => remove(o.id, e)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {onClear && selectedOptions.length > 0 && (
            <button
              type="button"
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="rounded text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </span>
      </div>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[180px] rounded-md border border-border bg-popover shadow-md">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // The list underneath just changed, so the old highlight no
                // longer refers to the same row.
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search…"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={navigable[activeIndex] === undefined ? undefined : optionId(activeIndex)}
              aria-label="Search options"
              className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable
            className="max-h-72 overflow-y-auto py-1"
          >
            {navigable.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground italic">No results</li>
            ) : (
              filtered.map((o) =>
                o.isGroupHeader && !selectableGroups ? (
                  <li
                    key={`group-${o.id}`}
                    className={cn(
                      "px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide select-none pointer-events-none",
                      o.hidden ? "text-muted-foreground/60" : "text-muted-foreground"
                    )}
                  >
                    {o.name}
                  </li>
                ) : (
                  <li key={`${o.isGroupHeader ? "group" : "item"}-${o.id}`}>
                    <button
                      type="button"
                      data-index={indexOf.get(o.id)}
                      id={optionId(indexOf.get(o.id) ?? 0)}
                      role="option"
                      disabled={isCovered(o.id)}
                      aria-selected={values.includes(o.id) || isCovered(o.id)}
                      // Says *why* it cannot be clicked. A row that is ticked
                      // and inert with no explanation reads as broken.
                      title={isCovered(o.id) ? "Included by its group" : undefined}
                      onClick={() => toggle(o.id)}
                      onMouseEnter={() => setActiveIndex(indexOf.get(o.id) ?? 0)}
                      className={cn(
                        "flex w-full items-center gap-2 pr-2 py-1.5 text-xs",
                        isCovered(o.id)
                          ? "cursor-default text-muted-foreground"
                          : "hover:bg-accent hover:text-accent-foreground",
                        // The indent is the whole point of the grouping: a
                        // heading sits at the margin and its children step in
                        // from it, so the shape of the list says what belongs
                        // to what without any lines being drawn.
                        o.isGroupHeader && !isExclusive(o.id)
                          ? "pl-2 font-semibold uppercase tracking-wide text-[10px]"
                          : isExclusive(o.id)
                            ? "pl-2 font-medium"
                            : "pl-6",
                        isExclusive(o.id) && values.includes(o.id) && "text-primary",
                        o.hidden && !isCovered(o.id) && "text-foreground/60",
                        !o.hidden && !isCovered(o.id) && "text-foreground",
                        !isCovered(o.id) &&
                          activeIndex === indexOf.get(o.id) &&
                          "bg-accent text-accent-foreground"
                      )}
                    >
                      {/*
                        A box rather than a bare tick. The tick was invisible
                        until selected, so a menu nobody had clicked yet looked
                        single-select - the one thing about it worth knowing in
                        advance.
                      */}
                      {isExclusive(o.id) ? (
                        // The slot is held so the labels still line up, but it
                        // stays empty: there is nothing here to tick.
                        <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <span
                          className={cn(
                            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                            isCovered(o.id)
                              ? "border-muted-foreground/40 bg-muted-foreground/40 text-background"
                              : values.includes(o.id)
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input"
                          )}
                        >
                          {(values.includes(o.id) || isCovered(o.id)) && (
                            <Check className="h-2.5 w-2.5" />
                          )}
                        </span>
                      )}
                      <span className="truncate">{o.name}</span>
                    </button>
                  </li>
                )
              )
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
