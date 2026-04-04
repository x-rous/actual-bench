"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Save, X, Undo2, Redo2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useSavedServersStore } from "@/store/savedServers";
import {
  useStagedStore,
  selectHasChanges,
  selectCanUndo,
  selectCanRedo,
} from "@/store/staged";
import { useAccountsSave } from "@/features/accounts/hooks/useAccountsSave";
import { usePayeesSave } from "@/features/payees/hooks/usePayeesSave";
import { useCategoryGroupsSave } from "@/features/categories/hooks/useCategoryGroupsSave";
import { useCategoriesSave } from "@/features/categories/hooks/useCategoriesSave";
import { useRulesSave } from "@/features/rules/hooks/useRulesSave";

export function TopBar() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const activeInstance = useConnectionStore(selectActiveInstance);
  const instances = useConnectionStore((s) => s.instances);
  const setActive = useConnectionStore((s) => s.setActiveInstance);
  const clearAll = useConnectionStore((s) => s.clearAll);
  const clearServers = useSavedServersStore((s) => s.clearServers);


  const hasChanges = useStagedStore(selectHasChanges);
  const canUndo = useStagedStore(selectCanUndo);
  const canRedo = useStagedStore(selectCanRedo);
  const undo = useStagedStore((s) => s.undo);
  const redo = useStagedStore((s) => s.redo);
  const discardAll = useStagedStore((s) => s.discardAll);
  const clearHistory = useStagedStore((s) => s.clearHistory);

  const { save: saveAccounts, isSaving: isSavingAccounts } = useAccountsSave();
  const { save: savePayees, isSaving: isSavingPayees } = usePayeesSave();
  const { save: saveCategoryGroups, isSaving: isSavingGroups } = useCategoryGroupsSave();
  const { save: saveCategories, isSaving: isSavingCategories } = useCategoriesSave();
  const { save: saveRules, isSaving: isSavingRules } = useRulesSave();
  const isSaving = isSavingAccounts || isSavingPayees || isSavingGroups || isSavingCategories || isSavingRules;

  async function handleSave() {
    try {
      // Step 1: Save accounts, payees, and category groups in parallel.
      // These are independent and their server IDs are needed by later steps.
      const [accountsResult, payeesResult, groupsResult] = await Promise.all([
        saveAccounts(),
        savePayees(),
        saveCategoryGroups(),
      ]);

      // Step 2: Save categories after groups. Pass the group idMap so that new
      // categories whose groupId is a client UUID get the real server group ID.
      const categoriesResult = await saveCategories(groupsResult.idMap);

      // Step 3: Save rules last, substituting any client UUIDs that appear in
      // conditions/actions with the server-assigned IDs from steps 1–2.
      const entityIdMap = {
        ...payeesResult.idMap,
        ...accountsResult.idMap,
        ...categoriesResult.idMap,
      };
      const rulesResult = await saveRules(entityIdMap);

      const totalSucceeded =
        accountsResult.succeeded.length +
        payeesResult.succeeded.length +
        groupsResult.succeeded.length +
        categoriesResult.succeeded.length +
        rulesResult.succeeded.length;
      const totalFailed =
        accountsResult.failed.length +
        payeesResult.failed.length +
        groupsResult.failed.length +
        categoriesResult.failed.length +
        rulesResult.failed.length;
      clearHistory();
      if (totalFailed === 0) {
        toast.success(`Saved ${totalSucceeded} item${totalSucceeded !== 1 ? "s" : ""} successfully.`);
      } else {
        toast.error(`${totalSucceeded} saved, ${totalFailed} failed.`);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message :
        (typeof err === "object" && err !== null && "message" in err)
          ? String((err as { message: unknown }).message)
          : "Save failed.";
      toast.error(msg);
    }
  }

  function handleSwitchConnection(id: string) {
    if (id === activeInstance?.id) return;
    discardAll();
    queryClient.clear();
    setActive(id);
  }

  function handleRefresh() {
    if (hasChanges) {
      toast.warning("Unsaved changes will be lost.", {
        action: {
          label: "Discard & Refresh",
          onClick: async () => {
            discardAll();
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

  function handleDisconnect() {
    discardAll();
    queryClient.clear();
    clearAll();
    clearServers();
    router.push("/connect");
  }

  return (
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
              <DropdownMenuItem onClick={() => router.push("/connect")}>
                Add connection…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDisconnect}
                className="text-destructive"
              >
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {activeInstance && (activeInstance.apiVersion ?? activeInstance.serverVersion) && (
          <div className="flex items-center gap-2 text-xs select-none">
            {activeInstance.apiVersion && (
              <span className="px-3 py-1.5 rounded-md bg-muted text-muted-foreground">
              actual-http-api v{activeInstance.apiVersion}
              </span>
            )}
            {activeInstance.serverVersion && (
              <span className="px-3 py-1.5 rounded-md bg-muted text-muted-foreground">
              actual budget v{activeInstance.serverVersion}
              </span>
            )}
          </div>
        )}

      </div>

      {/* Right: undo/redo + unsaved indicator + save/discard */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!canUndo}
          onClick={undo}
          title="Undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!canRedo}
          onClick={redo}
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
          onClick={() => { discardAll(); queryClient.resetQueries(); }}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Discard
        </Button>

        <Button
          size="sm"
          className={cn(
            "h-7 text-xs bg-action text-action-foreground hover:bg-action-hover",
            hasChanges && !isSaving && "ring-2 ring-offset-1 ring-action/50"
          )}
          disabled={!hasChanges || isSaving}
          onClick={handleSave}
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </header>
  );
}
