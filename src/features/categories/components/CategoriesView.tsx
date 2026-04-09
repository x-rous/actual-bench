"use client";

import { useRef, useState } from "react";
import { Download, Upload, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useCategoryGroups } from "../hooks/useCategoryGroups";
import { CategoriesTable } from "./CategoriesTable";
import { RuleDrawer } from "@/features/rules/components/RuleDrawer";
import type { RuleSeed } from "@/features/rules/components/RuleDrawer";
import { exportCategoriesToCsv } from "../csv/categoriesCsvExport";
import { importCategoriesFromCsv } from "../csv/categoriesCsvImport";

export function CategoriesView() {
  const { isLoading, isError, error, refetch } = useCategoryGroups();
  const importInputRef = useRef<HTMLInputElement>(null);

  // Collapse state lifted here so toolbar can control it
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [ruleSeed, setRuleSeed] = useState<RuleSeed | undefined>(undefined);

  function handleCreateRule(categoryId: string) {
    setRuleSeed({
      conditions: [{ field: "payee",    op: "is",  value: "",         type: "id" }],
      actions:    [{ field: "category", op: "set", value: categoryId, type: "id" }],
    });
    setRuleDrawerOpen(true);
  }

  const stagedGroups = useStagedStore((s) => s.categoryGroups);
  const stagedCats = useStagedStore((s) => s.categories);
  const stageNew = useStagedStore((s) => s.stageNew);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  const groupCount = Object.values(stagedGroups).filter((s) => !s.isDeleted).length;
  const categoryCount = Object.values(stagedCats).filter((s) => !s.isDeleted).length;
  const allGroupIds = Object.keys(stagedGroups);
  const allCollapsed = allGroupIds.length > 0 && allGroupIds.every((id) => collapsedGroups.has(id));

  function handleCollapseAll() { setCollapsedGroups(new Set(allGroupIds)); }
  function handleExpandAll()   { setCollapsedGroups(new Set()); }

  function handleExportCsv() {
    const csv = exportCategoriesToCsv(stagedGroups, stagedCats);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "categories.csv";
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

      const existingGroups = Object.values(stagedGroups)
        .filter((s) => !s.isDeleted)
        .map((s) => ({ name: s.entity.name, id: s.entity.id }));

      const result = importCategoriesFromCsv(text, existingGroups);
      if ("error" in result) { toast.error(result.error); return; }

      pushUndo();
      for (const group of result.groups) {
        stageNew("categoryGroups", { ...group, categoryIds: [] });
      }
      for (const cat of result.categories) {
        stageNew("categories", { id: generateId(), ...cat });
      }

      const groupsImported = result.groups.length;
      const catsImported = result.categories.length;
      const total = groupsImported + catsImported;

      if (total === 0) {
        toast.warning(result.skipped > 0 ? `No rows imported — ${result.skipped} skipped.` : "No valid rows found in CSV.");
      } else {
        const parts: string[] = [];
        if (groupsImported > 0) parts.push(`${groupsImported} group${groupsImported !== 1 ? "s" : ""}`);
        if (catsImported > 0) parts.push(`${catsImported} categor${catsImported !== 1 ? "ies" : "y"}`);
        const suffix = result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
        toast.success(`Imported ${parts.join(" and ")}${suffix}.`);
      }
    };

    reader.readAsText(file, "utf-8");
  }

  return (
    <PageLayout
      title="Categories"
      count={`${groupCount} group${groupCount !== 1 ? "s" : ""} · ${categoryCount} categories`}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      scrollManaged
      actions={
        <>
          <Button
            variant="ghost" size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={allCollapsed ? handleExpandAll : handleCollapseAll}
            title={allCollapsed ? "Expand all groups" : "Collapse all groups"}
          >
            {allCollapsed
              ? <><ChevronsUpDown className="mr-1 h-3.5 w-3.5" />Expand All</>
              : <><ChevronsDownUp className="mr-1 h-3.5 w-3.5" />Collapse All</>}
          </Button>
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
        </>
      }
    >
      <CategoriesTable
        collapsedGroups={collapsedGroups}
        setCollapsedGroups={setCollapsedGroups}
        onCreateRule={handleCreateRule}
      />

      <RuleDrawer
        open={ruleDrawerOpen}
        onOpenChange={setRuleDrawerOpen}
        ruleId={null}
        seed={ruleSeed}
      />
    </PageLayout>
  );
}
