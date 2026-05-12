"use client";

import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Save, X, Undo2, Redo2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useConnectionStore,
  selectActiveInstance,
} from "@/store/connection";
import { useGlobalSearchStore } from "@/features/global-search/store/useGlobalSearchStore";
import { useConnectionHealthContext } from "@/hooks/useConnectionHealth";
import { ConnectionHealthDot } from "./ConnectionHealthDot";
import { useSavedServersStore } from "@/store/savedServers";
import {
  useStagedStore,
  selectHasChanges,
  selectCanUndo,
  selectCanRedo,
} from "@/store/staged";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useBudgetSavePipeline } from "./useBudgetSavePipeline";
import { useBudgetSave } from "@/features/budget-management/hooks/useBudgetSave";
import { BudgetSaveProgressDialog } from "@/features/budget-management/components/BudgetSaveProgressDialog";
import { BudgetSaveReviewDialog } from "@/features/budget-management/components/BudgetSaveReviewDialog";
import {
  readBudgetSaveReviewSkip,
  writeBudgetSaveReviewSkip,
} from "@/features/budget-management/lib/budgetSaveReview";
import type { BudgetCellKey, StagedBudgetEdit, StagedHold } from "@/features/budget-management/types";

type PendingAction =
  | { kind: "switch"; id: string }
  | { kind: "addConnection" }
  | { kind: "disconnect" };

function TopBarVersionChip({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title: string;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex items-center gap-1 rounded-sm bg-muted/55 px-1.5 py-0.5 ring-1 ring-border/50"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        {label}
      </span>
      <span className="font-mono text-[11px] leading-none text-foreground/85">
        {value}
      </span>
    </span>
  );
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [budgetSaveReviewSkipped, setBudgetSaveReviewSkipped] = useState(
    () => readBudgetSaveReviewSkip()
  );
  const [budgetSaveReviewEdits, setBudgetSaveReviewEdits] = useState<Record<BudgetCellKey, StagedBudgetEdit> | null>(null);
  const [budgetSaveReviewHolds, setBudgetSaveReviewHolds] = useState<Record<string, StagedHold>>({});
  const [budgetSaveEdits, setBudgetSaveEdits] = useState<Record<BudgetCellKey, StagedBudgetEdit> | null>(null);
  const [budgetSaveHolds, setBudgetSaveHolds] = useState<Record<string, StagedHold>>({});

  const openSearch = useGlobalSearchStore((s) => s.open);
  const searchShortcutLabel = "Ctrl+k";

  const { status: healthStatus } = useConnectionHealthContext();
  const isOffline = healthStatus === "offline";

  const activeInstance = useConnectionStore(selectActiveInstance);
  const instances = useConnectionStore((s) => s.instances);
  const setActive = useConnectionStore((s) => s.setActiveInstance);
  const clearAll = useConnectionStore((s) => s.clearAll);
  const clearServers = useSavedServersStore((s) => s.clearServers);

  // Entity pages store
  const stagedHasChanges = useStagedStore(selectHasChanges);
  const stagedCanUndo = useStagedStore(selectCanUndo);
  const stagedCanRedo = useStagedStore(selectCanRedo);
  const stagedUndo = useStagedStore((s) => s.undo);
  const stagedRedo = useStagedStore((s) => s.redo);
  const stagedDiscardAll = useStagedStore((s) => s.discardAll);
  const clearHistory = useStagedStore((s) => s.clearHistory);
  const { saveAll, isSaving: isEntitySaving } = useBudgetSavePipeline();

  // Budget page store (always called — hooks cannot be conditional)
  const budgetHasChanges = useBudgetEditsStore(
    (s) => Object.keys(s.edits).length > 0 || Object.keys(s.holds).length > 0
  );
  const budgetCanUndo = useBudgetEditsStore((s) => s.undoStack.length > 0);
  const budgetCanRedo = useBudgetEditsStore((s) => s.redoStack.length > 0);
  const budgetUndo = useBudgetEditsStore((s) => s.undo);
  const budgetRedo = useBudgetEditsStore((s) => s.redo);
  const budgetDiscardAll = useBudgetEditsStore((s) => s.discardAll);
  const { isSaving: isBudgetSaving } = useBudgetSave();

  // Route-aware resolution
  const isBudgetPage = pathname?.startsWith("/budget-management") ?? false;
  const hasChanges = isBudgetPage ? budgetHasChanges : stagedHasChanges;
  const canUndo = isBudgetPage ? budgetCanUndo : stagedCanUndo;
  const canRedo = isBudgetPage ? budgetCanRedo : stagedCanRedo;
  const isSaving = isBudgetPage ? (isBudgetSaving || budgetSaveEdits !== null) : isEntitySaving;
  const saveDisabled =
    !hasChanges || isSaving || isOffline || (isBudgetPage && budgetSaveReviewEdits !== null);

  function handleDiscardAll() {
    if (isBudgetPage) {
      budgetDiscardAll();
    } else {
      stagedDiscardAll();
    }
  }

  // ── Guarded action helpers ────────────────────────────────────────────────────

  function requestAction(action: PendingAction) {
    if (hasChanges) {
      setPendingAction(action);
    } else {
      void executeAction(action);
    }
  }

  async function executeAction(action: PendingAction) {
    if (action.kind === "switch") {
      handleDiscardAll();
      queryClient.clear();
      setActive(action.id);
    } else if (action.kind === "addConnection") {
      handleDiscardAll();
      await queryClient.cancelQueries();
      queryClient.clear();
      setActive(null);
      router.push("/connect");
    } else if (action.kind === "disconnect") {
      handleDiscardAll();
      queryClient.clear();
      clearAll();
      clearServers();
      router.push("/connect");
    }
  }

  async function handleConfirmDiscard() {
    const action = pendingAction;
    setPendingAction(null);
    if (action) await executeAction(action);
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (isBudgetPage) {
      const { edits, holds } = useBudgetEditsStore.getState();
      const editSnapshot = { ...edits };
      const holdSnapshot = { ...holds };
      if (Object.keys(editSnapshot).length === 0 && Object.keys(holdSnapshot).length === 0) return;

      if (budgetSaveReviewSkipped) {
        setBudgetSaveEdits(editSnapshot);
        setBudgetSaveHolds(holdSnapshot);
        return;
      }

      setBudgetSaveReviewEdits(editSnapshot);
      setBudgetSaveReviewHolds(holdSnapshot);
    } else {
      try {
        const { totalSucceeded, totalFailed } = await saveAll();
        clearHistory();
        if (totalFailed === 0) {
          toast.success(
            `Saved ${totalSucceeded} item${totalSucceeded !== 1 ? "s" : ""} successfully.`
          );
        } else {
          toast.error(`${totalSucceeded} saved, ${totalFailed} failed.`);
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Save failed.";
        toast.error(msg);
      }
    }
  }

  function handleSwitchConnection(id: string) {
    if (id === activeInstance?.id) return;
    requestAction({ kind: "switch", id });
  }

  function handleRefresh() {
    if (hasChanges) {
      toast.warning("Unsaved changes will be lost.", {
        action: {
          label: "Discard & Refresh",
          onClick: async () => {
            handleDiscardAll();
            setIsRefreshing(true);
            await queryClient.resetQueries();
            setIsRefreshing(false);
          },
        },
      });
      return;
    }
    setIsRefreshing(true);
    queryClient.invalidateQueries().then(() => setIsRefreshing(false));
  }

  function handleResetBudgetSaveReview() {
    writeBudgetSaveReviewSkip(false);
    setBudgetSaveReviewSkipped(false);
    toast.success("Budget save review re-enabled.");
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        {/* Left: branding */}
        <div className="flex items-center gap-2">
          <Image src="/icon.png" alt="Actual Bench" height={24} width={24} className="object-contain" />
          <span className="text-sm font-semibold tracking-tight">
            Actual Bench
          </span>

          {activeInstance && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
                <ConnectionHealthDot />
                <span className="max-w-40 truncate text-muted-foreground">
                  {activeInstance.label}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80">
                {instances.map((instance) => (
                  <DropdownMenuItem
                    key={instance.id}
                    onClick={() => handleSwitchConnection(instance.id)}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{instance.label}</span>
                    {instance.id === activeInstance.id && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        active
                      </Badge>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => requestAction({ kind: "addConnection" })}>
                  Add connection…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => requestAction({ kind: "disconnect" })}
                  className="text-destructive"
                >
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {activeInstance && (activeInstance.apiVersion ?? activeInstance.serverVersion) && (
            <div
              className="inline-flex items-center gap-2 text-xs select-none"
              title="Server versions are fetched when the connection is established or reconnected."
              aria-label="Current server versions"
            >
              {activeInstance.apiVersion && (
                <TopBarVersionChip
                  label="API"
                  value={activeInstance.apiVersion}
                  title={`actual-http-api v${activeInstance.apiVersion}`}
                />
              )}
              {activeInstance.serverVersion && (
                <TopBarVersionChip
                  label="Actual"
                  value={activeInstance.serverVersion}
                  title={`Actual Budget v${activeInstance.serverVersion}`}
                />
              )}
            </div>
          )}
        </div>

        {/* Right: search + undo/redo + unsaved indicator + save/discard */}
        <div className="flex items-center gap-1">
          {activeInstance && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={openSearch}
              title={`Search (${searchShortcutLabel})`}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden sm:inline pointer-events-none rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                {searchShortcutLabel}
              </kbd>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canUndo}
            onClick={isBudgetPage ? budgetUndo : stagedUndo}
            title="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canRedo}
            onClick={isBudgetPage ? budgetRedo : stagedRedo}
            title="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isRefreshing}
            onClick={handleRefresh}
            title="Refresh data from server"
          >
            <RefreshCw className={`h-3.5 w-3.5${isRefreshing ? " animate-spin" : ""}`} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={!hasChanges}
            onClick={() => {
              handleDiscardAll();
              if (!isBudgetPage) void queryClient.resetQueries();
            }}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Discard
          </Button>

          {isBudgetPage && budgetSaveReviewSkipped && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleResetBudgetSaveReview}
              title="Show the budget save review dialog before saving again"
            >
              Reset review
            </Button>
          )}

          <Button
            size="sm"
            className={cn(
              "h-7 text-xs bg-action text-action-foreground hover:bg-action-hover",
              hasChanges && !isSaving && "ring-2 ring-offset-1 ring-action/50"
            )}
            disabled={saveDisabled}
            onClick={handleSave}
            title={isOffline ? "Cannot save — server is unreachable" : undefined}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {budgetSaveReviewEdits !== null && (
        <BudgetSaveReviewDialog
          edits={budgetSaveReviewEdits}
          holds={budgetSaveReviewHolds}
          onCancel={() => {
            setBudgetSaveReviewEdits(null);
            setBudgetSaveReviewHolds({});
          }}
          onConfirm={(skipReviewNextTime) => {
            if (skipReviewNextTime) {
              writeBudgetSaveReviewSkip(true);
              setBudgetSaveReviewSkipped(true);
            }
            setBudgetSaveEdits(budgetSaveReviewEdits);
            setBudgetSaveHolds(budgetSaveReviewHolds);
            setBudgetSaveReviewEdits(null);
            setBudgetSaveReviewHolds({});
          }}
        />
      )}

      {budgetSaveEdits !== null && (
        <BudgetSaveProgressDialog
          edits={budgetSaveEdits}
          holds={budgetSaveHolds}
          onClose={() => {
            setBudgetSaveEdits(null);
            setBudgetSaveHolds({});
          }}
        />
      )}

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have unsaved staged edits. This action will discard them permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDiscard}>
              Discard & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
