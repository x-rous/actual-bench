"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { listDebts } from "../lib/debtsApi";
import { useActiveBudgetSyncId } from "../lib/useAccountDirectory";
import { AssetsDebtTabs } from "./AssetsDebtTabs";
import { DebtList } from "./DebtList";

/**
 * The Assets & Debt workspace pages (RD-084 P1.3, P1.3b). The loan pages
 * themselves are the simulator (LoanPages.tsx). Configuration, calculation and
 * forecasts only: matching, lender statements, postings and automation arrive
 * in later phases, and nothing on these pages writes to Actual.
 */

export function AssetsDebtShell({ title, actions, children, scrollManaged = true }: { title: string; actions?: React.ReactNode; children: React.ReactNode; scrollManaged?: boolean }) {
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
    <AssetsDebtShell title="Assets & Debt">
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
    </AssetsDebtShell>
  );
}

export function DebtListView() {
  const budgetSyncId = useActiveBudgetSyncId();
  const [includeArchived, setIncludeArchived] = useState(false);
  const debts = useQuery({ queryKey: ["assets-debt", "debts", budgetSyncId, includeArchived], queryFn: () => listDebts(budgetSyncId!, includeArchived), enabled: !!budgetSyncId });
  return (
    <AssetsDebtShell
      title="Assets & Debt"
      scrollManaged
      actions={
        <Link href="/assets-debt/loans/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> New loan
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
    </AssetsDebtShell>
  );
}

export function LaterPhaseView({ title, description }: { title: string; description: string }) {
  return (
    <AssetsDebtShell title="Assets & Debt">
      <section aria-label={title} className="px-4 py-6 text-sm">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </section>
    </AssetsDebtShell>
  );
}
