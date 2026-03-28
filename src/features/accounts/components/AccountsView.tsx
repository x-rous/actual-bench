"use client";

import { useRef, useState } from "react";
import { Plus, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { useStagedStore } from "@/store/staged";
import { useAccounts } from "../hooks/useAccounts";
import { AccountsTable } from "./AccountsTable";
import { AccountFormDrawer } from "./AccountFormDrawer";
import { exportAccountsToCsv } from "../csv/accountsCsvExport";
import { importAccountsFromCsv } from "../csv/accountsCsvImport";
import type { AccountFormValues } from "../schemas/account.schema";

export function AccountsView() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { isLoading, isError, error, refetch } = useAccounts();

  const staged = useStagedStore((s) => s.accounts);
  const stageNew = useStagedStore((s) => s.stageNew);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  function handleDrawerSubmit(values: AccountFormValues) {
    pushUndo();
    stageNew("accounts", {
      id: crypto.randomUUID(),
      name: values.name,
      offBudget: values.offBudget,
      closed: false,
    });
  }

  function handleExportCsv() {
    const csv = exportAccountsToCsv(staged);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "accounts.csv";
    a.click();
    URL.revokeObjectURL(url);
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
        stageNew("accounts", { id: crypto.randomUUID(), ...account });
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
          <Button size="sm" onClick={() => setDrawerOpen(true)}>
            <Plus />
            Add Account
          </Button>
        </>
      }
    >
      <AccountsTable />

      <AccountFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSubmit={handleDrawerSubmit}
      />
    </PageLayout>
  );
}
