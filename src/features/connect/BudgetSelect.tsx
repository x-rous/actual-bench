"use client";

import { type ReactNode } from "react";
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { getConnectionModeBadge } from "@/components/connect/utils";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import type { ConnectionInstance, ConnectionMode } from "@/store/connection";
import { useSavedBudgetConnector } from "./useSavedBudgetConnector";

/**
 * One budget in a `BudgetSelect`. `value` is whatever the caller keys budgets
 * by; `note` is a short qualifier shown after the name ("not enrolled").
 */
export type BudgetOption = {
  value: string;
  name: string;
  mode: ConnectionMode;
  baseUrl: string;
  note?: string;
};

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * The combobox's list: a heading per server (mode and address, in the order each
 * server first appears) with its budgets beneath.
 */
function groupedOptions(options: BudgetOption[]): ComboboxOption[] {
  const groups = new Map<string, { label: string; options: BudgetOption[] }>();
  for (const option of options) {
    const key = serverFingerprint({ mode: option.mode, baseUrl: option.baseUrl });
    const group = groups.get(key) ?? { label: `${host(option.baseUrl)} · ${getConnectionModeBadge(option.mode)}`, options: [] };
    group.options.push(option);
    groups.set(key, group);
  }
  return [...groups.entries()].flatMap(([key, group]) => [
    { id: `server:${key}`, name: group.label, isGroupHeader: true as const },
    ...group.options.map((option) => ({
      id: option.value,
      name: option.note ? `${option.name} (${option.note})` : option.name,
    })),
  ]);
}

/**
 * Pick a budget: every picker in the app looks and reads the same, grouped by
 * server like the top-bar switcher, with a search box for long lists. The same
 * control as the rules dialog's category picker.
 */
export function BudgetSelect({
  options,
  value,
  onValueChange,
  placeholder,
  emptyLabel = "No budgets to choose from",
  size,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  options: BudgetOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Shown when nothing is chosen; also offers "- none -" to clear the choice. */
  placeholder?: string;
  emptyLabel?: string;
  size?: "default" | "sm";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <SearchableCombobox
      options={groupedOptions(options)}
      value={value}
      onChange={onValueChange}
      placeholder={options.length === 0 ? emptyLabel : (placeholder ?? "Choose a budget…")}
      allowNone={placeholder !== undefined}
      disabled={disabled}
      ariaLabel={ariaLabel}
      triggerClassName={cn(size === "sm" && "h-7", className)}
    />
  );
}

const SAVED_PREFIX = "saved:";
const byId = (connection: ConnectionInstance): string => connection.id;

/**
 * The usual budget choices: the budgets connected in this session, then the
 * saved ones not connected yet, listed like any other. Choosing a saved one
 * connects it in the background (asking to unlock saved connections first
 * when needed) without changing the active budget. Render `dialog` once beside
 * the select.
 *
 * `keyOf` keys a connection the way the caller stores its choice (its id by
 * default); `noteOf` adds a qualifier to a connected budget.
 */
export function useBudgetChoices({
  connections,
  keyOf = byId,
  noteOf,
}: {
  connections: ConnectionInstance[];
  keyOf?: (connection: ConnectionInstance) => string;
  noteOf?: (connection: ConnectionInstance) => string | undefined;
}): {
  options: BudgetOption[];
  /** The connection for a chosen value, connecting a saved budget first. Null if that failed or was cancelled. */
  resolve: (value: string) => Promise<ConnectionInstance | null>;
  connecting: boolean;
  dialog: ReactNode;
  /** The underlying saved-budget connector, for a caller that also offers its own "Connect" action. */
  connector: ReturnType<typeof useSavedBudgetConnector>;
} {
  const connector = useSavedBudgetConnector();
  const savedValue = (serverFp: string, budgetSyncId: string) => `${SAVED_PREFIX}${serverFp}:${budgetSyncId}`;

  const options: BudgetOption[] = [
    ...connections.map((connection) => ({
      value: keyOf(connection),
      name: connection.label,
      mode: connection.mode,
      baseUrl: connection.baseUrl,
      note: noteOf?.(connection),
    })),
    ...connector.saved.map((saved) => ({
      value: savedValue(saved.serverFingerprint, saved.budgetSyncId),
      name: saved.name,
      mode: saved.mode,
      baseUrl: saved.baseUrl,
    })),
  ];

  async function resolve(value: string): Promise<ConnectionInstance | null> {
    if (!value.startsWith(SAVED_PREFIX)) {
      return connections.find((connection) => keyOf(connection) === value) ?? null;
    }
    const saved = connector.saved.find((entry) => savedValue(entry.serverFingerprint, entry.budgetSyncId) === value);
    return saved ? connector.connect(saved) : null;
  }

  return { options, resolve, connecting: connector.connecting, dialog: connector.dialog, connector };
}
