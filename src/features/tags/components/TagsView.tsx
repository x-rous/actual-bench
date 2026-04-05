"use client";

import { useRef } from "react";
import { Plus, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useTags } from "../hooks/useTags";
import { TagsTable } from "./TagsTable";
import { exportTagsToCsv } from "../csv/tagsCsvExport";
import { importTagsFromCsv } from "../csv/tagsCsvImport";

export function TagsView() {
  const importInputRef = useRef<HTMLInputElement>(null);

  const { isLoading, isError, error, refetch } = useTags();

  const stagedTags = useStagedStore((s) => s.tags);
  const stageNew   = useStagedStore((s) => s.stageNew);
  const pushUndo   = useStagedStore((s) => s.pushUndo);

  const tagCount = Object.values(stagedTags).filter((s) => !s.isDeleted).length;

  function handleAddTag() {
    pushUndo();
    stageNew("tags", { id: generateId(), name: "NewTag" });
  }

  function handleExportCsv() {
    const csv = exportTagsToCsv(stagedTags);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "tags.csv";
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

      const result = importTagsFromCsv(text);
      if ("error" in result) { toast.error(result.error); return; }

      pushUndo();
      for (const tag of result.tags) {
        stageNew("tags", { id: generateId(), ...tag });
      }

      const imported = result.tags.length;
      if (imported === 0) {
        toast.warning(
          result.skipped > 0
            ? `No tags imported — ${result.skipped} row(s) skipped.`
            : "No valid tags found in CSV."
        );
      } else {
        const suffix = result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
        toast.success(`Imported ${imported} tag${imported !== 1 ? "s" : ""}${suffix}.`);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <PageLayout
      title="Tags"
      count={`${tagCount} tag${tagCount !== 1 ? "s" : ""}`}
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
          <Button size="sm" onClick={handleAddTag}>
            <Plus />
            Add Tag
          </Button>
        </>
      }
    >
      <TagsTable />
    </PageLayout>
  );
}
