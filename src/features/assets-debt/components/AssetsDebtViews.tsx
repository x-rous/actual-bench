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
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";
import { attentionText, hrefOf } from "../lib/attention";
import { listDebts, listNeedsAttention } from "../lib/debtsApi";
import { LOANS_PATH, NEW_LOAN_PATH } from "../lib/routes";
import { useActiveBudgetSyncId } from "../lib/useAccountDirectory";
import { DebtList, LoansSummary } from "./DebtList";

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
 * The Loans & Debt page (rev 4): one visual table row per loan, with a "Needs attention" filter in place of
 * the former global Activity page (`?filter=attention`). A row that needs attention opens where
 * it can be acted on.
 */
export function DebtListView() {
  const budgetSyncId = useActiveBudgetSyncId();
  const params = useSearchParams();
  const router = useRouter();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState("");
  const onlyAttention = params?.get("filter") === "attention";
  const debts = useQuery({ queryKey: ["assets-debt", "debts", budgetSyncId, includeArchived], queryFn: () => listDebts(budgetSyncId!, includeArchived), enabled: !!budgetSyncId });
  // The first thing each loan needs, from stored state only (no Actual read).
  const attention = useQuery({ queryKey: ["assets-debt", "attention", budgetSyncId], queryFn: () => listNeedsAttention(budgetSyncId!), enabled: !!budgetSyncId });
  const needing = (attention.data ?? []).filter((item) => item.reasons.length);
  const attentionById = Object.fromEntries(needing.map((item) => [item.id, attentionText(item.reasons[0])]));
  const hrefById = Object.fromEntries(needing.map((item) => [item.id, hrefOf(item)]));
  const query = search.trim().toLocaleLowerCase();
  const shown = (debts.data ?? []).filter((d) => (!onlyAttention || attentionById[d.id]) && (!query || d.name.toLocaleLowerCase().includes(query)));
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
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-1.5">
            <SearchInput value={search} onValueChange={setSearch} aria-label="Search loans" clearLabel="Clear loan search" />
            <div role="group" aria-label="Show">
              <PillGroup options={[{ value: "all", label: "All loans" }, { value: "attention", label: "Needs attention", count: needing.length }]} value={onlyAttention ? "attention" : "all"} onChange={(value) => setFilter(value === "attention")} />
            </div>
            <span className="flex items-center gap-2 px-1">
              <Checkbox id="include-archived" checked={includeArchived} onCheckedChange={(v) => setIncludeArchived(v === true)} />
              <Label htmlFor="include-archived" className="text-xs">Show archived loans</Label>
            </span>
            {query || onlyAttention ? <button type="button" onClick={() => { setSearch(""); setFilter(false); }} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Clear filters</button> : null}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
              {debts.data?.length ? <LoansSummary debts={debts.data} /> : null}
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{shown.length} of {debts.data?.length ?? 0}</span>
            </div>
          </div>
          {debts.isLoading ? <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p> : null}
          {debts.isError ? <p role="alert" className="px-4 py-3 text-xs text-destructive">{(debts.error as Error).message}</p> : null}
          {debts.data && debts.data.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No loans yet. Add one to start.</p> : null}
          {debts.data && debts.data.length > 0 && shown.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">{query ? "No loans match these filters." : "Nothing needs your attention."}</p> : null}
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
