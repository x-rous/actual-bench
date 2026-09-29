"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { archiveDebt, getDebt, listDebts } from "../lib/debtsApi";
import { newDebtState, stateFromDetail } from "../lib/editorModel";
import { useAccountDirectory, useActiveBudgetSyncId } from "../lib/useAccountDirectory";
import { AssetsDebtTabs } from "./AssetsDebtTabs";
import { CalculationBasis } from "./CalculationBasis";
import { CalculatorView } from "./calculator/CalculatorView";
import { DebtList } from "./DebtList";
import { DebtEditor } from "./editor/DebtEditor";

/**
 * The Assets & Debt pages (RD-084 P1.3). Configuration, calculation and
 * forecasts only: matching, lender statements, postings and automation arrive
 * in later phases, and nothing on these pages writes to Actual.
 */

function Shell({ title, actions, children, scrollManaged }: { title: string; actions?: React.ReactNode; children: React.ReactNode; scrollManaged?: boolean }) {
  return (
    <PageLayout title={title} actions={actions} scrollManaged={scrollManaged}>
      <div className="flex min-h-0 flex-1 flex-col">
        <AssetsDebtTabs />
        {children}
      </div>
    </PageLayout>
  );
}

function NoConnection() {
  return <p className="px-4 py-6 text-sm text-muted-foreground">Connect to a budget to set up its debts.</p>;
}

export function AssetsDebtOverview() {
  const budgetSyncId = useActiveBudgetSyncId();
  const debts = useQuery({ queryKey: ["assets-debt", "debts", budgetSyncId], queryFn: () => listDebts(budgetSyncId!), enabled: !!budgetSyncId });
  const all = debts.data ?? [];
  const blocked = all.filter((d) => d.blocked).length;
  return (
    <Shell title="Assets & Debt">
      {!budgetSyncId ? (
        <NoConnection />
      ) : (
        <div className="flex flex-col gap-2 px-4 py-4 text-sm">
          <p>
            {all.length === 0 ? "No debts are set up for this budget yet." : `${all.length} debt${all.length === 1 ? "" : "s"} set up, ${all.filter((d) => d.status === "active").length} active.`}
            {blocked ? ` ${blocked} blocked: configured by a newer version of Actual Bench.` : ""}
          </p>
          <p className="text-muted-foreground">Set up how each lender calculates a loan, check the calculation basis, and forecast the balance. Posting to Actual comes later and always starts with a review.</p>
          <Link href="/assets-debt/loans" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
            Go to Loans & Debt
          </Link>
        </div>
      )}
    </Shell>
  );
}

export function DebtListView() {
  const budgetSyncId = useActiveBudgetSyncId();
  const [includeArchived, setIncludeArchived] = useState(false);
  const debts = useQuery({ queryKey: ["assets-debt", "debts", budgetSyncId, includeArchived], queryFn: () => listDebts(budgetSyncId!, includeArchived), enabled: !!budgetSyncId });
  return (
    <Shell
      title="Assets & Debt"
      scrollManaged
      actions={
        <Link href="/assets-debt/loans/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> New debt
        </Link>
      }
    >
      {!budgetSyncId ? (
        <NoConnection />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <Checkbox id="include-archived" checked={includeArchived} onCheckedChange={(v) => setIncludeArchived(v === true)} />
            <Label htmlFor="include-archived" className="text-xs">Show archived debts</Label>
          </div>
          {debts.isLoading ? <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p> : null}
          {debts.isError ? <p role="alert" className="px-4 py-3 text-xs text-destructive">{(debts.error as Error).message}</p> : null}
          {debts.data && debts.data.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No debts yet. Add one to start.</p> : null}
          {debts.data && debts.data.length > 0 ? <DebtList debts={debts.data} /> : null}
        </div>
      )}
    </Shell>
  );
}

export function NewDebtView() {
  const budgetSyncId = useActiveBudgetSyncId();
  const directory = useAccountDirectory();
  const router = useRouter();
  return (
    <Shell title="New debt" scrollManaged>
      {!budgetSyncId ? (
        <NoConnection />
      ) : (
        <DebtEditor
          initial={newDebtState(budgetSyncId)}
          debtId={null}
          directory={directory.data}
          onSaved={(detail) => router.push(`/assets-debt/loans/${encodeURIComponent(detail.debt.id)}`)}
          onCancel={() => router.push("/assets-debt/loans")}
        />
      )}
    </Shell>
  );
}

const DETAIL_TABS = [
  { id: "settings", label: "Settings" },
  { id: "basis", label: "Calculation basis" },
  { id: "calculator", label: "Calculator & forecast" },
] as const;

export function DebtDetailView({ id }: { id: string }) {
  const debt = useQuery({ queryKey: ["assets-debt", "debt", id], queryFn: () => getDebt(id) });
  const directory = useAccountDirectory();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]["id"]>("settings");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const archive = useMutation({
    mutationFn: () => archiveDebt(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(debt.data?.debt.status === "draft" ? "Draft discarded" : "Debt archived");
      router.push("/assets-debt/loans");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not archive the debt"),
  });

  const detail = debt.data;
  const editorState = detail ? stateFromDetail(detail) : null;
  const isDraft = detail?.debt.status === "draft";
  return (
    <Shell
      title={detail ? detail.debt.name : "Debt"}
      scrollManaged
      actions={
        detail && detail.debt.status !== "archived" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setConfirm({
                title: isDraft ? "Discard this draft?" : "Archive this debt?",
                message: isDraft ? "The draft and its settings are removed." : "The debt keeps its history and revisions, and its liability account becomes free for a new debt. Nothing changes in Actual.",
                destructiveLabel: isDraft ? "Discard" : "Archive",
                onConfirm: () => archive.mutate(),
              })
            }
          >
            {isDraft ? "Discard draft" : "Archive"}
          </Button>
        ) : null
      }
    >
      {debt.isLoading ? <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p> : null}
      {debt.isError ? <p role="alert" className="px-4 py-3 text-xs text-destructive">{(debt.error as Error).message}</p> : null}
      {detail ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {detail.blocked ? (
            <p role="status" className="mx-4 mt-3 rounded border border-destructive/40 px-3 py-2 text-xs">
              <span className="font-semibold">Blocked:</span> {detail.blocked.message} Other debts are not affected.
            </p>
          ) : null}
          <div role="tablist" aria-label="Debt views" className="flex gap-1 border-b border-border px-4">
            {DETAIL_TABS.map((t, i) => (
              <button
                key={t.id}
                role="tab"
                id={`debt-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`debt-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={cn("border-b-2 border-transparent px-3 py-2 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t.id && "border-primary text-foreground")}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const next = e.key === "ArrowRight" ? (i + 1) % DETAIL_TABS.length : e.key === "ArrowLeft" ? (i - 1 + DETAIL_TABS.length) % DETAIL_TABS.length : null;
                  if (next === null) return;
                  e.preventDefault();
                  setTab(DETAIL_TABS[next].id);
                  document.getElementById(`debt-tab-${DETAIL_TABS[next].id}`)?.focus();
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`debt-panel-${tab}`} aria-labelledby={`debt-tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-auto">
            {tab === "settings" ? (
              detail.debt.status === "archived" ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">This debt is archived; its settings are kept for its history and can no longer be edited.</p>
              ) : editorState && !detail.blocked ? (
                <DebtEditor key={`${detail.debt.id}:${detail.debt.updatedAt}`} initial={editorState} debtId={detail.debt.id} directory={directory.data} onSaved={() => void debt.refetch()} />
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">These settings cannot be edited in this version of Actual Bench.</p>
              )
            ) : null}
            {tab === "basis" ? <CalculationBasis detail={detail} /> : null}
            {tab === "calculator" ? <CalculatorView detail={detail} /> : null}
          </div>
        </div>
      ) : null}
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} state={confirm} />
    </Shell>
  );
}

export function LaterPhaseView({ title, description }: { title: string; description: string }) {
  return (
    <Shell title="Assets & Debt">
      <section aria-label={title} className="px-4 py-6 text-sm">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </section>
    </Shell>
  );
}
