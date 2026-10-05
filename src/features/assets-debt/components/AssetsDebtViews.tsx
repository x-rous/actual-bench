"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { attentionText, hrefOf } from "../lib/attention";
import { listDebts, listNeedsAttention } from "../lib/debtsApi";
import { LOANS_PATH, NEW_LOAN_PATH } from "../lib/routes";
import { useActiveBudgetSyncId } from "../lib/useAccountDirectory";
import { DebtList } from "./DebtList";

/**
 * The Assets & Debt workspace pages (RD-084 P1.3, P1.3b). The loan pages
 * themselves are the simulator (LoanPages.tsx). Configuration, calculation and
 * forecasts plus P1.4 read-only matching. Lender statements, postings and
 * automation arrive in later phases, and nothing on these pages writes to Actual.
 */

export function AssetsDebtShell({ title, actions, children, scrollManaged = true }: { title: string; actions?: React.ReactNode; children: React.ReactNode; scrollManaged?: boolean }) {
  return (
    <PageLayout title={title} actions={actions} scrollManaged={scrollManaged}>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </PageLayout>
  );
}

/**
 * Inside a loan (T288): the workspace replaces the page title with its own header and back link.
 */
export function LoanWorkspaceShell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
}

function NoConnection() {
  return <p className="px-4 py-6 text-sm text-muted-foreground">Connect to a budget to set up its loans.</p>;
}

/**
 * The Loans & Debt page (rev 4): one card per loan, with a "Needs attention" filter in place of
 * the former global Activity page (`?filter=attention`). A card that needs attention opens where
 * it can be acted on.
 */
export function DebtListView() {
  const budgetSyncId = useActiveBudgetSyncId();
  const params = useSearchParams();
  const router = useRouter();
  const [includeArchived, setIncludeArchived] = useState(false);
  const onlyAttention = params?.get("filter") === "attention";
  const debts = useQuery({ queryKey: ["assets-debt", "debts", budgetSyncId, includeArchived], queryFn: () => listDebts(budgetSyncId!, includeArchived), enabled: !!budgetSyncId });
  // The first thing each loan needs, from stored state only (no Actual read).
  const attention = useQuery({ queryKey: ["assets-debt", "attention", budgetSyncId], queryFn: () => listNeedsAttention(budgetSyncId!), enabled: !!budgetSyncId });
  const needing = (attention.data ?? []).filter((item) => item.reasons.length);
  const attentionById = Object.fromEntries(needing.map((item) => [item.id, attentionText(item.reasons[0])]));
  const hrefById = Object.fromEntries(needing.map((item) => [item.id, hrefOf(item)]));
  const shown = (debts.data ?? []).filter((d) => !onlyAttention || attentionById[d.id]);
  const setFilter = (on: boolean) => router.replace(on ? `${LOANS_PATH}?filter=attention` : LOANS_PATH);
  return (
    <AssetsDebtShell
      title="Loans & Debt"
      scrollManaged
      actions={
        <Link href={NEW_LOAN_PATH} className={buttonVariants({ size: "sm" })}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> New loan
        </Link>
      }
    >
      {!budgetSyncId ? (
        <NoConnection />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div role="group" aria-label="Show" className="inline-flex gap-0.5 rounded-lg border border-border p-0.5">
              <button type="button" aria-pressed={!onlyAttention} onClick={() => setFilter(false)} className={cn("rounded-md px-3 py-1 text-xs", !onlyAttention ? "bg-foreground text-background" : "hover:bg-muted")}>All loans</button>
              <button type="button" aria-pressed={onlyAttention} onClick={() => setFilter(true)} className={cn("rounded-md px-3 py-1 text-xs", onlyAttention ? "bg-foreground text-background" : "hover:bg-muted")}>Needs attention {needing.length}</button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Checkbox id="include-archived" checked={includeArchived} onCheckedChange={(v) => setIncludeArchived(v === true)} />
              <Label htmlFor="include-archived" className="text-xs">Show archived loans</Label>
            </div>
          </div>
          {debts.isLoading ? <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p> : null}
          {debts.isError ? <p role="alert" className="px-4 py-3 text-xs text-destructive">{(debts.error as Error).message}</p> : null}
          {debts.data && debts.data.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No loans yet. Add one to start.</p> : null}
          {debts.data && debts.data.length > 0 && shown.length === 0 ? <p className="mx-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing needs your attention.</p> : null}
          {shown.length > 0 ? <DebtList debts={shown} attention={attentionById} hrefs={hrefById} /> : null}
        </div>
      )}
    </AssetsDebtShell>
  );
}

export function LaterPhaseView({ title, description }: { title: string; description: string }) {
  return (
    <AssetsDebtShell title={title}>
      <section aria-label={title} className="px-4 py-6 text-sm">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </section>
    </AssetsDebtShell>
  );
}
