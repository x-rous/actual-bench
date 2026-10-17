"use client";
import { PlanEditor } from "./PlanEditor";
import { HowToUse } from "./HowToUse";
import { statementHealth } from "../lib/statementHealth";

import { formatCardDate } from "../lib/displayDates";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { ArrowLeft, CreditCard as CardIcon, Plus, RefreshCw, Settings, Undo2, CheckCircle2, AlertCircle } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageLayout } from "@/components/layout/PageLayout";
import { useConnectionStore, selectActiveInstance, type ConnectionInstance } from "@/store/connection";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { getTransport } from "@/lib/actual";
import { creditCardStore, EMPTY_WORKSPACE } from "../lib/memory";
import { eligibleCardAccount } from "../lib/ledger";
import { useCreditCardDirectory, useCreditCardCategories } from "../hooks/useCreditCardDirectory";
import { useCreditCardActivities, useCreditCardTracking } from "../hooks/useCreditCardActivity";
import { CardEditor, StatementEditor } from "./CardEditors";
import { ReviewText } from "./ReviewText";
import { CardOverview } from "./CardOverview";
import { DebtHistory } from "./DebtHistory";
import { BalanceHistory } from "./BalanceHistory";
import { PortfolioOverview, PortfolioSort } from "./PortfolioOverview";
import { StatementsList } from "./StatementsList";
import { PaymentsList } from "./PaymentsList";
import { CardMark } from "./CardIdentity";
import { StatementReview } from "./StatementReview";
import { PaymentDetails } from "./PaymentDetails";
import { ActivityTable } from "./ActivityTable";
import { asOfCardBalance } from "../lib/financialAdapter";
import { Status } from "./WorkspaceVisuals";
import { bankToday, type StatementDraft } from "../lib/cycles";
import { statementDrafts, statementReview, previewStatements } from "../lib/statements";
import { latestStatement, settlements, matchedPaymentStatement } from "../lib/repayments";
import { activityKind } from "../lib/activity";
import type { Statement, Workspace } from "../lib/models";

function ConnectedWorkspace({ connection }: { connection: ConnectionInstance }) {
  const budget = connection.budgetSyncId;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const savedWorkspace = useStore(creditCardStore, (state) => state.workspaces[budget] ?? EMPTY_WORKSPACE);
  const notice = useStore(creditCardStore, (state) => state.notices[budget]);
  const canUndo = useStore(creditCardStore, (state) => Boolean(state.undoHistory[budget]?.length));
  const directory = useCreditCardDirectory(connection);
  const workspace = useMemo(() => ({ ...savedWorkspace, cards: savedWorkspace.cards.map((entry) => ({ ...entry, nickname: directory.data?.accounts.find((account) => account.id === entry.accountId)?.name ?? entry.nickname })) }), [savedWorkspace, directory.data?.accounts]);
  const classes = useAccountClasses();
  const queryClient = useQueryClient();
  const classKey = ["accountClasses", budget];
  const classesRefreshing = useIsFetching({ queryKey: classKey, exact: true }) > 0;
  const refreshingLock = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const activityQueries = useCreditCardActivities(connection, workspace.cards, workspace.statements);
  const trackingQueries = useCreditCardTracking(connection, workspace.plans, workspace.cards.map((entry) => bankToday(entry.bankTimeZone)).sort().at(-1) ?? bankToday("UTC"));
  const sources = activityQueries.map((entry) => entry.data ? { ...entry.data, accounts: directory.data?.accounts,
    trackingAccounts: trackingQueries.flatMap((query) => {
      const data = query.data, balance = data && directory.data?.balances.get(data.accountId);
      return data && !query.isFetching && !query.isError ? [{ accountId: data.accountId, rows: data.rows, counterparts: data.counterparts, issues: data.issues, to: data.to, signedBalanceMinor: balance ? asOfCardBalance(balance, data.futureDeltaMinor, connection.mode === "browser-api", data.directBalanceAdjustmentMinor).signedBalanceMinor : undefined }] : [];
    }),
  } : undefined);
  const [statementAction, setStatementAction] = useState<{ kind: "reset" | "delete"; statement: Statement } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<"add" | "settings" | "statement" | "plan" | null>(null);
  const categories = useCreditCardCategories(connection, editor === "add" || editor === "settings");
  const categoryOptions = categories.data?.categories.map((entry) => ({ id: entry.id, name: entry.name })).sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  const [editingStatement, setEditingStatement] = useState<Statement | undefined>();
  const [suggested, setSuggested] = useState<StatementDraft | undefined>();
  const [focusStatementId, setFocusStatementId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [portfolioSort, setPortfolioSort] = useState<"due" | "debt" | "name">("due");
  const [attentionOnly, setAttentionOnly] = useState(0);
  const card = workspace.cards.find((entry) => entry.id === selectedId);
  const bank = card ? latestStatement(workspace.statements.filter((entry) => entry.bankConfirmed), card.id) : undefined;
  const query = activityQueries[workspace.cards.findIndex((entry) => entry.id === selectedId)];
  const snapshot = sources[workspace.cards.findIndex((entry) => entry.id === selectedId)];
  const accounts = directory.data?.accounts ?? [];
  const available = !refreshing && !refreshError && !directory.isFetching && !directory.isError && Boolean(directory.data) && classes.available && !classesRefreshing;
  const activityAvailable = available && Boolean(snapshot) && !query?.isFetching && !query?.isError;
  const eligible = available ? accounts.filter((account) => eligibleCardAccount(account, classes.maps)) : [];
  const unregistered = eligible.filter((account) => !workspace.cards.some((entry) => entry.accountId === account.id));
  const cardEligible = Boolean(card && eligible.some((account) => account.id === card.accountId));
  // Current debt needs both the ledger balance and its future-entry adjustment.
  // Hide unavailable pairs consistently in the portfolio, card and projection anchors.
  const balances = new Map(workspace.cards.flatMap((entry, index) => {
    const source = activityQueries[index];
    const live = directory.data?.balances.get(entry.accountId);
    const cutoffSafe = connection.mode === "browser-api" && bankToday(entry.bankTimeZone) === bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
    return available && live && (cutoffSafe || source?.data && !source.isFetching && !source.isError && !source.data.issues.length)
      ? [[entry.accountId, asOfCardBalance(live, source?.data?.futureDeltaMinor, connection.mode === "browser-api", source?.data?.directBalanceAdjustmentMinor)] as const] : [];
  }));
  const balance = card ? balances.get(card.accountId) : undefined;
  const today = card ? bankToday(card.bankTimeZone) : bankToday("UTC");
  const drafts = card && snapshot && balance && activityAvailable ? statementDrafts(card, today, undefined, snapshot, balance.rawSignedBalanceMinor, workspace.statements).filter((draft) => !workspace.statements.some((entry) => entry.cardId === card.id && !(entry.closingDate < draft.periodStart || entry.periodStart > draft.closingDate))) : [];
  const statementWorkspace = { ...workspace, statements: [...workspace.statements, ...previewStatements(card?.id ?? "", drafts)] };
  const statuses = card && snapshot && activityAvailable ? settlements(card, statementWorkspace, snapshot, today) : [];
  const nextPayment = bank ? statuses.find((entry) => entry.statementId === bank.id) : undefined;
  const selectedReview = workspace.statements.find((entry) => entry.id === reviewId && entry.cardId === card?.id);
  const selectedPayment = snapshot?.rows.find((entry) => entry.id === paymentId);
  const sourceText = refreshing ? "Syncing and refreshing Actual data…" : directory.isFetching ? "Refreshing Actual data…" : directory.isError ? "Actual data unavailable. Bank facts remain available; retry with Refresh." : activityQueries.some((entry) => entry.isFetching) ? "Reading card activity…" : directory.data ? `Actual data read ${new Date(directory.data.fetchedAt).toLocaleTimeString()}` : "Loading Actual data…";
  const verificationHealth = workspace.statements.filter((entry) => !card || entry.cardId === card.id).reduce((counts, entry) => {
    const source = activityQueries[workspace.cards.findIndex((item) => item.id === entry.cardId)];
    const health = statementHealth(entry, workspace, source?.data, available && Boolean(source?.data) && !source?.isFetching && !source?.isError);
    if (health.key === "unavailable") counts.unavailable++;
    else if (health.key === "changed") counts.changed++;
    else if (health.key === "verified") counts.verified++;
    else if (health.issue) counts.review++;
    return counts;
  }, { changed: 0, review: 0, unavailable: 0, verified: 0 });
  const trendStatements = workspace.cards.flatMap((entry, index) => {
    const source = activityQueries[index]?.data;
    const live = directory.data?.balances.get(entry.accountId);
    const confirmed = workspace.statements.filter((statement) => statement.cardId === entry.id);
    const estimates = available && source && live && !activityQueries[index]?.isFetching && !activityQueries[index]?.isError ? statementDrafts(entry, bankToday(entry.bankTimeZone), undefined, source, asOfCardBalance(live, source.futureDeltaMinor, connection.mode === "browser-api").rawSignedBalanceMinor, workspace.statements).filter((draft) => !confirmed.some((statement) => !(statement.closingDate < draft.periodStart || statement.periodStart > draft.closingDate))) : [];
    return [...confirmed, ...previewStatements(entry.id, estimates)];
  });
  const openStatement = (statement?: Statement, draft?: StatementDraft) => { setEditingStatement(statement); setSuggested(draft); setEditor("statement"); };
  const selectCard = (id: string | null) => { setFocusStatementId(null); setSelectedId(id); setAttentionOnly(0); setReviewId(null); setPaymentId(null); setTab("overview"); };
  async function refresh() {
    if (refreshingLock.current) return;
    refreshingLock.current = true; setRefreshing(true); setRefreshError(null);
    try {
      await getTransport(connection).sync();
      const results = await Promise.allSettled([directory.refetch(), queryClient.refetchQueries({ queryKey: classKey, exact: true }, { throwOnError: true }), ...activityQueries.map((entry) => entry.refetch()), ...trackingQueries.map((entry) => entry.refetch()), ...(categories.data ? [categories.refetch()] : [])]);
      if (results.some((result) => result.status === "rejected" || (result.value && "isError" in result.value && result.value.isError))) setRefreshError("Actual data could not be refreshed completely. Retry Refresh; your bank facts and drafts are retained.");
    } catch { setRefreshError("Actual sync failed. Retry Refresh; your bank facts and drafts are retained."); }
    finally { refreshingLock.current = false; setRefreshing(false); }
  }
  const actions = <>

    {!card && workspace.cards.length > 0 && <PortfolioSort value={portfolioSort} onChange={setPortfolioSort} />}
    <span role="status" title={sourceText} className="max-w-64 truncate self-center text-xs text-muted-foreground">{sourceText}</span>
    <Tooltip.Root><Tooltip.Trigger render={<Button variant="outline" size="icon-sm" aria-label="Undo" focusableWhenDisabled disabled={!canUndo || editor !== null || reviewId !== null || paymentId !== null} onClick={() => creditCardStore.getState().undo(budget)} />}><Undo2 className="size-3.5" /></Tooltip.Trigger><Tooltip.Portal><Tooltip.Positioner side="bottom" sideOffset={6} className="z-[80]"><Tooltip.Popup role="tooltip" className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">Undo last workspace change</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>
    <Button variant="outline" size="sm" onClick={() => { void refresh(); }} disabled={refreshing || directory.isFetching || activityQueries.some((entry) => entry.isFetching)}><RefreshCw className="size-3.5" />Refresh</Button>
    {card ? <Button variant="outline" size="sm" onClick={() => setEditor("settings")}><Settings className="size-3.5" />Settings</Button> : workspace.cards.length > 0 && <Button size="sm" onClick={() => setEditor("add")} disabled={!available || unregistered.length === 0}><Plus className="size-3.5" />Add card</Button>}
    {card && !selectedReview && <Button variant="outline" size="sm" disabled={!activityAvailable || !snapshot || !cardEligible} onClick={() => setEditor("plan")}><Plus className="size-3.5" aria-hidden />Add plan</Button>}
    <HowToUse onSetup={() => setEditor(card ? "settings" : "add")} onStatements={card ? () => { setReviewId(null); setTab("statements"); } : undefined} onClassifications={card ? () => { setReviewId(null); setTab("activity"); } : undefined} onPlans={card ? () => { setReviewId(null); setTab("overview"); if (workspace.plans?.some((plan) => plan.cardId === card.id)) requestAnimationFrame(() => document.getElementById("card-plans")?.scrollIntoView({ block: "center" })); else if (activityAvailable && snapshot) setEditor("plan"); } : undefined} />
  </>;

  const tableStatements = card ? [...workspace.statements.filter((entry) => entry.cardId === card.id), ...previewStatements(card.id, drafts)] : [];
  const awaitingStatement = [...tableStatements].filter((entry) => !entry.bankConfirmed).sort((a, b) => a.closingDate.localeCompare(b.closingDate))[0];
  const confirmNextStatement = () => { if (!awaitingStatement) return; const draft = drafts.find((entry) => entry.closingDate === awaitingStatement.closingDate); openStatement(draft ? undefined : awaitingStatement, draft); };
  const tablePayments = (snapshot?.rows ?? []).filter((row) => row.amountMinor > 0 && row.transferId && card && snapshot && activityKind(row, card, workspace, snapshot) === "payment").map((row) => ({ row, matchedStatement: activityAvailable ? matchedPaymentStatement(row.date, statementWorkspace.statements, statuses) : undefined }));
  const workspaceHeader = useRef<HTMLElement>(null);
  function closeReview() { setReviewId(null); requestAnimationFrame(() => workspaceHeader.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()); }
  function showStatement(id?: string) { setFocusStatementId(id ?? null); setAttentionOnly(0); setTab("statements"); }
  useEffect(() => { if (!workspace.cards.length) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [workspace.cards.length]);
  const tableView = Boolean(card && (tab === "statements" || tab === "payments" || tab === "activity"));
  const healthDetail = `${verificationHealth.verified} verified · ${verificationHealth.changed} source changed · ${verificationHealth.review} need review · ${verificationHealth.unavailable} awaiting source`;
  const healthIssues = verificationHealth.changed + verificationHealth.review;
  const confirmationCount = trendStatements.filter((entry) => (!card || entry.cardId === card.id) && !entry.bankConfirmed).length;
  const [dismissedFeedback, setDismissedFeedback] = useState<{ notice: string; workspace: Workspace } | null>(null);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setDismissedFeedback({ notice, workspace }), 6000); return () => clearTimeout(timer); }, [notice, workspace]);
  const statusDisplay = <div className="flex min-w-0 items-center gap-3 whitespace-nowrap text-xs">
    {notice && (notice !== dismissedFeedback?.notice || workspace !== dismissedFeedback.workspace) && <p role="status" title={`Latest workspace action: ${notice}`} className="flex max-w-64 items-center gap-1.5 truncate"><CheckCircle2 className="size-3.5 shrink-0 text-green-700 dark:text-green-400" aria-hidden /><span className="truncate">{notice}</span></p>}
    {(healthIssues > 0 || verificationHealth.unavailable > 0) && workspace.statements.some((entry) => entry.bankConfirmed && (!card || entry.cardId === card.id)) && <div className="flex items-center gap-1">{card && healthIssues > 0 ? <Button size="xs" variant="link" className="h-auto p-0 text-xs" onClick={() => { setAttentionOnly((request) => request + 1); setTab("statements"); }}> {healthIssues} {healthIssues === 1 ? "statement needs" : "statements need"} review</Button> : null}<ReviewText className="w-auto text-muted-foreground" text={card && healthIssues > 0 ? "Details" : healthIssues ? `${healthIssues} ${healthIssues === 1 ? "statement needs" : "statements need"} review` : verificationHealth.unavailable ? "Activity unavailable" : ""} label="saved statement health" detail={healthDetail} /></div>}
    {confirmationCount > 0 && <span className="text-muted-foreground">{confirmationCount} awaiting confirmation</span>}
  </div>;
  function applyStatementAction() {
    if (!statementAction) return;
    try {
      const { statement, kind } = statementAction;
      if (kind === "reset") creditCardStore.getState().resetReview(budget, statement.id, statement.revision);
      else creditCardStore.getState().deleteStatement(budget, statement.id, statement.revision);
      setStatementAction(null);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not update the statement"); }
  }

  return <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 overflow-hidden"><PageLayout scrollManaged header={selectedReview ? <></> : <header ref={workspaceHeader} aria-label="Credit card workspace" className="shrink-0 border-b border-border">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"><div className="flex min-w-0 items-center gap-2">{card && <Button variant="ghost" size="xs" disabled={reviewId !== null} onClick={() => { setSelectedId(null); setReviewId(null); }}><ArrowLeft className="size-3.5" />All cards</Button>}{card && <CardMark card={card} />}<h1 ref={headingRef} tabIndex={-1} className="truncate text-sm font-semibold">{card?.nickname ?? "Credit Cards"}</h1>{!card && <span className="text-xs text-muted-foreground">{workspace.cards.length} registered</span>}{!card && statusDisplay}{card && <>{card.status !== "active" && <Status>Inactive</Status>}</>}</div><div className="flex min-w-0 flex-wrap gap-2">{actions}</div></div>
    {card && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4"><TabsList className="max-w-full overflow-x-auto border-0 px-0"><TabsTrigger className="shrink-0 whitespace-nowrap" disabled={reviewId !== null} value="overview">Overview</TabsTrigger><TabsTrigger className="shrink-0 whitespace-nowrap" disabled={reviewId !== null} value="statements">Statements<span aria-hidden="true" className="ml-1 rounded border px-1 text-xs text-muted-foreground">{tableStatements.length}</span></TabsTrigger><TabsTrigger className="shrink-0 whitespace-nowrap" disabled={reviewId !== null} value="payments">Payments<span aria-hidden="true" className="ml-1 rounded border px-1 text-xs text-muted-foreground">{tablePayments.length}</span></TabsTrigger><TabsTrigger className="shrink-0 whitespace-nowrap" disabled={reviewId !== null} value="debt">Debt & history</TabsTrigger><TabsTrigger className="shrink-0 whitespace-nowrap" value="activity">Activity</TabsTrigger></TabsList><div className="ml-auto py-1">{statusDisplay}</div></div>}
  </header>}>
    {selectedReview && snapshot ? <StatementReview key={selectedReview.id} budget={budget} statement={selectedReview} workspace={workspace} snapshot={snapshot} available={activityAvailable} workspaceActions={actions} onClose={closeReview} onMappings={() => setEditor("settings")} /> : <div className={tableView ? "flex min-h-0 flex-1 flex-col overflow-hidden text-sm" : workspace.cards.length === 0 ? "flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 text-sm" : "min-h-0 flex-1 overflow-auto text-sm"}>
      {(refreshError || directory.isError) && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm"><p>{refreshError ?? "Couldn’t read Actual data. Saved bank facts are retained; source-dependent amounts remain unavailable."}</p><Button variant="outline" size="sm" onClick={() => { void refresh(); }}>Retry refresh</Button></div>}
      {!classes.available && <p className="text-xs text-muted-foreground">Account classification is loading or unavailable. Registration is available once classifications load.</p>}
      {card ? <>
        {!refreshing && !refreshError && !directory.isFetching && !classesRefreshing && classes.available && !cardEligible && <p className="rounded-lg border border-border p-4 text-xs">This account is unavailable, closed, off-budget or no longer classified as Credit Card. Review its classification in Accounts; existing statements are retained.</p>}
        {query?.isError && <p role="status" className="rounded-lg border border-border p-4 text-xs">Card activity is unavailable. Refresh to retry; saved bank facts and review drafts are retained.</p>}
        {snapshot?.issues.length ? <p className="rounded-lg border border-border p-4 text-xs">Some Actual transaction structures are incomplete. Review is required before confirming settlement.</p> : null}
          <TabsContent value="overview" className="space-y-0">
            <CardOverview key={card.id} budget={budget} card={card} bank={bank} payment={nextPayment} balance={balance} workspace={workspace} snapshot={snapshot} today={today} available={activityAvailable} awaitingStatement={awaitingStatement} onConfirmDraft={confirmNextStatement} onSettings={() => setEditor("settings")} statements={tableStatements} statuses={statuses} onStatements={showStatement} onPayments={() => setTab("payments")} onPayment={setPaymentId} />
            {(workspace.statements.some((entry) => entry.cardId === card.id && (entry.verification === "needs-review" || (entry.reviewedSnapshot && snapshot && statementReview(entry, workspace, snapshot).stale))) || (bank && snapshot && !bank.openingAnchor && !statementReview(bank, workspace, snapshot).canVerify)) && <section className="mx-5 mb-5 space-y-2 rounded-lg border bg-background p-4"><h2 className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4 text-muted-foreground" aria-hidden="true" />Needs attention</h2>
              {bank && snapshot && !bank.openingAnchor && bank.verification !== "needs-review" && !statementReview(bank, workspace, snapshot).stale && !statementReview(bank, workspace, snapshot).canVerify && <div className="flex items-center justify-between"><p className="text-xs">Latest statement membership or balance needs review.</p><Button size="sm" variant="outline" onClick={() => { setReviewId(bank.id); setTab("statements"); }}>Review latest statement</Button></div>}
              {workspace.statements.filter((entry) => entry.cardId === card.id && (entry.verification === "needs-review" || (entry.reviewedSnapshot && snapshot && statementReview(entry, workspace, snapshot).stale))).map((entry) => <div className="flex items-center justify-between" key={entry.id}><p className="text-xs">Statement {formatCardDate(entry.closingDate)} needs review.</p><Button size="sm" variant="outline" onClick={() => { setReviewId(entry.id); setTab("statements"); }}>Review statement</Button></div>)}
            </section>}
            {snapshot && activityAvailable && <div className="mx-5 mb-5"><BalanceHistory card={card} workspace={statementWorkspace} snapshot={snapshot} signedBalanceMinor={balance?.signedBalanceMinor} today={today} onStatement={showStatement} onPayment={setPaymentId} /></div>}
          </TabsContent>
          <TabsContent value="statements" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <StatementsList key={`${card.id}-${attentionOnly}-${focusStatementId}`} focusStatementId={focusStatementId} card={card} rows={tableStatements} workspace={statementWorkspace} snapshot={snapshot} statuses={statuses} available={activityAvailable} today={today} eligible={cardEligible} attentionOnly={attentionOnly > 0} onAdd={() => openStatement(undefined, drafts[0])} onEdit={(entry) => { const draft = drafts.find((candidate) => candidate.closingDate === entry.closingDate); openStatement(draft ? undefined : entry, draft); }} onReview={(entry) => setReviewId(entry.id)} onPaymentDetails={setPaymentId} onPayments={() => setTab("payments")} onAction={(kind, statement) => { setActionError(null); setStatementAction({ kind, statement }); }} />
          </TabsContent>
          <TabsContent value="payments" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PaymentsList accounts={accounts} workspace={statementWorkspace} statuses={statuses} today={today} card={card} payments={tablePayments} snapshot={snapshot} available={activityAvailable} onStatements={showStatement} onDetails={setPaymentId} />
          </TabsContent>
          <TabsContent value="debt" className="space-y-4 bg-muted/15 p-5">
            <DebtHistory key={card.id} card={card} workspace={statementWorkspace} snapshot={snapshot} today={today} debtMinor={balance?.debtMinor} available={activityAvailable} onStatement={showStatement} onSettings={() => setEditor("settings")} />

          </TabsContent>
          <TabsContent value="activity" className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">{snapshot && <ActivityTable key={card.id} budget={budget} card={card} workspace={workspace} snapshot={snapshot} available={activityAvailable} onMappings={() => setEditor("settings")} />}</TabsContent>
      </> : workspace.cards.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><div className="flex size-11 items-center justify-center rounded-full border border-border bg-muted/50"><CardIcon className="size-5 text-muted-foreground" aria-hidden="true" /></div><div><h2 className="text-base font-semibold">No credit cards yet</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Add your first card to track statements and repayments from your Actual account.</p></div><Button size="sm" onClick={() => setEditor("add")} disabled={!available || unregistered.length === 0}><Plus className="size-4" aria-hidden="true" />Add card</Button>{available && unregistered.length === 0 && <p className="max-w-sm text-xs text-muted-foreground">Classify an on-budget account as Credit Card in <Link className="underline underline-offset-2" href="/accounts">Accounts</Link> to add it here.</p>}</div> : <>
        <PortfolioOverview sort={portfolioSort} workspace={workspace} balances={balances} sources={sources.map((source, index) => available && !activityQueries[index]?.isFetching && !activityQueries[index]?.isError ? source : undefined)} trendStatements={trendStatements} onOpen={selectCard} onReview={(id) => { selectCard(id); setAttentionOnly(1); setTab("statements"); }} />
      </>}
    </div>}
    {statementAction && <Dialog open onOpenChange={(open) => { if (!open) setStatementAction(null); }}><DialogContent><DialogTitle>{statementAction.kind === "reset" ? "Reset transaction review" : "Delete saved statement"}</DialogTitle><DialogDescription>{formatCardDate(statementAction.statement.closingDate)} · {statementAction.kind === "reset" ? "Clear saved matching decisions and posting-date overrides. Bank values and activity classifications stay saved. Released transactions become available to other statements; dependent statements need review." : "Remove saved bank values and review decisions, release transactions and reopen dependent statements. An automatic estimate may reappear. If this is the opening statement, its tracking date stays fixed until you restore it or change Settings."} Actual transactions are unchanged. You can Undo this action.</DialogDescription>{actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setStatementAction(null)}>Cancel</Button><Button onClick={applyStatementAction}>{statementAction.kind === "reset" ? "Reset review" : "Delete statement"}</Button></div></DialogContent></Dialog>}
    {editor === "add" && <CardEditor budgetSyncId={budget} accounts={unregistered} categories={categoryOptions} categoriesLoading={categories.isFetching} categoriesError={categories.isError} onRetryCategories={() => { void categories.refetch(); }} canRegister={available} onClose={() => setEditor(null)} onSaved={(id) => { selectCard(id); setEditor(null); }} />}
    {editor === "settings" && card && <CardEditor budgetSyncId={budget} card={card} accounts={accounts} categories={categoryOptions} categoriesLoading={categories.isFetching} categoriesError={categories.isError} onRetryCategories={() => { void categories.refetch(); }} canRegister={available} onClose={() => setEditor(null)} onSaved={() => setEditor(null)} onDeleted={() => { setEditor(null); selectCard(null); setStatementAction(null); requestAnimationFrame(() => headingRef.current?.focus()); }} />}
    {editor === "statement" && card && <StatementEditor budgetSyncId={budget} card={card} statement={editingStatement} suggested={suggested} canRecord={cardEligible} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); setTab("statements"); setReviewId(id); }} />}
    {editor === "plan" && card && snapshot && <PlanEditor key={card.id} budget={budget} card={card} workspace={workspace} snapshot={snapshot} available={activityAvailable} onClose={() => setEditor(null)} />}
    {selectedPayment && card && snapshot && <PaymentDetails payment={selectedPayment} peer={snapshot.counterparts.find((row) => row.id === selectedPayment.transferId)} accounts={accounts} statement={activityAvailable ? matchedPaymentStatement(selectedPayment.date, statementWorkspace.statements, statuses) : undefined} available={activityAvailable} onClose={() => setPaymentId(null)} onViewStatement={() => { const matched = activityAvailable ? matchedPaymentStatement(selectedPayment.date, statementWorkspace.statements, statuses) : undefined; setPaymentId(null); showStatement(matched?.id); }} />}
  </PageLayout></Tabs>;
}

export function CreditCardWorkspace() {
  const connection = useConnectionStore(selectActiveInstance);
  if (!connection) return <PageLayout title="Credit Cards"><div className="flex min-h-96 flex-col items-center justify-center gap-4 p-8 text-center"><CardIcon className="size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Connect a budget to manage its credit cards</h2><p className="max-w-sm text-sm text-muted-foreground">Credit Cards reads balances and transactions from the Actual budget you connect.</p><Link className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" href="/connect">Connect budget</Link></div></PageLayout>;
  return <ConnectedWorkspace key={`${connection.id}:${connection.budgetSyncId}`} connection={connection} />;
}
