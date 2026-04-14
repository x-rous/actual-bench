"use client";

import { useRef, useState } from "react";
import { Plus, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { usePayees } from "../hooks/usePayees";
import { PayeesTable } from "./PayeesTable";
import { RuleDrawer } from "@/features/rules/components/RuleDrawer";
import type { RuleSeed } from "@/features/rules/components/RuleDrawer";
import { PayeesTableOverlays } from "./PayeesTableOverlays";
import type { PayeeDeleteIntent } from "./PayeesTableOverlays";
import { PayeesMergeDialog } from "./PayeesMergeDialog";
import type { PayeeMergeState } from "./PayeesMergeDialog";
import { exportPayeesToCsv } from "../csv/payeesCsvExport";
import { importPayeesFromCsv } from "../csv/payeesCsvImport";

export function PayeesView() {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [ruleSeed, setRuleSeed] = useState<RuleSeed | undefined>(undefined);
  const [deleteIntent, setDeleteIntent] = useState<PayeeDeleteIntent | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [mergeDialog, setMergeDialog] = useState<PayeeMergeState | null>(null);

  const { isLoading, isError, error, refetch } = usePayees();

  const staged = useStagedStore((s) => s.payees);
  const stageNew = useStagedStore((s) => s.stageNew);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  function handleCreateRule(payeeId: string, payeeName: string) {
    setRuleSeed({
      conditions: [{ field: "notes", op: "contains", value: payeeName, type: "string" }],
      actions:    [{ field: "payee", op: "set",      value: payeeId,   type: "id"     }],
    });
    setRuleDrawerOpen(true);
  }

  function handleAddPayee() {
    pushUndo();
    stageNew("payees", {
      id: generateId(),
      name: "New Payee",
    });
  }

  function handleExportCsv() {
    const csv = exportPayeesToCsv(staged);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payees.csv";
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

      const result = importPayeesFromCsv(text);
      if ("error" in result) { toast.error(result.error); return; }

      pushUndo();
      for (const payee of result.payees) {
        stageNew("payees", { id: generateId(), ...payee });
      }

      const imported = result.payees.length;
      if (imported === 0) {
        toast.warning("No valid rows found in CSV.");
      } else if (result.skipped > 0) {
        toast.success(`Imported ${imported} payee${imported !== 1 ? "s" : ""} (${result.skipped} skipped — empty name).`);
      } else {
        toast.success(`Imported ${imported} payee${imported !== 1 ? "s" : ""}.`);
      }
    };

    reader.readAsText(file, "utf-8");
  }

  const totalCount = Object.keys(staged).length;
  const regularCount = Object.values(staged).filter((s) => !s.entity.transferAccountId && !s.isDeleted).length;

  return (
    <PageLayout
      title="Payees"
      count={`${regularCount} regular · ${totalCount} total`}
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
          <Button size="sm" onClick={handleAddPayee}>
            <Plus />
            Add Payee
          </Button>
        </>
      }
    >
      <PayeesTable
        onCreateRule={handleCreateRule}
        onDeleteIntentChange={setDeleteIntent}
        onInspectIdChange={setInspectId}
        onMergeDialogChange={setMergeDialog}
      />

      <RuleDrawer
        open={ruleDrawerOpen}
        onOpenChange={setRuleDrawerOpen}
        ruleId={null}
        seed={ruleSeed}
      />

      <PayeesTableOverlays
        deleteIntent={deleteIntent}
        onDeleteIntentChange={setDeleteIntent}
        inspectId={inspectId}
        onInspectIdChange={setInspectId}
      />

      <PayeesMergeDialog
        mergeDialog={mergeDialog}
        onMergeDialogChange={setMergeDialog}
      />
    </PageLayout>
  );
}
