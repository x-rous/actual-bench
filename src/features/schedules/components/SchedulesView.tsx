"use client";

import { useRef, useState } from "react";
import { Plus, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { useStagedStore } from "@/store/staged";
import { useSchedules } from "../hooks/useSchedules";
import { exportSchedulesToCsv } from "../csv/schedulesCsvExport";
import { importSchedulesFromCsv } from "../csv/schedulesCsvImport";
import { SchedulesTable } from "./SchedulesTable";
import { ScheduleFormDrawer } from "./ScheduleFormDrawer";
import { SchedulesTableOverlays } from "./SchedulesTableOverlays";
import type { ScheduleDeleteIntent } from "./SchedulesTableOverlays";
import { RuleDrawer } from "@/features/rules/components/RuleDrawer";

export function SchedulesView() {
  const { isLoading, isError, error, refetch } = useSchedules();

  const importInputRef = useRef<HTMLInputElement>(null);

  const stagedSchedules = useStagedStore((s) => s.schedules);
  const stagedPayees    = useStagedStore((s) => s.payees);
  const stagedAccounts  = useStagedStore((s) => s.accounts);
  const stageNew        = useStagedStore((s) => s.stageNew);
  const pushUndo        = useStagedStore((s) => s.pushUndo);

  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [editingRuleId, setEditingRuleId]   = useState<string | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<ScheduleDeleteIntent | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const scheduleCount = Object.values(stagedSchedules).filter((s) => !s.isDeleted).length;

  function openNew()            { setEditingScheduleId(null); setDrawerOpen(true); }
  function openEdit(id: string) { setEditingScheduleId(id);   setDrawerOpen(true); }

  function handleEditAsRule(ruleId: string) {
    setEditingRuleId(ruleId);
    setRuleDrawerOpen(true);
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  function handleExportCsv() {
    const csv = exportSchedulesToCsv(stagedSchedules, { payees: stagedPayees, accounts: stagedAccounts });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "schedules.csv";
    try { a.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 100); }
  }

  // ── Import ────────────────────────────────────────────────────────────────────
  function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) { toast.error("File is too large (max 5 MB)."); return; }

    const reader = new FileReader();
    reader.onerror = (ev) => {
      const msg = (ev.target as FileReader | null)?.error?.message;
      toast.error("Failed to read file" + (msg ? `: ${msg}` : ""));
    };
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== "string") return;

      const store = useStagedStore.getState();
      const result = importSchedulesFromCsv(text, {
        payees: store.payees,
        accounts: store.accounts,
      });

      if ("error" in result) { toast.error(result.error); return; }

      pushUndo();
      for (const s of result.schedules) stageNew("schedules", s);

      if (result.schedules.length === 0) {
        toast.warning(
          result.skipped > 0
            ? `No schedules imported — ${result.skipped} row(s) skipped.`
            : "No valid schedules found in CSV."
        );
      } else {
        const suffix = result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
        toast.success(`Imported ${result.schedules.length} schedule${result.schedules.length !== 1 ? "s" : ""}${suffix}.`);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <PageLayout
      title="Schedules"
      count={`${scheduleCount} schedule${scheduleCount !== 1 ? "s" : ""}`}
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
            <Upload />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} title="Export CSV">
            <Download />
            Export
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus />
            Add Schedule
          </Button>
        </>
      }
    >
      <SchedulesTable
        onEdit={openEdit}
        onEditAsRule={handleEditAsRule}
        onDeleteIntentChange={setDeleteIntent}
        onInspectIdChange={setInspectId}
      />

      <ScheduleFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        scheduleId={editingScheduleId}
        onEditAsRule={handleEditAsRule}
      />

      <RuleDrawer
        open={ruleDrawerOpen}
        onOpenChange={setRuleDrawerOpen}
        ruleId={editingRuleId}
      />

      <SchedulesTableOverlays
        deleteIntent={deleteIntent}
        onDeleteIntentChange={setDeleteIntent}
        inspectId={inspectId}
        onInspectIdChange={setInspectId}
      />
    </PageLayout>
  );
}
