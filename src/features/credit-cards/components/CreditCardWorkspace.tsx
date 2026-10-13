"use client";

import { formatCardDate, formatCardTimestamp } from "../lib/displayDates";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { ArrowLeft, CreditCard as CardIcon, Plus, RefreshCw, Settings, Pencil, Undo2, CheckCircle2, AlertCircle, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageLayout } from "@/components/layout/PageLayout";
import { useConnectionStore, selectActiveInstance, type ConnectionInstance } from "@/store/connection";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { getTransport } from "@/lib/actual";
import { formatAmount, minorToMajorText } from "@/features/assets-debt/lib/money";
import { creditCardStore, EMPTY_WORKSPACE } from "../lib/memory";
import { eligibleCardAccount } from "../lib/ledger";
import { useCreditCardDirectory, useCreditCardCategories } from "../hooks/useCreditCardDirectory";
import { useCreditCardActivities } from "../hooks/useCreditCardActivity";
import { CardEditor, StatementEditor } from "./CardEditors";
import { ReviewText } from "./ReviewText";
import { TransactionNotes } from "./TransactionNotes";
import { CardOverview } from "./CardOverview";
import { DebtHistory } from "./DebtHistory";
import { statementPaymentTotals } from "../lib/insights";
import { StatementReview } from "./StatementReview";
import { PaymentDetails } from "./PaymentDetails";
import { ActivityClassification } from "./ActivityClassification";
import { Metric, Status, BalanceProgress, settlementTone } from "./WorkspaceVisuals";
import { WorkspaceTable, type TableColumn } from "./WorkspaceTable";
import { HistoryChart } from "./HistoryChart";
import { bankToday, type StatementDraft } from "../lib/cycles";
import { statementDrafts, statementReview, previewStatements, sumMinor } from "../lib/statements";
import { latestStatement, settlements, matchedPaymentStatement } from "../lib/repayments";
import { portfolio, observedInterestTotals, statementMovement } from "../lib/history";
import { portfolioStatementTrend, portfolioInterestTrend, paymentTotalsDetail, portfolioPaymentTiming } from "../lib/portfolioView";
import { paymentEvidence } from "../lib/activity";
import { cardModel, cardFacility } from "../lib/financialAdapter";
import { statementPaymentSummary } from "../lib/paymentSummary";
import type { Statement, Workspace } from "../lib/models";

function Amount({ value }: { value: number | null | undefined }) {
  return <span className="tabular-nums">{value === undefined || value === null ? "Unavailable" : formatAmount(value, 2)}</span>;
}
function TableHead({ labels }: { labels: string[] }) {
  return <thead className="bg-muted"><tr>{labels.map((label) => <th key={label} scope="col" className="px-2 py-1 font-medium whitespace-nowrap">{label}</th>)}</tr></thead>;
}

function ConnectedWorkspace({ connection }: { connection: ConnectionInstance }) {
  const budget = connection.budgetSyncId;
  const activityPanelId = useId();
  const workspace = useStore(creditCardStore, (state) => state.workspaces[budget] ?? EMPTY_WORKSPACE);
  const notice = useStore(creditCardStore, (state) => state.notices[budget]);
  const canUndo = useStore(creditCardStore, (state) => Boolean(state.undoHistory[budget]?.length));
  const directory = useCreditCardDirectory(connection);
  const classes = useAccountClasses();
  const queryClient = useQueryClient();
  const classKey = ["accountClasses", budget];
  const classesRefreshing = useIsFetching({ queryKey: classKey, exact: true }) > 0;
  const refreshingLock = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [months, setMonths] = useState(6);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const activityQueries = useCreditCardActivities(connection, workspace.cards, months, workspace.statements, reviewId);
  const [statementAction, setStatementAction] = useState<{ kind: "reset" | "delete"; statement: Statement } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<"add" | "settings" | "statement" | null>(null);
  const categories = useCreditCardCategories(connection, editor === "add" || editor === "settings");
  const categoryOptions = categories.data?.categories.map((entry) => ({ id: entry.id, name: entry.name })).sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  const [editingStatement, setEditingStatement] = useState<Statement | undefined>();
  const [suggested, setSuggested] = useState<StatementDraft | undefined>();
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [showActivity, setShowActivity] = useState(false);
  const card = workspace.cards.find((entry) => entry.id === selectedId);
  const bank = card ? latestStatement(workspace.statements.filter((entry) => entry.bankConfirmed), card.id) : undefined;
  const query = activityQueries[workspace.cards.findIndex((entry) => entry.id === selectedId)];
  const snapshot = query?.data;
  const accounts = directory.data?.accounts ?? [];
  const available = !refreshing && !refreshError && !directory.isFetching && !directory.isError && Boolean(directory.data) && classes.available && !classesRefreshing;
  const activityAvailable = available && Boolean(snapshot) && !query?.isFetching && !query?.isError;
  const eligible = available ? accounts.filter((account) => eligibleCardAccount(account, classes.maps)) : [];
  const unregistered = eligible.filter((account) => !workspace.cards.some((entry) => entry.accountId === account.id));
  const activeAccount = accounts.find((account) => account.id === card?.accountId);
  const cardEligible = Boolean(card && eligible.some((account) => account.id === card.accountId));
  const balance = card && !refreshing && !refreshError && !directory.isError && !directory.isFetching ? directory.data?.balances.get(card.accountId) : undefined;
  const today = card ? bankToday(card.bankTimeZone) : bankToday("UTC");
  const drafts = card && snapshot && balance && activityAvailable ? statementDrafts(card, today, months, snapshot, balance.signedBalanceMinor, workspace.statements).filter((draft) => !workspace.statements.some((entry) => entry.cardId === card.id && !(entry.closingDate < draft.periodStart || entry.periodStart > draft.closingDate))) : [];
  const statementWorkspace = { ...workspace, statements: [...workspace.statements, ...previewStatements(card?.id ?? "", drafts)] };
  const statuses = card && snapshot && activityAvailable ? settlements(card, statementWorkspace, snapshot, today) : [];
  const nextPayment = bank ? statuses.find((entry) => entry.statementId === bank.id) : undefined;
  const cardsTotal = portfolio(workspace.cards, !refreshing && !refreshError && !directory.isFetching && !directory.isError ? directory.data?.balances ?? new Map() : new Map());
  const selectedReview = workspace.statements.find((entry) => entry.id === reviewId && entry.cardId === card?.id);
  const selectedPayment = snapshot?.rows.find((entry) => entry.id === paymentId);
  const sourceText = refreshing ? "Syncing and refreshing Actual data…" : directory.isFetching ? "Refreshing Actual data…" : directory.isError ? "Actual data unavailable. Bank facts remain available; retry with Refresh." : activityQueries.some((entry) => entry.isFetching) ? "Reading card activity…" : directory.data ? `Actual data read ${new Date(directory.data.fetchedAt).toLocaleTimeString()}` : "Loading Actual data…";
  const portfolioInterest = workspace.cards.map((entry, index) => {
    const source = activityQueries[index]?.data;
    if (!source || activityQueries[index]?.isFetching || activityQueries[index]?.isError) return null;
    const totals = observedInterestTotals(entry, workspace, source, bankToday(entry.bankTimeZone));
    return totals.classificationKnown ? totals : null;
  });
  const observedInterest = sumMinor(portfolioInterest.flatMap((entry) => entry ? [entry.totalMinor] : []));
  const reportingPeriods = [...new Set(portfolioInterest.flatMap((entry) => entry ? [`${formatCardDate(entry.from)} – ${formatCardDate(entry.to)}`] : []))];
  const reportingPeriod = reportingPeriods.length === 1 ? reportingPeriods[0] : "Loaded periods vary by card; see each card’s Debt & history";
  const verificationHealth = workspace.statements.filter((entry) => !card || entry.cardId === card.id).reduce((counts, entry) => {
    const source = activityQueries[workspace.cards.findIndex((item) => item.id === entry.cardId)];
    if (!available || !source?.data || source.isFetching || source.isError) counts.unavailable++;
    else if (!statementReview(entry, workspace, source.data).coverage) counts.unavailable++;
    else if (entry.reviewedSnapshot && statementReview(entry, workspace, source.data).stale) counts.changed++;
    else if (entry.verification !== "verified") counts.review++;
    else counts.verified++;
    return counts;
  }, { changed: 0, review: 0, unavailable: 0, verified: 0 });
  const trendStatements = workspace.cards.flatMap((entry, index) => {
    const source = activityQueries[index]?.data;
    const live = directory.data?.balances.get(entry.accountId);
    const confirmed = workspace.statements.filter((statement) => statement.cardId === entry.id);
    const estimates = available && source && live && !activityQueries[index]?.isFetching && !activityQueries[index]?.isError ? statementDrafts(entry, bankToday(entry.bankTimeZone), months, source, live.signedBalanceMinor, workspace.statements).filter((draft) => !confirmed.some((statement) => !(statement.closingDate < draft.periodStart || statement.periodStart > draft.closingDate))) : [];
    return [...confirmed, ...previewStatements(entry.id, estimates)];
  });
  const portfolioTrend = portfolioStatementTrend(workspace.cards, trendStatements);
  const portfolioInterestPoints = portfolioInterestTrend(workspace.cards, workspace, activityQueries.map((query) => available && !query.isFetching && !query.isError ? query.data : undefined), workspace.cards.map((entry) => bankToday(entry.bankTimeZone)));
  const showInterestTrend = portfolioInterestPoints.some((point) => point.value !== null && point.value > 0);
  const paymentTotals = statementPaymentTotals(workspace.cards, workspace, activityQueries.map((query) => available && !query.isFetching && !query.isError ? query.data : undefined), workspace.cards.map((entry) => bankToday(entry.bankTimeZone)));
  const openStatement = (statement?: Statement, draft?: StatementDraft) => { setEditingStatement(statement); setSuggested(draft); setEditor("statement"); };
  const selectCard = (id: string) => { setSelectedId(id); setReviewId(null); setPaymentId(null); setTab("overview"); };
  async function refresh() {
    if (refreshingLock.current) return;
    refreshingLock.current = true; setRefreshing(true); setRefreshError(null);
    try {
      await getTransport(connection).sync();
      const results = await Promise.allSettled([directory.refetch(), queryClient.refetchQueries({ queryKey: classKey, exact: true }, { throwOnError: true }), ...activityQueries.map((entry) => entry.refetch()), ...(categories.data ? [categories.refetch()] : [])]);
      if (results.some((result) => result.status === "rejected" || (result.value && "isError" in result.value && result.value.isError))) setRefreshError("Actual data could not be refreshed completely. Retry Refresh; your bank facts and drafts are retained.");
    } catch { setRefreshError("Actual sync failed. Retry Refresh; your bank facts and drafts are retained."); }
    finally { refreshingLock.current = false; setRefreshing(false); }
  }
  const actions = <>
    <span role="status" title={sourceText} className="max-w-64 truncate self-center text-xs text-muted-foreground">{sourceText}</span>
    {workspace.cards.length > 0 && <Select className="w-36" aria-label="Activity history window" disabled={editor !== null || reviewId !== null || paymentId !== null} size="sm" value={String(months)} onValueChange={(value) => setMonths(Number(value))} options={[6, 12, 24, 36].map((value) => ({ value: String(value), label: `Last ${value} months` }))} />}
    <Button variant="outline" size="sm" disabled={!canUndo || editor !== null || reviewId !== null || paymentId !== null} onClick={() => creditCardStore.getState().undo(budget)}><Undo2 className="size-3.5" />Undo</Button>
    <Button variant="outline" size="sm" onClick={() => { void refresh(); }} disabled={refreshing || directory.isFetching || activityQueries.some((entry) => entry.isFetching)}><RefreshCw className="size-3.5" />Refresh</Button>
    {card ? <Button variant="outline" size="sm" onClick={() => setEditor("settings")}><Settings className="size-3.5" />Settings</Button> : workspace.cards.length > 0 && <Button size="sm" onClick={() => setEditor("add")} disabled={!available || unregistered.length === 0}><Plus className="size-3.5" />Add card</Button>}
  </>;

  const tableStatements = card ? [...workspace.statements.filter((entry) => entry.cardId === card.id), ...previewStatements(card.id, drafts)] : [];
  const paymentFor = (entry: Statement) => statuses.find((row) => row.statementId === entry.id);
  const statementColumns: TableColumn<Statement>[] = [
    { label: "Statement date", width: "14%", value: (entry) => entry.closingDate, searchValue: (entry) => `${formatCardDate(entry.closingDate)} ${formatCardDate(entry.periodStart)} ${entry.periodStart} ${entry.verification} ${entry.openingAnchor ? "Opening" : ""} ${entry.bankConfirmed ? "Bank confirmed" : "Automatic estimate"}` },
    { label: "Statement balance", width: "10%", value: (entry) => entry.officialBalanceMinor, searchValue: (entry) => `Minimum ${formatAmount(entry.minimumDueMinor, 2)}` },
    { label: "Due date", width: "8%", value: (entry) => entry.dueDate, searchValue: (entry) => formatCardDate(entry.dueDate) },
    { label: "Balance movement", width: "22%", value: (entry) => entry.officialBalanceMinor, searchValue: (entry) => { const movement = snapshot && card && activityAvailable ? statementMovement(card, entry, statementWorkspace, snapshot) : null; return movement ? Object.values(movement).map((value) => typeof value === "number" ? formatAmount(value, 2) : value ?? "").join(" ") : ""; } },
    { label: "Payment progress", width: "13%", value: (entry) => paymentFor(entry)?.paidMinor, searchValue: (entry) => statementPaymentSummary(entry, paymentFor(entry), today, activityAvailable).progress.map((line) => line.text).join(" ") },
    { label: "Payment timing", width: "17%", value: (entry) => paymentFor(entry)?.confirmedPaidDate ?? paymentFor(entry)?.paidDate, searchValue: (entry) => statementPaymentSummary(entry, paymentFor(entry), today, activityAvailable).timing.map((line) => `${line.text} ${line.detail ?? ""}`).join(" ") + ` ${paymentFor(entry)?.minimumPaidDate ?? ""} ${paymentFor(entry)?.paidDate ?? ""} ${paymentFor(entry)?.confirmedMinimumPaidDate ?? ""} ${paymentFor(entry)?.confirmedPaidDate ?? ""}` },
    { label: "Status", width: "7%", value: (entry) => entry.verification },
    { label: "Actions", width: "9%" },
  ];
  const tablePayments = (snapshot?.rows ?? []).filter((row) => row.amountMinor > 0 && row.transferId).map((row) => ({ row, matchedStatement: activityAvailable ? matchedPaymentStatement(row.date, statementWorkspace.statements, statuses) : undefined }));
  const paymentColumns: TableColumn<typeof tablePayments[number]>[] = [
    { label: "Date", width: "104px", value: ({ row }) => row.date, searchValue: ({ row }) => formatCardDate(row.date) }, { label: "Paid from", width: "14%", value: ({ row }) => row.label }, { label: "Notes", value: ({ row }) => row.notes },
    { label: "Amount", width: "8%", value: ({ row }) => row.amountMinor }, { label: "Cleared", width: "7%", value: ({ row }) => row.cleared === null ? "Unknown" : row.cleared ? "Cleared" : "Pending" },
    { label: "Statement", width: "12%", value: ({ matchedStatement }) => matchedStatement?.closingDate, searchValue: ({ matchedStatement }) => matchedStatement ? formatCardDate(matchedStatement.closingDate) : "" }, { label: "Details", width: "8%" },
  ];
  const workspaceHeader = useRef<HTMLElement>(null);
  function closeReview() { setReviewId(null); requestAnimationFrame(() => workspaceHeader.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()); }
  const tableView = Boolean(card && (tab === "statements" || tab === "payments"));
  const healthDetail = `${verificationHealth.verified} verified · ${verificationHealth.changed} source changed · ${verificationHealth.review} need review · ${verificationHealth.unavailable} awaiting source`;
  const healthIssues = verificationHealth.changed + verificationHealth.review;
  const [dismissedFeedback, setDismissedFeedback] = useState<{ notice: string; workspace: Workspace } | null>(null);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setDismissedFeedback({ notice, workspace }), 6000); return () => clearTimeout(timer); }, [notice, workspace]);
  const statusDisplay = <div className="flex min-w-0 items-center gap-3 whitespace-nowrap text-xs">
    {notice && (notice !== dismissedFeedback?.notice || workspace !== dismissedFeedback.workspace) && <p role="status" title={`Latest workspace action: ${notice}`} className="flex max-w-64 items-center gap-1.5 truncate"><CheckCircle2 className="size-3.5 shrink-0 text-chart-2" aria-hidden /><span className="truncate">{notice}</span></p>}
    {workspace.statements.some((entry) => !card || entry.cardId === card.id) && <ReviewText className="w-auto text-muted-foreground" text={healthIssues ? `${healthIssues} ${healthIssues === 1 ? "statement needs" : "statements need"} review` : verificationHealth.unavailable ? "Evidence unavailable" : "Statements up to date"} label="saved statement health" detail={healthDetail} />}
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

  return <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 overflow-hidden"><PageLayout scrollManaged header={<header ref={workspaceHeader} aria-label="Credit card workspace" className="shrink-0 border-b border-border">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"><div className="flex min-w-0 items-center gap-2">{card && <Button variant="ghost" size="xs" disabled={reviewId !== null} onClick={() => { setSelectedId(null); setReviewId(null); }}><ArrowLeft className="size-3.5" />All cards</Button>}<span className="rounded-md bg-muted p-1.5 text-muted-foreground"><CardIcon className="size-4" aria-hidden="true" /></span><h1 className="truncate text-sm font-semibold">{card?.nickname ?? "Credit Cards"}</h1>{!card && <span className="text-xs text-muted-foreground">{workspace.cards.length} registered</span>}{!card && statusDisplay}{card && <span className="truncate text-xs text-muted-foreground">{card.last4 && `•••• ${card.last4} · `}{(card.issuer || activeAccount?.name) !== card.nickname && (card.issuer || activeAccount?.name) ? `${card.issuer || activeAccount?.name} · ` : ""}{card.status.replaceAll("-", " ")}</span>}</div><div className="flex min-w-0 flex-wrap gap-2">{actions}</div></div>
    {card && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4"><TabsList className="max-w-full overflow-x-auto border-0 px-0"><TabsTrigger disabled={reviewId !== null} value="overview">Overview</TabsTrigger><TabsTrigger disabled={reviewId !== null} value="statements">Statements</TabsTrigger><TabsTrigger disabled={reviewId !== null} value="payments">Payments</TabsTrigger><TabsTrigger disabled={reviewId !== null} value="debt">Debt & history</TabsTrigger></TabsList><div className="ml-auto py-1">{statusDisplay}</div></div>}
  </header>}>
    {selectedReview && snapshot ? <StatementReview key={selectedReview.id} budget={budget} statement={selectedReview} workspace={workspace} snapshot={snapshot} available={activityAvailable} onClose={closeReview} /> : <div className={tableView ? "flex min-h-0 flex-1 flex-col overflow-hidden text-sm" : workspace.cards.length === 0 ? "flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 text-sm" : "min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm"}>
      {refreshError && <p role="alert" className="text-xs text-destructive">{refreshError}</p>}
      {!classes.available && <p className="text-xs text-muted-foreground">Account classification is loading or unavailable. Registration is available once classifications load.</p>}
      {card ? <>
        {!refreshing && !refreshError && !directory.isFetching && !classesRefreshing && classes.available && !cardEligible && <p className="rounded-md border border-border p-3 text-xs">This account is unavailable, closed, off-budget or no longer classified as Credit Card. Review its classification in Accounts; existing statements are retained.</p>}
        {query?.isError && <p role="status" className="rounded-md border border-border p-3 text-xs">Card activity is unavailable. Refresh to retry; saved bank facts and review drafts are retained.</p>}
        {snapshot?.issues.length ? <p className="rounded-md border border-border p-3 text-xs">Some Actual transaction structures are incomplete. Review is required before confirming settlement.</p> : null}
          <TabsContent value="overview" className="space-y-2">
            <CardOverview key={card.id} card={card} bank={bank} payment={nextPayment} balance={balance} workspace={workspace} snapshot={snapshot} today={today} available={activityAvailable} onStatement={() => openStatement(bank, bank ? undefined : drafts[0])} onSettings={() => setEditor("settings")} onPayments={() => setTab("payments")} />
            {(drafts.length > 0 || workspace.statements.some((entry) => entry.cardId === card.id && (entry.verification === "needs-review" || (entry.reviewedSnapshot && snapshot && statementReview(entry, workspace, snapshot).stale))) || (bank && snapshot && !bank.openingAnchor && !statementReview(bank, workspace, snapshot).canVerify)) && <section className="rounded-md border border-border bg-muted/20 p-3 space-y-2"><h2 className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4 text-muted-foreground" aria-hidden="true" />Needs attention</h2>
              {drafts.length > 0 && <div className="flex items-center justify-between"><p className="text-xs">{drafts.length} automatically prepared statements await bank confirmation.</p><Button size="sm" variant="outline" onClick={() => setTab("statements")}>Review drafts</Button></div>}
              {bank && snapshot && !bank.openingAnchor && bank.verification !== "needs-review" && !statementReview(bank, workspace, snapshot).stale && !statementReview(bank, workspace, snapshot).canVerify && <div className="flex items-center justify-between"><p className="text-xs">Latest statement membership or balance needs review.</p><Button size="sm" variant="outline" onClick={() => { setReviewId(bank.id); setTab("statements"); }}>Review latest statement</Button></div>}
              {workspace.statements.filter((entry) => entry.cardId === card.id && (entry.verification === "needs-review" || (entry.reviewedSnapshot && snapshot && statementReview(entry, workspace, snapshot).stale))).map((entry) => <div className="flex items-center justify-between" key={entry.id}><p className="text-xs">Statement {formatCardDate(entry.closingDate)} needs review.</p><Button size="sm" variant="outline" onClick={() => { setReviewId(entry.id); setTab("statements"); }}>Review statement</Button></div>)}
            </section>}
          </TabsContent>
          <TabsContent value="statements" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <WorkspaceTable compact summary title={`Statements for ${card.nickname}`} rows={tableStatements} columns={statementColumns} filters={[
              { label: "Statement status", options: [{ value: "", label: "All statements" }, { value: "draft", label: "Automatic estimates" }, { value: "verified", label: "Verified" }, { value: "review", label: "Needs review" }], matches: (entry, value) => value === "draft" ? !entry.bankConfirmed : value === "verified" ? entry.verification === "verified" : entry.bankConfirmed && entry.verification !== "verified" },
              { label: "Statement payment", options: [{ value: "", label: "Any payment status" }, { value: "remaining", label: "Balance remaining" }, { value: "paid", label: "Fully paid" }, { value: "pending", label: "Clearing pending" }], matches: (entry, value) => { const payment = statuses.find((row) => row.statementId === entry.id); return value === "remaining" ? (payment?.fullRemainingMinor ?? 0) > 0 : value === "paid" ? payment?.fullRemainingMinor === 0 : (payment?.provisionalMinor ?? 0) > 0; } },
            ]} actions={<Button size="sm" onClick={() => openStatement(undefined, drafts[0])} disabled={!cardEligible}><Plus className="size-3.5" aria-hidden />Add statement</Button>} renderRow={(entry) => {
                const draft = drafts.find((candidate) => candidate.closingDate === entry.closingDate);
                const payment = statuses.find((result) => result.statementId === entry.id);
                const status = draft ? "Automatic estimate" : !entry.bankConfirmed ? "Estimate" : snapshot && !statementReview(entry, workspace, snapshot).coverage ? "Load history" : entry.reviewedSnapshot && snapshot && statementReview(entry, workspace, snapshot).stale ? "Source changed · review" : entry.verification === "verified" ? "Verified" : entry.verification === "needs-review" ? "Needs review" : entry.openingAnchor ? entry.verification === "membership-reviewed" ? "Transactions confirmed · opening balance" : "Opening anchor · unverified" : entry.verification;
                const movement = snapshot && activityAvailable ? statementMovement(card, entry, statementWorkspace, snapshot) : null;
                const shortStatus = status === "Transactions confirmed · opening balance" ? "Opening" : status === "Opening anchor · unverified" ? "Opening · review" : status === "Automatic estimate" ? "Estimate" : status === "membership-reviewed" ? "Reviewed" : status === "Source changed · review" ? "Source changed" : status;
                const paymentKnown = payment?.fullRemainingMinor !== null && payment?.fullRemainingMinor !== undefined;
                const missingMovement = movement?.unavailableReason ?? (!movement ? "Refresh activity for the breakdown" : null);
                const missingPayment = !paymentKnown ? !activityAvailable ? "Refresh activity for payment status" : !entry.bankConfirmed ? "Confirm bank values for payment status" : "Load payment history to calculate remaining amounts" : null;
                const money = (value: number | null | undefined) => value === null || value === undefined ? "-" : formatAmount(value, 2);
                const fullMovement = movement ? `Previous closing balance ${money(movement.openingMinor)}; purchases ${money(movement.purchasesMinor)}; interest ${money(movement.interestMinor)}; fees ${money(movement.feesMinor)}; payments during cycle ${money(movement.paymentsMinor)}; refunds ${money(movement.refundsMinor)}; other ${money(movement.otherMinor)}; variance ${money(movement.varianceMinor)}.${movement.openingMinor === null ? " Opening history not loaded." : ""}${missingMovement ? ` ${missingMovement}` : ""}` : missingMovement ?? "Refresh activity for the breakdown";
                const summary = statementPaymentSummary(entry, payment, today, activityAvailable);
                return <tr key={entry.id} className="border-t border-border hover:bg-muted/30">
                  <td><p className="font-medium tabular-nums">{formatCardDate(entry.closingDate)}</p><ReviewText className="text-muted-foreground" text={`${formatCardDate(entry.periodStart)} - ${formatCardDate(entry.closingDate)}`} label="statement period" detail={`${formatCardDate(entry.periodStart)} - ${formatCardDate(entry.closingDate)}`} /></td>
                  <td><p className="font-semibold tabular-nums"><Amount value={entry.officialBalanceMinor} /></p><ReviewText className="text-muted-foreground" text={`Minimum due: ${draft && !draft.minimumKnown ? "Not set" : money(entry.minimumDueMinor)}`} label="statement minimum due" />{!entry.bankConfirmed && <p className="text-muted-foreground">Estimated</p>}</td>
                  <td><p className="tabular-nums">{formatCardDate(entry.dueDate)}</p>{!entry.bankConfirmed && <p className="text-muted-foreground">Estimated</p>}</td>
                  <td>{movement && !missingMovement ? <>
                    <ReviewText text={`Previous ${money(movement.openingMinor)} · purchases ${money(movement.purchasesMinor)}`} label="opening balance and purchases" detail={fullMovement} />
                    <ReviewText className={movement.interestMinor || movement.feesMinor ? "text-chart-5" : "text-muted-foreground"} text={`Interest ${money(movement.interestMinor)} · fees ${money(movement.feesMinor)}`} label="interest and fees" detail={fullMovement} />
                    <ReviewText className={movement.varianceMinor ? "text-destructive" : "text-muted-foreground"} text={`Cycle payments ${money(movement.paymentsMinor)} · refunds ${money(movement.refundsMinor)}${movement.otherMinor ? ` · other ${money(movement.otherMinor)}` : ""}${movement.varianceMinor ? ` · difference ${money(movement.varianceMinor)}` : ""}`} label="cycle credits and adjustments" detail={fullMovement} />
                  </> : <ReviewText className="text-muted-foreground" text="Breakdown needs review" label="balance movement" detail={fullMovement} />}</td>
                  <td>{summary.progress.map((line, index) => <ReviewText key={index} className={line.tone === "danger" ? "text-destructive" : line.tone === "success" ? "text-chart-2" : index === 0 ? "font-medium tabular-nums" : "text-muted-foreground"} text={line.text} label={index === 0 ? "recorded statement payments" : index === 1 ? "minimum payment status" : "remaining statement balance"} detail={`${line.detail ?? line.text}. ${summary.detail}`} />)}</td>
                  <td>{summary.timing.map((line, index) => <ReviewText key={index} className={line.tone === "danger" ? "text-destructive" : line.tone === "success" ? "text-chart-2" : line.tone === "attention" ? "text-chart-5" : "text-muted-foreground"} text={line.text} label={index === 0 ? "minimum payment timing" : index === 1 ? "full payment timing" : "payment clearing status"} detail={`${line.detail ?? line.text}. ${summary.detail}`} />)}</td>
                  <td><ReviewText text={shortStatus} label="statement status" detail={[status === "Transactions confirmed · opening balance" ? "Opening statement: transactions confirmed; closing balance is an opening anchor" : status, missingMovement, missingPayment].filter(Boolean).join(". ")}><Status tone={status === "Verified" || status.startsWith("Transactions confirmed") ? "success" : "neutral"}>{shortStatus}</Status></ReviewText></td>
                  <td><div className="flex items-center gap-1"><Button variant="outline" size="xs" aria-label={draft || !entry.bankConfirmed ? "Confirm bank values" : "Correct bank facts"} title={draft || !entry.bankConfirmed ? "Confirm bank values" : "Correct bank facts"} disabled={draft ? !activityAvailable || !cardEligible : false} onClick={() => draft ? openStatement(undefined, draft) : openStatement(entry)}><Pencil className="size-3" aria-hidden /><span className="hidden min-[1800px]:inline">{draft || !entry.bankConfirmed ? "Confirm" : "Edit"}</span></Button>{!draft && <Button variant="outline" size="xs" aria-label="Review transactions" title="Review transactions" disabled={!snapshot} onClick={() => setReviewId(entry.id)}><ArrowLeft className="size-3 rotate-180" aria-hidden /><span className="hidden min-[1800px]:inline">Review</span></Button>}{!draft && <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="xs" aria-label={`Statement actions ${formatCardDate(entry.closingDate)}`} />}><MoreHorizontal className="size-3.5" aria-hidden /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { setActionError(null); setStatementAction({ kind: "reset", statement: entry }); }}><RotateCcw className="size-3.5" />Reset transaction review</DropdownMenuItem><DropdownMenuItem onClick={() => { setActionError(null); setStatementAction({ kind: "delete", statement: entry }); }}><Trash2 className="size-3.5" />Delete saved statement</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></td></tr>;

              }} />
            {workspace.corrections.filter((entry) => tableStatements.some((statement) => statement.id === entry.statementId)).length > 0 && <div className="max-h-24 shrink-0 overflow-auto border-t border-border p-3 text-xs">{workspace.corrections.filter((entry) => tableStatements.some((statement) => statement.id === entry.statementId)).map((entry) => <p key={entry.id}>Correction: {entry.reason} · Bank balance <Amount value={entry.before.officialBalanceMinor} /> → <Amount value={entry.after.officialBalanceMinor} /> · {formatCardTimestamp(entry.recordedAt)}</p>)}</div>}
          </TabsContent>
          <TabsContent value="payments" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <WorkspaceTable compact title="Card repayments" rows={tablePayments} columns={paymentColumns} filters={[
              { label: "Payment clearing", options: [{ value: "", label: "Any clearing status" }, { value: "cleared", label: "Cleared" }, { value: "pending", label: "Pending" }, { value: "unknown", label: "Unknown" }], matches: ({ row }, value) => value === "cleared" ? row.cleared === true : value === "pending" ? row.cleared === false : row.cleared === null },
              { label: "Payment match", options: [{ value: "", label: "Any statement" }, { value: "matched", label: "Matched" }, { value: "unmatched", label: "Unmatched" }], matches: ({ matchedStatement }, value) => value === "matched" ? Boolean(matchedStatement) : !matchedStatement },
            ]} actions={<Button size="sm" onClick={() => setTab("statements")}>View statement payment status</Button>} description="Transfers are matched by date. Recorded payments count toward the statement; uncleared amounts remain pending." renderRow={({ row, matchedStatement }) => {
              return <tr key={row.id} className="border-t border-border align-top hover:bg-muted/30"><td className="px-2 py-1 whitespace-nowrap">{formatCardDate(row.date)}</td><td className="px-2 py-1 break-words">{row.label}</td><td className="px-2 py-1"><TransactionNotes notes={row.notes} /></td><td className="px-2 py-1 tabular-nums"><Amount value={row.amountMinor} /></td><td className="px-2 py-1"><Status tone={!activityAvailable || row.cleared === null ? "neutral" : snapshot && paymentEvidence(row, snapshot) === "confirmed" ? "success" : "attention"}>{!activityAvailable ? "Refresh needed" : row.cleared === null ? "Unknown" : row.cleared ? "Cleared" : "Pending"}</Status></td><td className="px-2 py-1">{matchedStatement ? <><Button variant="link" size="xs" className="h-auto p-0" onClick={() => setTab("statements")}>{formatCardDate(matchedStatement.closingDate)}</Button>{!matchedStatement.bankConfirmed && <span className="ml-1 text-muted-foreground">(estimate)</span>}</> : <span className="text-muted-foreground">{activityAvailable ? "No statement in loaded history" : "Refresh needed"}</span>}</td><td className="px-2 py-1"><Button size="xs" aria-label={`View payment details for ${formatCardDate(row.date)} ${row.label}`} onClick={() => setPaymentId(row.id)}>View details</Button></td></tr>;
            }} />
          </TabsContent>
          <TabsContent value="debt" className="space-y-4">
            <DebtHistory key={card.id} card={card} workspace={statementWorkspace} snapshot={snapshot} today={today} debtMinor={balance?.debtMinor} available={activityAvailable} onSettings={() => setEditor("settings")} />
            <section className="rounded-md border border-border p-4"><Button variant="outline" size="sm" aria-expanded={showActivity} aria-controls={activityPanelId} onClick={() => setShowActivity(!showActivity)}>{showActivity ? "Hide activity classification" : "Review spending, refunds and interest classification"}</Button>{showActivity && <div id={activityPanelId} className="mt-3 overflow-x-auto"><table className="w-full text-xs text-left"><caption className="sr-only">Actual card activity classification</caption><TableHead labels={["Date", "Payee", "Notes", "Amount", "Cleared", "Classification"]} /><tbody>{snapshot?.rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="px-2 py-1">{formatCardDate(row.date)}</td><td className="px-2 py-1">{row.label}</td><td className="px-2 py-1"><TransactionNotes notes={row.notes} /></td><td className="px-2 py-1"><Amount value={row.amountMinor} /></td><td className="px-2 py-1">{row.cleared === null ? "Unknown" : row.cleared ? "Yes" : "No"}</td><td className="px-2 py-1"><ActivityClassification key={row.id} budget={budget} card={card} row={row} workspace={workspace} snapshot={snapshot} available={activityAvailable} /></td></tr>)}</tbody></table></div>}</section>
          </TabsContent>
      </> : workspace.cards.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><div className="flex size-11 items-center justify-center rounded-full border border-border bg-muted/50"><CardIcon className="size-5 text-muted-foreground" aria-hidden="true" /></div><div><h2 className="text-base font-semibold">No credit cards yet</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Add your first card to track statements and repayments from your Actual account.</p></div><Button size="sm" onClick={() => setEditor("add")} disabled={!available || unregistered.length === 0}><Plus className="size-4" aria-hidden="true" />Add card</Button>{available && unregistered.length === 0 && <p className="max-w-sm text-xs text-muted-foreground">Classify an on-budget account as Credit Card in <Link className="underline underline-offset-2" href="/accounts">Accounts</Link> to add it here.</p>}</div> : <>
        <div className="grid gap-3 md:grid-cols-4"><Metric label="Total card debt" detail={`${cardsTotal.balanceCoverage} of ${cardsTotal.totalCards} card balances available`}><Amount value={cardsTotal.balanceCoverage ? cardsTotal.debtMinor : undefined} /></Metric><Metric tone={cardsTotal.creditMinor > 0 ? "success" : "neutral"} label="Card credit" detail="Across registered cards"><Amount value={cardsTotal.balanceCoverage ? cardsTotal.creditMinor : undefined} /></Metric><Metric label="Statement payments remaining" detail={paymentTotalsDetail(paymentTotals)}><span title={`${paymentTotals.coverage} of ${paymentTotals.total} cards have confirmed payment evidence`}><Amount value={paymentTotals.coverage ? paymentTotals.remainingMinor : undefined} /></span></Metric><Metric tone="neutral" label="Interest charged" detail={`${reportingPeriod} · ${portfolioInterest.filter(Boolean).length} of ${workspace.cards.length} cards classified`}><Amount value={portfolioInterest.some(Boolean) ? observedInterest : undefined} /></Metric></div>
        <div className="overflow-x-auto rounded-md border border-border"><table className="w-full text-left text-xs"><caption className="sr-only">Registered credit cards</caption><TableHead labels={["Card / account", "Current debt", "Limit", "Available credit", "Utilization", "Statement due", "Minimum remaining", "Payment status", "APR", "Card status"]} /><tbody>{workspace.cards.map((entry, index) => {
          const live = !refreshing && !refreshError && !directory.isError && !directory.isFetching ? directory.data?.balances.get(entry.accountId) : undefined;
          const statement = latestStatement(workspace.statements.filter((row) => row.bankConfirmed), entry.id);
          const source = activityQueries[index]?.data;
          const fresh = available && source && !activityQueries[index]?.isFetching && !activityQueries[index]?.isError;
          const due = fresh ? settlements(entry, workspace, source, bankToday(entry.bankTimeZone)).find((row) => row.statementId === statement?.id) : undefined;
          return <tr key={entry.id} className="border-t border-border"><td className="px-2 py-1"><div className="flex items-center gap-2"><span className="rounded-md bg-muted p-1.5 text-muted-foreground"><CardIcon className="size-4" aria-hidden="true" /></span><div><Button variant="link" className="h-auto p-0 text-xs" onClick={() => selectCard(entry.id)}>{entry.nickname}{entry.last4 && ` · •••• ${entry.last4}`}</Button>{(entry.issuer || accounts.find((account) => account.id === entry.accountId)?.name) !== entry.nickname && <p className="text-muted-foreground">{entry.issuer || accounts.find((account) => account.id === entry.accountId)?.name}</p>}</div></div></td><td className="px-2 py-1"><Amount value={live?.debtMinor} /></td><td className="px-2 py-1"><Amount value={entry.creditLimitMinor} /></td><td className="px-2 py-1"><Amount value={live ? cardFacility(cardModel(entry, today, live.debtMinor), live.signedBalanceMinor).availableMinor : undefined} /></td><td className="px-2 py-1">{live && entry.creditLimitMinor ? <BalanceProgress compact label={`${entry.nickname} credit used`} percent={live.debtMinor / entry.creditLimitMinor * 100} tone={live.debtMinor >= entry.creditLimitMinor ? "danger" : live.debtMinor / entry.creditLimitMinor >= 0.9 ? "attention" : "info"} /> : "Unavailable"}</td><td className="px-2 py-1 whitespace-nowrap">{statement ? formatCardDate(statement.dueDate) : "Confirm statement"}</td><td className="px-2 py-1"><Amount value={due?.minimumRemainingMinor} /></td><td className="px-2 py-1"><Status tone={settlementTone(due)}>{due?.status ?? "Review statement"}</Status>{portfolioPaymentTiming(statement, due, bankToday(entry.bankTimeZone)) && <p className="mt-1 text-muted-foreground">{portfolioPaymentTiming(statement, due, bankToday(entry.bankTimeZone))}</p>}</td><td className="px-2 py-1">{entry.purchaseAprBps === null ? "Not set" : `${minorToMajorText(entry.purchaseAprBps, 2)}%`}</td><td className="px-2 py-1"><Status tone={entry.status === "active" ? "success" : entry.status === "lost-stolen" ? "danger" : entry.status === "frozen" ? "attention" : "neutral"}>{entry.status.replaceAll("-", " ")}</Status></td></tr>;
        })}</tbody></table></div>
        <p className="text-xs text-muted-foreground">Statement debt trends include bank balances and automatic estimates. Missing card periods appear as gaps, not zero debt.</p>
        <div className={showInterestTrend ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}><HistoryChart title="Total statement debt" points={portfolioTrend} monthly />{showInterestTrend && <HistoryChart title="Interest charged by month" points={portfolioInterestPoints} monthly allowSingle tone="interest" observationLabel="Identified interest charges in loaded Actual activity. Tooltips show each card’s reporting dates and coverage; partial totals do not include missing evidence." />}</div>
      </>}
    </div>}
    {statementAction && <Dialog open onOpenChange={(open) => { if (!open) setStatementAction(null); }}><DialogContent><DialogTitle>{statementAction.kind === "reset" ? "Reset transaction review" : "Delete saved statement"}</DialogTitle><DialogDescription>{formatCardDate(statementAction.statement.closingDate)} · {statementAction.kind === "reset" ? "Clear saved matching decisions and posting-date overrides. Bank values and activity classifications stay saved. Released transactions become available to other statements; dependent statements need review." : "Remove saved bank values and review decisions, release transactions and reopen dependent statements. An automatic estimate may reappear. If this is the opening statement, its tracking date stays fixed until you restore it or change Settings."} Actual transactions are unchanged. You can Undo this action.</DialogDescription>{actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setStatementAction(null)}>Cancel</Button><Button onClick={applyStatementAction}>{statementAction.kind === "reset" ? "Reset review" : "Delete statement"}</Button></div></DialogContent></Dialog>}
    {editor === "add" && <CardEditor budgetSyncId={budget} accounts={unregistered} categories={categoryOptions} categoriesLoading={categories.isFetching} categoriesError={categories.isError} onRetryCategories={() => { void categories.refetch(); }} canRegister={available} onClose={() => setEditor(null)} onSaved={(id) => { selectCard(id); setEditor(null); }} />}
    {editor === "settings" && card && <CardEditor budgetSyncId={budget} card={card} accounts={accounts} categories={categoryOptions} categoriesLoading={categories.isFetching} categoriesError={categories.isError} onRetryCategories={() => { void categories.refetch(); }} canRegister={available} onClose={() => setEditor(null)} onSaved={() => setEditor(null)} />}
    {editor === "statement" && card && <StatementEditor budgetSyncId={budget} card={card} statement={editingStatement} suggested={suggested} canRecord={cardEligible} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); setTab("statements"); setReviewId(id); }} />}
    {selectedPayment && card && snapshot && <PaymentDetails payment={selectedPayment} peer={snapshot.counterparts.find((row) => row.id === selectedPayment.transferId)} accounts={accounts} statement={activityAvailable ? matchedPaymentStatement(selectedPayment.date, statementWorkspace.statements, statuses) : undefined} available={activityAvailable} onClose={() => setPaymentId(null)} onViewStatement={() => { setPaymentId(null); setTab("statements"); }} />}
  </PageLayout></Tabs>;
}

export function CreditCardWorkspace() {
  const connection = useConnectionStore(selectActiveInstance);
  if (!connection) return <PageLayout title="Credit Cards"><p className="p-4 text-sm text-muted-foreground">Connect a budget to manage its credit cards.</p></PageLayout>;
  return <ConnectedWorkspace key={`${connection.id}:${connection.budgetSyncId}`} connection={connection} />;
}
