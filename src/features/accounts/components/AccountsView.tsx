"use client";

import { useRef, useState } from "react";
import { Plus, Download, Upload, RefreshCw, Landmark, FolderTree } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useAccounts } from "../hooks/useAccounts";
import { useAccountBalances } from "../hooks/useAccountBalances";
import { useBankSync } from "../hooks/useBankSync";
import { AccountsTable } from "./AccountsTable";
import { AccountFormDrawer } from "./AccountFormDrawer";
import type { AccountFormValues } from "../schemas/account.schema";
import dynamic from "next/dynamic";
import type { RuleSeed } from "@/features/rules/components/RuleDrawer";
import { AccountsTableOverlays } from "./AccountsTableOverlays";
import { AccountGroupsDialog } from "./AccountGroupsDialog";
import { useAccountGroups } from "../hooks/useAccountGroups";
import type { AccountDeleteIntent } from "./AccountsTableOverlays";
import { liveGroups } from "../lib/accountGroups";
import { useAccountGroupActions } from "../hooks/useAccountGroupActions";
import { exportAccountsToCsv } from "../csv/accountsCsvExport";
import { importAccountsFromCsv } from "../csv/accountsCsvImport";

// Lazy-loaded: the rule builder is a secondary action on this page, so keep its
// bundle out of the initial Accounts route load.
const RuleDrawer = dynamic(
  () => import("@/features/rules/components/RuleDrawer").then((m) => m.RuleDrawer),
  { ssr: false },
);

export function AccountsView() {
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [ruleSeed, setRuleSeed] = useState<RuleSeed | undefined>(undefined);
  const [formDrawerOpen, setFormDrawerOpen] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState<AccountDeleteIntent | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [groupsDialogOpen, setGroupsDialogOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { isLoading, isError, error, refetch } = useAccounts();
  const { refetch: refetchBalances, isFetching: isRefreshingBalances } = useAccountBalances();
  const { supported: bankSyncSupported, syncBanks, isSyncing } = useBankSync();
  const { supported: groupsSupported } = useAccountGroups();
  const { createGroup } = useAccountGroupActions();

  const staged = useStagedStore((s) => s.accounts);
  const stageNew = useStagedStore((s) => s.stageNew);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  function handleAddAccount() {
    setFormDrawerOpen(true);
  }

  function handleCreateAccount(values: AccountFormValues) {
    pushUndo();
    stageNew("accounts", {
      id: generateId(),
      name: values.name,
      offBudget: values.offBudget,
      closed: false,
      initialBalance: values.initialBalance,
    });
  }

  async function handleRefreshBalances() {
    const result = await refetchBalances();
    if (result.error) {
      toast.error("Failed to refresh balances.");
    } else {
      toast.success("Balances refreshed.");
    }
  }

  function handleCreateRule(accountId: string, accountName: string) {
    setRuleSeed({
      conditions: [{ field: "payee",   op: "contains", value: accountName, type: "string" }],
      actions:    [{ field: "account", op: "set",      value: accountId,   type: "id"     }],
    });
    setRuleDrawerOpen(true);
  }

  function handleExportCsv() {
    const csv = exportAccountsToCsv(
      staged,
      groupsSupported ? liveGroups(useStagedStore.getState().accountGroups) : undefined
    );
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "accounts.csv";
    try {
      a.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  }

  function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > CSV_MAX_BYTES) {
      toast.error("File is too large (max 5 MB).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== "string") return;

      const result = importAccountsFromCsv(text);
      if ("error" in result) { toast.error(result.error); return; }

      pushUndo();
      // Resolve the "group" column: reuse a live group of that name (ignoring
      // case) or stage a new one. Without server support the column is ignored.
      const groupIdByName = new Map<string, string>();
      for (const group of liveGroups(useStagedStore.getState().accountGroups)) {
        groupIdByName.set(group.name.trim().toLowerCase(), group.id);
      }
      let ignoredGroups = false;
      const rejectedGroups: string[] = [];
      for (const { groupName, ...account } of result.accounts) {
        let groupId: string | null = null;
        if (groupName) {
          if (!groupsSupported) {
            ignoredGroups = true;
          } else {
            const key = groupName.toLowerCase();
            let id = groupIdByName.get(key);
            if (!id) {
              const created = createGroup(groupName, [], false);
              if ("id" in created) {
                id = created.id;
                groupIdByName.set(key, id);
              } else if (!rejectedGroups.includes(groupName)) {
                // e.g. a name over the length limit: the account is still imported, ungrouped.
                rejectedGroups.push(groupName);
              }
            }
            groupId = id ?? null;
          }
        }
        stageNew("accounts", { id: generateId(), ...account, ...(groupId ? { groupId } : {}) });
      }
      if (ignoredGroups) toast.info("The group column was ignored: this server has no account groups.");
      if (rejectedGroups.length > 0) {
        const shown = rejectedGroups.slice(0, 3).map((name) => `"${name.length > 40 ? `${name.slice(0, 40)}…` : name}"`);
        const more = rejectedGroups.length > shown.length ? ` and ${rejectedGroups.length - shown.length} more` : "";
        toast.warning(`Imported without a group because the group name is not valid: ${shown.join(", ")}${more}.`);
      }

      const imported = result.accounts.length;
      if (imported === 0) {
        toast.warning("No valid rows found in CSV.");
      } else if (result.skipped > 0) {
        toast.success(`Imported ${imported} account${imported !== 1 ? "s" : ""} (${result.skipped} skipped - empty name).`);
      } else {
        toast.success(`Imported ${imported} account${imported !== 1 ? "s" : ""}.`);
      }
    };

    reader.readAsText(file, "utf-8");
  }

  const totalCount = Object.keys(staged).length;
  const activeCount = Object.values(staged).filter((s) => !s.entity.closed && !s.isDeleted).length;

  return (
    <PageLayout
      title="Accounts"
      count={`${activeCount} active · ${totalCount} total`}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      scrollManaged
      actions={
        <>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportCsv}
          />
          {bankSyncSupported && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncBanks(undefined)}
              disabled={isSyncing}
              title="Ask Actual to pull new transactions from your connected banks"
            >
              <Landmark className={cn(isSyncing && "animate-pulse")} />
              {isSyncing ? "Syncing banks…" : "Sync banks"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshBalances}
            disabled={isRefreshingBalances}
            title="Refresh balances"
          >
            <RefreshCw className={cn(isRefreshingBalances && "animate-spin")} />
            Refresh
          </Button>
          {groupsSupported && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGroupsDialogOpen(true)}
              title="Create, rename and delete account groups, and set their account class"
            >
              <FolderTree />
              Manage Groups
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()} title="Import CSV">
            <Download />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} title="Export CSV">
            <Upload />
            Export
          </Button>
          <Button size="sm" onClick={handleAddAccount}>
            <Plus />
            Add Account
          </Button>
        </>
      }
    >
      <AccountsTable
        onCreateRule={handleCreateRule}
        onDeleteIntentChange={setDeleteIntent}
        onInspectIdChange={setInspectId}
      />

      <RuleDrawer
        open={ruleDrawerOpen}
        onOpenChange={setRuleDrawerOpen}
        ruleId={null}
        seed={ruleSeed}
      />

      <AccountFormDrawer
        open={formDrawerOpen}
        onOpenChange={setFormDrawerOpen}
        onSubmit={handleCreateAccount}
      />

      <AccountGroupsDialog open={groupsDialogOpen} onOpenChange={setGroupsDialogOpen} />

      <AccountsTableOverlays
        deleteIntent={deleteIntent}
        onDeleteIntentChange={setDeleteIntent}
        inspectId={inspectId}
        onInspectIdChange={setInspectId}
      />
    </PageLayout>
  );
}
