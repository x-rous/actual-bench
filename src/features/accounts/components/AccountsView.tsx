"use client";

import { useRef, useState } from "react";
import { Plus, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useAccounts } from "../hooks/useAccounts";
import { AccountsTable } from "./AccountsTable";
import { RuleDrawer } from "@/features/rules/components/RuleDrawer";
import type { RuleSeed } from "@/features/rules/components/RuleDrawer";
import { AccountsTableOverlays } from "./AccountsTableOverlays";
import type { AccountDeleteIntent } from "./AccountsTableOverlays";
import { exportAccountsToCsv } from "../csv/accountsCsvExport";
import { importAccountsFromCsv } from "../csv/accountsCsvImport";

export function AccountsView() {
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [ruleSeed, setRuleSeed] = useState<RuleSeed | undefined>(undefined);
  const [deleteIntent, setDeleteIntent] = useState<AccountDeleteIntent | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { isLoading, isError, error, refetch } = useAccounts();

  const staged = useStagedStore((s) => s.accounts);
  const stageNew = useStagedStore((s) => s.stageNew);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  function handleAddAccount() {
    pushUndo();
    stageNew("accounts", {
      id: generateId(),
      name: "New Account",
      offBudget: false,
      closed: false,
    });
  }

  function handleCreateRule(accountId: string, accountName: string) {
    setRuleSeed({
      conditions: [{ field: "payee",   op: "contains", value: accountName, type: "string" }],
      actions:    [{ field: "account", op: "set",      value: accountId,   type: "id"     }],
    });
    setRuleDrawerOpen(true);
  }

  function handleExportCsv() {
    const csv = exportAccountsToCsv(staged);
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
      for (const account of result.accounts) {
        stageNew("accounts", { id: generateId(), ...account });
      }

      const imported = result.accounts.length;
      if (imported === 0) {
        toast.warning("No valid rows found in CSV.");
      } else if (result.skipped > 0) {
        toast.success(`Imported ${imported} account${imported !== 1 ? "s" : ""} (${result.skipped} skipped — empty name).`);
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

      <AccountsTableOverlays
        deleteIntent={deleteIntent}
        onDeleteIntentChange={setDeleteIntent}
        inspectId={inspectId}
        onInspectIdChange={setInspectId}
      />
    </PageLayout>
  );
}
