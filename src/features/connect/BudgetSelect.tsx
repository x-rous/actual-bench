"use client";

import { type ReactNode } from "react";
import { SelectField } from "@/components/ui/select-field";
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
  disabled?: boolean;
};

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Options grouped by server (mode and address), in the order each server first appears. */
function byServer(options: BudgetOption[]) {
  const groups = new Map<string, { label: string; options: BudgetOption[] }>();
  for (const option of options) {
    const key = serverFingerprint({ mode: option.mode, baseUrl: option.baseUrl });
    const group = groups.get(key) ?? { label: `${host(option.baseUrl)} · ${getConnectionModeBadge(option.mode)}`, options: [] };
    group.options.push(option);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Pick a budget: every picker in the app looks and reads the same, grouped by
 * server like the top-bar switcher. A native select (via `SelectField`), so
 * keyboard, typeahead, touch and screen readers work as the platform does.
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
  id,
}: {
  options: BudgetOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Shown as the first, empty choice when nothing needs to be chosen yet. */
  placeholder?: string;
  emptyLabel?: string;
  size?: "default" | "sm";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  id?: string;
}) {
  return (
    <SelectField
      id={id}
      size={size}
      className={className}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.length === 0 && placeholder === undefined && <option value="">{emptyLabel}</option>}
      {byServer(options).map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.note ? `${option.name} (${option.note})` : option.name}
            </option>
          ))}
        </optgroup>
      ))}
    </SelectField>
  );
}

const SAVED_PREFIX = "saved:";
const byId = (connection: ConnectionInstance): string => connection.id;

/**
 * The usual budget choices: the budgets connected in this session, then the
 * saved ones not connected yet. Choosing a saved one connects it in the
 * background (asking to unlock saved connections first when needed) without
 * changing the active budget. Render `dialog` once beside the select.
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
      note: connector.locked ? "saved, unlock to open" : "saved",
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
