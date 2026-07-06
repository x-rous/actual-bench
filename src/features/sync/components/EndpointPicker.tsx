"use client";

import { useFlowAccounts } from "../hooks/useSyncData";
import type { BrowserApiConnection } from "@/store/connection";
import type { SyncEndpointForm } from "../lib/flowForm";

type EndpointPickerProps = {
  label: string;
  endpoint: SyncEndpointForm;
  connections: BrowserApiConnection[];
  onChange: (next: SyncEndpointForm) => void;
};

const selectClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

export function EndpointPicker({ label, endpoint, connections, onChange }: EndpointPickerProps) {
  const accountsQuery = useFlowAccounts(endpoint.connectionId);
  const accounts = accountsQuery.data ?? [];

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">{label}</legend>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Direct connection (budget)</span>
        <select
          aria-label={`${label} connection`}
          className={selectClass}
          value={endpoint.connectionId}
          onChange={(e) => {
            const connection = connections.find((c) => c.id === e.target.value);
            onChange({
              connectionId: connection?.id ?? "",
              budgetSyncId: connection?.budgetSyncId ?? "",
              budgetName: connection?.label ?? "",
              accountId: "",
              accountName: "",
            });
          }}
        >
          <option value="">Select a connection…</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Account</span>
        <select
          aria-label={`${label} account`}
          className={selectClass}
          value={endpoint.accountId}
          disabled={!endpoint.connectionId || accountsQuery.isLoading}
          onChange={(e) => {
            const account = accounts.find((a) => a.id === e.target.value);
            onChange({
              ...endpoint,
              accountId: account?.id ?? "",
              accountName: account?.name ?? "",
            });
          }}
        >
          <option value="">
            {accountsQuery.isLoading ? "Loading accounts…" : "Select an account…"}
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
