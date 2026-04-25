"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Upload, Plus, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { useStagedStore } from "@/store/staged";
import { useRules } from "../hooks/useRules";
import { exportRulesToCsv } from "../csv/rulesCsvExport";
import { importRulesFromCsv } from "../csv/rulesCsvImport";
import { RulesTable } from "./RulesTable";
import { RuleDrawer } from "./RuleDrawer";
import { MergeRulesDialog } from "./MergeRulesDialog";

export function RulesView() {
  const { isLoading, isError, error, refetch } = useRules();
  // Accounts, payees, and categories are prefetched by AppShell via
  // usePreloadEntities — no need to subscribe here.

  const router = useRouter();
  const searchParams = useSearchParams();
  const payeeIdFilter    = searchParams.get("payeeId");
  const categoryIdFilter = searchParams.get("categoryId");
  const accountIdFilter  = searchParams.get("accountId");

  const importInputRef = useRef<HTMLInputElement>(null);

  const stagedRules          = useStagedStore((s) => s.rules);
  const stagedPayees         = useStagedStore((s) => s.payees);
  const stagedCategories     = useStagedStore((s) => s.categories);
  const stagedAccounts       = useStagedStore((s) => s.accounts);
  const stagedCategoryGroups = useStagedStore((s) => s.categoryGroups);
  const pushUndo             = useStagedStore((s) => s.pushUndo);
  const stageNew             = useStagedStore((s) => s.stageNew);

  const [drawerOpen, setDrawerOpen]       = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [mergeRuleIds, setMergeRuleIds]   = useState<string[]>([]);
  const [mergeDefaultDeleteOriginals, setMergeDefaultDeleteOriginals] = useState(false);
  const [mergeReturnTo, setMergeReturnTo] = useState<string | null>(null);

  const ruleCount = Object.values(stagedRules).filter((s) => !s.isDeleted).length;

  function openNewRule()            { setEditingRuleId(null); setDrawerOpen(true); }
  function openEditRule(id: string) { setEditingRuleId(id);   setDrawerOpen(true); }

  // Auto-open the new rule drawer when navigated here with ?new=1
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openNewRule();
      router.replace("/rules");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open the merge dialog when navigated here with ?merge=id1,id2&from=...&intent=...
  // (e.g. from a Merge button on a Rule Diagnostics finding).
  useEffect(() => {
    const mergeParam = searchParams.get("merge");
    if (!mergeParam) return;
    const ids = mergeParam.split(",").filter((s) => s.length > 0);
    if (ids.length < 2) {
      router.replace("/rules");
      return;
    }
    const rulesMap = useStagedStore.getState().rules;
    const missing = ids.find((id) => !rulesMap[id] || rulesMap[id].isDeleted);
    if (missing) {
      toast.error("One of the rules to merge no longer exists in the current working set.");
      router.replace("/rules");
      return;
    }
    const from = searchParams.get("from");
    setMergeRuleIds(ids);
    // Pre-tick "Delete originals" whenever the merge was kicked off from
    // diagnostics — clicking Merge on either a duplicate-group or a
    // near-duplicate finding is a clear "I want to consolidate these" intent.
    setMergeDefaultDeleteOriginals(from === "diagnostics");
    setMergeReturnTo(from === "diagnostics" ? "/rules/diagnostics" : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMergeOpenChange(open: boolean) {
    if (open) return;
    setMergeRuleIds([]);
    // Cancel path: if the merge was kicked off from diagnostics, return there.
    // Otherwise just strip the params so a refresh doesn't re-open the dialog.
    if (mergeReturnTo) {
      router.push(mergeReturnTo);
    } else if (searchParams.get("merge")) {
      router.replace("/rules");
    }
    setMergeReturnTo(null);
    setMergeDefaultDeleteOriginals(false);
  }

  function handleMergeConfirmed(newRuleId: string) {
    if (mergeReturnTo) {
      router.push(mergeReturnTo);
    } else {
      // Highlight the newly-merged rule on the rules table.
      router.replace(`/rules?highlight=${newRuleId}`);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  function handleExportCsv() {
    const csv = exportRulesToCsv(stagedRules, {
      payees:         stagedPayees,
      categories:     stagedCategories,
      accounts:       stagedAccounts,
      categoryGroups: stagedCategoryGroups,
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "rules.csv";
    try {
      a.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────────

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

      // Read fresh state at callback time for accurate name resolution
      const store = useStagedStore.getState();
      const result = importRulesFromCsv(text, {
        payees:         store.payees,
        categories:     store.categories,
        accounts:       store.accounts,
        categoryGroups: store.categoryGroups,
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      pushUndo();
      for (const payee of result.newPayees) stageNew("payees", payee);
      for (const rule  of result.rules)     stageNew("rules",  rule);

      if (result.rules.length === 0) {
        toast.warning(
          result.skipped > 0
            ? `No rules imported — ${result.skipped} row(s) skipped.`
            : "No valid rules found in CSV."
        );
      } else {
        const suffix = result.skipped > 0 ? ` (${result.skipped} row(s) skipped)` : "";
        toast.success(
          `Imported ${result.rules.length} rule${result.rules.length !== 1 ? "s" : ""}${suffix}.`
        );
      }
    };

    reader.readAsText(file, "utf-8");
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PageLayout
      title="Rules"
      count={`${ruleCount} rule${ruleCount !== 1 ? "s" : ""}`}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/rules/diagnostics")}
            aria-label="Open rule diagnostics"
            title="Open rule diagnostics"
          >
            <Stethoscope />
            Diagnostics
          </Button>
          <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()} title="Import CSV">
            <Download />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} title="Export CSV">
            <Upload />
            Export
          </Button>
          <Button size="sm" onClick={openNewRule}>
            <Plus />
            Add Rule
          </Button>
        </>
      }
    >
      <RulesTable
        onEdit={openEditRule}
        onMerge={(ids) => setMergeRuleIds(ids)}
        payeeId={payeeIdFilter}
        categoryId={categoryIdFilter}
        accountId={accountIdFilter}
      />

      <RuleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        ruleId={editingRuleId}
      />

      <MergeRulesDialog
        open={mergeRuleIds.length >= 2}
        onOpenChange={handleMergeOpenChange}
        ruleIds={mergeRuleIds}
        defaultDeleteOriginals={mergeDefaultDeleteOriginals}
        onConfirmed={handleMergeConfirmed}
      />
    </PageLayout>
  );
}
