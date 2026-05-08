"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileArchive,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { importAccountsFromCsv } from "@/features/accounts/csv/accountsCsvImport";
import { importPayeesFromCsv } from "@/features/payees/csv/payeesCsvImport";
import { importCategoriesFromCsv } from "@/features/categories/csv/categoriesCsvImport";
import { importTagsFromCsv } from "@/features/tags/csv/tagsCsvImport";
import { importSchedulesFromCsv } from "@/features/schedules/csv/schedulesCsvImport";
import { importRulesFromCsv } from "@/features/rules/csv/rulesCsvImport";
import { BUNDLE_ENTITY_LABELS } from "../lib/bundleExport";
import { readBundleZip } from "../lib/bundleImport";
import type { BundleEntityKey } from "../lib/bundleExport";
import type { BundleFileEntry } from "../lib/bundleImport";

// ─── Types ────────────────────────────────────────────────────────────────────

type EntityResult = {
  key: BundleEntityKey;
  staged: number;
  skipped: number;
  error: string | null;
};

type Phase =
  | { name: "idle" }
  | { name: "preview"; files: BundleFileEntry[] }
  | { name: "done"; results: EntityResult[] };

const ENTITY_PAGE: Record<BundleEntityKey, string> = {
  accounts: "/accounts",
  payees: "/payees",
  categories: "/categories",
  tags: "/tags",
  schedules: "/schedules",
  rules: "/rules",
};

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BundleImportDialog({ open, onOpenChange }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const stageNew = useStagedStore((s) => s.stageNew);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  function closeAndReset() {
    onOpenChange(false);
    setPhase({ name: "idle" });
    setIsParsing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsParsing(true);
    const result = await readBundleZip(file);
    setIsParsing(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.files.length === 0) {
      toast.warning("No recognised CSV files found in the ZIP.");
      return;
    }
    setPhase({ name: "preview", files: result.files });
  }

  function handleImportAll(files: BundleFileEntry[]) {
    const results: EntityResult[] = [];
    pushUndo();

    for (const { key, csvText } of files) {
      try {
        // Read fresh state each iteration so subsequent entity types
        // can resolve names from entities staged earlier in this loop.
        const fresh = useStagedStore.getState();

        switch (key) {
          case "categories": {
            const existingGroups = Object.values(fresh.categoryGroups)
              .filter((s) => !s.isDeleted)
              .map((s) => ({ name: s.entity.name, id: s.entity.id }));
            const r = importCategoriesFromCsv(csvText, existingGroups);
            if ("error" in r) {
              results.push({ key, staged: 0, skipped: 0, error: r.error });
              break;
            }
            for (const group of r.groups) {
              stageNew("categoryGroups", { ...group, categoryIds: [] });
            }
            for (const cat of r.categories) {
              stageNew("categories", { id: generateId(), ...cat });
            }
            results.push({
              key,
              staged: r.groups.length + r.categories.length,
              skipped: r.skipped,
              error: null,
            });
            break;
          }

          case "accounts": {
            const r = importAccountsFromCsv(csvText);
            if ("error" in r) {
              results.push({ key, staged: 0, skipped: 0, error: r.error });
              break;
            }
            for (const account of r.accounts) {
              stageNew("accounts", { id: generateId(), ...account });
            }
            results.push({ key, staged: r.accounts.length, skipped: r.skipped, error: null });
            break;
          }

          case "payees": {
            const r = importPayeesFromCsv(csvText);
            if ("error" in r) {
              results.push({ key, staged: 0, skipped: 0, error: r.error });
              break;
            }
            for (const payee of r.payees) {
              stageNew("payees", { id: generateId(), ...payee });
            }
            results.push({ key, staged: r.payees.length, skipped: r.skipped, error: null });
            break;
          }

          case "tags": {
            const r = importTagsFromCsv(csvText);
            if ("error" in r) {
              results.push({ key, staged: 0, skipped: 0, error: r.error });
              break;
            }
            for (const tag of r.tags) {
              stageNew("tags", { id: generateId(), ...tag });
            }
            results.push({ key, staged: r.tags.length, skipped: r.skipped, error: null });
            break;
          }

          case "schedules": {
            const r = importSchedulesFromCsv(csvText, {
              payees: fresh.payees,
              accounts: fresh.accounts,
            });
            if ("error" in r) {
              results.push({ key, staged: 0, skipped: 0, error: r.error });
              break;
            }
            for (const schedule of r.schedules) {
              stageNew("schedules", schedule);
            }
            results.push({ key, staged: r.schedules.length, skipped: r.skipped, error: null });
            break;
          }

          case "rules": {
            const r = importRulesFromCsv(csvText, {
              payees: fresh.payees,
              categories: fresh.categories,
              accounts: fresh.accounts,
              categoryGroups: fresh.categoryGroups,
            });
            if ("error" in r) {
              results.push({ key, staged: 0, skipped: 0, error: r.error });
              break;
            }
            for (const payee of r.newPayees) stageNew("payees", payee);
            for (const rule of r.rules) stageNew("rules", rule);
            results.push({ key, staged: r.rules.length, skipped: r.skipped, error: null });
            break;
          }
        }
      } catch {
        results.push({ key, staged: 0, skipped: 0, error: "Unexpected error during import." });
      }
    }

    setPhase({ name: "done", results });

    const totalStaged = results.reduce((sum, r) => sum + r.staged, 0);
    if (totalStaged > 0) {
      toast.success(`${totalStaged} entities staged — save to persist.`);
    } else {
      toast.warning("No entities were staged.");
    }
  }

  // ── Idle ──────────────────────────────────────────────────────────────────

  if (phase.name === "idle") {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) closeAndReset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Bundle</DialogTitle>
            <DialogDescription>
              Select a ZIP bundle exported from Actual Bench. Entities will be
              staged — nothing is saved until you click Save.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3 py-4">
            <div className="rounded-full border border-dashed border-border p-4">
              <FileArchive className="h-8 w-8 text-muted-foreground" />
            </div>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsing}
            >
              <Upload />
              {isParsing ? "Reading…" : "Select ZIP file"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => void handleFileChange(e)}
            />
          </div>

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    );
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  if (phase.name === "preview") {
    const { files } = phase;
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) closeAndReset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Bundle</DialogTitle>
            <DialogDescription>
              {files.length} entity type{files.length !== 1 ? "s" : ""} detected.
              Review below and click Import All to stage them.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            {files.map((f) => (
              <div
                key={f.key}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
              >
                <span className="font-medium">{BUNDLE_ENTITY_LABELS[f.key]}</span>
                <span className="text-muted-foreground">
                  {f.rowCount} row{f.rowCount !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPhase({ name: "idle" })}>
              Back
            </Button>
            <Button onClick={() => handleImportAll(files)}>Import All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  const { results } = phase;
  const errorCount = results.filter((r) => r.error !== null).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeAndReset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Complete</DialogTitle>
          <DialogDescription>
            {errorCount === 0
              ? "All entities have been staged. Click Save to persist."
              : `${errorCount} entity type${errorCount !== 1 ? "s" : ""} had errors. Valid rows were still staged.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {results.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                {r.error ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                )}
                <span className="font-medium">{BUNDLE_ENTITY_LABELS[r.key]}</span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                {r.error ? (
                  <span className="text-xs text-destructive">{r.error}</span>
                ) : (
                  <>
                    <span>{r.staged} staged</span>
                    {r.skipped > 0 && <span>· {r.skipped} skipped</span>}
                    <button
                      type="button"
                      onClick={() => {
                        router.push(ENTITY_PAGE[r.key]);
                        closeAndReset();
                      }}
                      className="ml-1 text-foreground/60 transition-colors hover:text-foreground"
                      title={`Go to ${BUNDLE_ENTITY_LABELS[r.key]}`}
                      aria-label={`Go to ${BUNDLE_ENTITY_LABELS[r.key]}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
