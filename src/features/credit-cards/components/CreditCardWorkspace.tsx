"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { ArrowLeft, BookOpen, CreditCard as CardIcon, Plus, RefreshCw, Settings, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageLayout } from "@/components/layout/PageLayout";
import { useConnectionStore, selectActiveInstance, type ConnectionInstance } from "@/store/connection";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { getTransport } from "@/lib/actual";
import { creditCardStore, EMPTY_WORKSPACE } from "../lib/store/store";
import { eligibleCardAccount } from "../lib/read/directory";
import { useCreditCardDirectory, useCreditCardCategories } from "../hooks/useCreditCardDirectory";
import { useCreditCardActivities, useCreditCardPlanAccounts } from "../hooks/useCreditCardActivity";
import { useWorkspaceUrl, type WorkspaceTab } from "../hooks/useWorkspaceUrl";
import { cardReadSnapshot } from "../lib/readModel";
import { bankToday, type StatementDraft } from "../lib/cycles";
import { formatCardDate } from "../lib/displayDates";
import { formatPercentBps } from "../lib/percent";
import { deriveCardView } from "../lib/derive/cardView";
import { limitOn } from "../lib/derive/limits";
import { planAccountIds, totalOwed, unassignedPlanEntries } from "../lib/derive/planAccounts";
import { planStatus } from "../lib/plans";
import type { Card, RepaymentPlan, Statement } from "../lib/models";
import { CardEditor, StatementEditor, type PlanAccountChoices } from "./CardEditors";
import { currentCardBalance } from "../lib/derive/currentBalance";
import { PlanEditor } from "./PlanEditor";
import type { PlanCandidate } from "../lib/derive/planDiscovery";
import { preloadBalanceChart } from "./BalanceHistory";
import { preloadHistoryCharts } from "./HistoryChart";
import { preloadWhenIdle } from "./charts/lazyChart";
import { CardMark } from "./CardIdentity";
import { cardNetworkLabel } from "./CardNetwork";
import { StatementReview } from "./StatementReview";
import { GuideProvider, useGuide } from "./guide/CreditCardGuide";
import type { GuideSection } from "../lib/vocabulary";
import { SaveToast } from "./SaveToast";
import { money, ordinal, readTime } from "./primitives/format";
import { StatementsScreen, type StatementAction, type StatementFilter } from "./screens/StatementsScreen";
import { OverviewScreen } from "./screens/OverviewScreen";
import { PaymentsScreen } from "./screens/PaymentsScreen";
import { ActivityScreen } from "./screens/ActivityScreen";
import { PlansScreen } from "./screens/PlansScreen";
import { InsightsScreen } from "./screens/InsightsScreen";
import { PortfolioScreen } from "./screens/PortfolioScreen";
import type { CardEntry } from "./cardEntry";

type Editor =
  | { kind: "add" }
  | { kind: "settings" }
  | { kind: "statement"; statement?: Statement; draft?: StatementDraft; fromReview?: boolean }
  | { kind: "plan"; plan?: RepaymentPlan; rowId?: string; candidate?: PlanCandidate }
  | null;


/** The card's terms in one line under its name; it replaces the Card terms panel (UI-7). */
export function termsLine(card: Card, limitMinor: number | null = card.creditLimitMinor) {
  const due = card.dueRule?.kind === "day-of-month" ? `due on the ${ordinal(card.dueRule.value)}`
    : card.dueRule ? `due ${card.dueRule.value} days after close` : null;
  return [
    card.network !== "unknown" ? cardNetworkLabel(card.network) : null,
    limitMinor != null ? `Limit ${money(limitMinor)}` : null,
    card.purchaseAprBps != null ? `${formatPercentBps(card.purchaseAprBps)}% APR` : null,
    card.closingDay ? `closes on the ${ordinal(card.closingDay)}` : null,
    due,
  ].filter(Boolean).join(" · ");
}

function ConnectedWorkspace({ connection }: { connection: ConnectionInstance }) {
  const budget = connection.budgetSyncId;
  const direct = connection.mode === "browser-api";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { url, go } = useWorkspaceUrl();
  const workspace = useStore(creditCardStore, (state) => state.workspaces[budget] ?? EMPTY_WORKSPACE);
  const notice = useStore(creditCardStore, (state) => state.notices[budget]);
  const canUndo = useStore(creditCardStore, (state) => Boolean(state.undoHistory[budget]?.length));
  const directory = useCreditCardDirectory(connection);
  const accountsData = directory.data?.accounts;
  const nameOf = (accountId: string) => accountsData?.find((account) => account.id === accountId)?.name ?? "Credit card";
  const classes = useAccountClasses();
  const queryClient = useQueryClient();
  const classKey = ["accountClasses", budget];
  const refreshingLock = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const guide = useGuide();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [portfolioSort, setPortfolioSort] = useState<"due" | "debt" | "name">("due");
  // The card the user last opened, so All cards returns focus to it (kept in state: never read a ref in render).
  const [lastCard, setLastCard] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const activityQueries = useCreditCardActivities(connection, workspace.cards, workspace.statements);
  const latestToday = workspace.cards.map((entry) => bankToday(entry.bankTimeZone)).sort().at(-1) ?? bankToday("UTC");
  const trackingQueries = useCreditCardPlanAccounts(connection, workspace, latestToday);
  // UI-2: the last read stays in use while a refresh runs; only failed reads drop out.
  const trackingSources = trackingQueries.map((query) => (query.isError ? undefined : query.data));
  const sources = activityQueries.map((entry) => entry.data
    ? cardReadSnapshot(entry.data, accountsData, trackingSources, directory.data?.balances, direct)
    : undefined);
  const categories = useCreditCardCategories(connection, editor?.kind === "add" || editor?.kind === "settings");
  const categoryOptions = categories.data?.categories
    .map((entry) => ({ id: entry.id, name: entry.name }))
    .sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  const cardIndex = workspace.cards.findIndex((entry) => entry.id === url.card);
  const card = workspace.cards[cardIndex];
  if (card && lastCard !== card.id) setLastCard(card.id);
  const query = activityQueries[cardIndex];
  const snapshot = sources[cardIndex];
  const accounts = accountsData ?? [];
  const available = !refreshing && !refreshError && !directory.isFetching && !directory.isError
    // A background re-fetch of account types (one per page open) keeps the cached types usable; Refresh sets `refreshing`.
    && Boolean(directory.data) && classes.available;
  const sourceFresh = (index: number) => available && Boolean(sources[index])
    && !activityQueries[index]?.isFetching && !activityQueries[index]?.isError;
  const activityAvailable = cardIndex >= 0 && sourceFresh(cardIndex);
  const eligible = available ? accounts.filter((account) => eligibleCardAccount(account, classes.maps)) : [];
  const unregistered = eligible.filter((account) => !workspace.cards.some((entry) => entry.accountId === account.id));
  const cardEligible = Boolean(card && eligible.some((account) => account.id === card.accountId));
  // Current debt needs both the ledger balance and its future-entry adjustment.
  const balances = new Map(workspace.cards.flatMap((entry, index) => {
    const source = activityQueries[index];
    const balance = currentCardBalance(entry, directory.data?.balances.get(entry.accountId), source?.data, Boolean(source?.isError), direct);
    return balance ? [[entry.accountId, balance] as const] : [];
  }));
  const entries: CardEntry[] = workspace.cards.map((entry, index) => {
    const entryToday = bankToday(entry.bankTimeZone);
    const snapshotFor = sources[index];
    const cardBalance = balances.get(entry.accountId);
    return {
      card: entry,
      name: nameOf(entry.accountId),
      today: entryToday,
      snapshot: snapshotFor,
      fresh: sourceFresh(index),
      balance: cardBalance,
      limitMinor: limitOn(entry, workspace, entryToday),
      owed: snapshotFor && cardBalance ? totalOwed(entry, workspace, snapshotFor, cardBalance.signedBalanceMinor, entryToday) : undefined,
      view: deriveCardView({ card: entry, workspace, snapshot: snapshotFor, rawSignedBalanceMinor: cardBalance?.rawSignedBalanceMinor, today: entryToday }),
    };
  });
  const current = card ? entries[cardIndex] : undefined;
  const view = current?.view;
  const reviewing = card ? workspace.statements.find((entry) => entry.id === url.review && entry.cardId === card.id) : undefined;
  const reading = refreshing || directory.isFetching || activityQueries.some((entry) => entry.isFetching);
  const readAt = directory.data?.fetchedAt;
  const sourceText = reading ? "Refreshing…" : readAt ? `Read from Actual ${readTime(readAt)}` : "Reading Actual…";
  const failed = refreshError ?? (directory.isError ? "Couldn't read Actual" : null);

  // Warm the chart code in idle time while the list is on screen, so the first chart a user opens draws at once.
  // The promise is returned so a failed import is caught there (best effort; a mount retries).
  useEffect(() => preloadWhenIdle(() => Promise.all([preloadBalanceChart(), preloadHistoryCharts()])), []);

  const selectCard = (id: string | null) => go({ card: id, tab: "overview", statement: null, review: null, payment: null, view: null, in: null, plan: null });
  const setTab = (tab: WorkspaceTab, patch: Parameters<typeof go>[0] = {}) =>
    go({ tab, statement: null, payment: null, view: null, in: null, plan: null, ...patch });
  async function refresh() {
    if (refreshingLock.current) return;
    refreshingLock.current = true;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await getTransport(connection).sync();
      const results = await Promise.allSettled([
        directory.refetch(),
        queryClient.refetchQueries({ queryKey: classKey, exact: true }, { throwOnError: true }),
        ...activityQueries.map((entry) => entry.refetch()),
        ...trackingQueries.map((entry) => entry.refetch()),
        ...(categories.data ? [categories.refetch()] : []),
      ]);
      const incomplete = results.some((result) => result.status === "rejected"
        || (result.value && "isError" in result.value && result.value.isError));
      if (incomplete) setRefreshError("Couldn't refresh everything");
    } catch {
      setRefreshError("Couldn't refresh");
    } finally {
      refreshingLock.current = false;
      setRefreshing(false);
    }
  }
  function statementAction(kind: StatementAction, statement: Statement) {
    const date = formatCardDate(statement.closingDate);
    setConfirm({
      title: kind === "reset" ? `Reset review of ${date}?` : `Delete statement ${date}?`,
      message: kind === "reset"
        ? "Clears this statement's decisions and posting dates. Bank figures and types stay. Actual is unchanged; you can Undo."
        : "Removes the bank figures and decisions and releases its transactions. Actual is unchanged; you can Undo.",
      destructiveLabel: kind === "reset" ? "Reset review" : "Delete statement",
      destructive: kind === "delete",
      onConfirm: () => {
        const store = creditCardStore.getState();
        const done = kind === "reset"
          ? store.resetReview(budget, statement.id, statement.revision)
          : store.deleteStatement(budget, statement.id, statement.revision);
        done.then(() => { if (kind === "delete") go({ statement: null }, "replace"); }, () => undefined);
      },
    });
  }
  const enterStatement = (statement?: Statement) => {
    const drafts = view?.drafts ?? [];
    const draft = statement ? drafts.find((entry) => entry.closingDate === statement.closingDate) : drafts[0];
    setEditor({ kind: "statement", statement: statement && !statement.estimate ? statement : undefined, draft });
  };
  const previousMissing = (closingDate: string | undefined) => {
    if (!card || !closingDate) return true;
    return !workspace.statements.some((entry) => entry.cardId === card.id && entry.closingDate < closingDate);
  };

  const plans = card ? workspace.plans.filter((plan) => plan.cardId === card.id) : [];
  const planAttention = card && snapshot
    ? unassignedPlanEntries(card, workspace, snapshot).length > 0
      || plans.some((plan) => plan.status === "active" && planStatus(plan, card, workspace, snapshot, current!.today).check)
    : false;
  const statementAttention = view?.attentionCount ?? 0;
  // Tabs carry only an attention dot: counts don't help anyone decide what to do (the toolbars show them).
  const tabs: { value: WorkspaceTab; label: string; dot?: number | boolean }[] = [
    { value: "overview", label: "Overview", dot: statementAttention > 0 || planAttention },
    { value: "statements", label: "Statements", dot: statementAttention },
    { value: "payments", label: "Payments" },
    { value: "activity", label: "Activity" },
    { value: "plans", label: "Instalment Plans", dot: planAttention },
    { value: "insights", label: "Insights" },
  ];
  // The guide opens on the section about the screen you are on.
  const GUIDE_FOR: Record<WorkspaceTab, GuideSection> = {
    overview: "figures", statements: "statements", payments: "bills", activity: "types", plans: "plans", insights: "figures",
  };
  const guideSection: GuideSection = reviewing ? "statements" : card ? GUIDE_FOR[url.tab] : "start";

  const refreshButton = <Button variant="outline" size="sm" onClick={() => { void refresh(); }} disabled={reading}>
    <RefreshCw className="size-3.5" aria-hidden />Refresh
  </Button>;
  const helpButton = <Button variant="outline" size="sm" onClick={() => guide?.open(guideSection)}>
    <BookOpen className="size-3.5" aria-hidden />Guide
  </Button>;
  // While reviewing, the review's own title row carries these tools, so the screen keeps three header lines.
  const header = reviewing ? <></> : <header aria-label="Credit card workspace" className="shrink-0 border-b border-border">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 items-center gap-3">
        {card && <Button variant="outline" size="xs" onClick={() => selectCard(null)}><ArrowLeft className="size-3.5" aria-hidden />All cards</Button>}
        {card && <CardMark card={card} />}
        <div className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} className="truncate text-base font-semibold outline-none">
            {current?.name ?? "Credit cards"}
            {card && card.status !== "active" && <span className="ml-2 text-xs font-normal text-muted-foreground">Inactive</span>}
          </h1>
          {card && <p className="truncate text-xs text-muted-foreground">{termsLine(card, current?.limitMinor ?? null) || "Set the card's terms in Settings"}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className="text-xs text-muted-foreground">{sourceText}</span>
        <Button variant="outline" size="icon-sm" aria-label="Undo last change" title="Undo last change" disabled={!canUndo || editor !== null}
          onClick={() => { void creditCardStore.getState().undo(budget); }}><Undo2 className="size-3.5" aria-hidden /></Button>
        {refreshButton}
        {helpButton}
        {card
          ? <Button variant="outline" size="sm" onClick={() => setEditor({ kind: "settings" })}><Settings className="size-3.5" aria-hidden />Settings</Button>
          : workspace.cards.length > 0 && <Button size="sm" onClick={() => setEditor({ kind: "add" })} disabled={!available || unregistered.length === 0}>
            <Plus className="size-3.5" aria-hidden />Add card
          </Button>}
      </div>
    </div>
    {card && !reviewing && <TabsList aria-label="Card views" className="gap-1 border-0 px-3">
      {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className="h-9 shrink-0 gap-1.5 px-2 text-[13px] whitespace-nowrap">
        {tab.label}
        {tab.dot ? <span className="size-1.5 rounded-full bg-amber-600" aria-label="needs attention" /> : null}
      </TabsTrigger>)}
    </TabsList>}
  </header>;

  const banner = failed && <div
    role="alert"
    className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/30"
  >
    <p>{failed} · {readAt ? `showing data read at ${readTime(readAt)}` : "no data read yet"}</p>
    <Button variant="outline" size="xs" onClick={() => { void refresh(); }}>Retry</Button>
  </div>;

  const loadingActivity = !snapshot && <div role="status" aria-label="Loading card activity" className="space-y-2 p-4">
    {query?.isError
      ? <div role="alert" className="flex items-center gap-3 text-sm">Card activity couldn&apos;t be read.
        <Button size="xs" variant="outline" onClick={() => { void query.refetch(); }}>Retry</Button></div>
      : Array.from({ length: 6 }, (_, index) => <div key={index} className="h-9 animate-pulse rounded bg-muted/50" />)}
  </div>;

  let body;
  if (reviewing && current && snapshot) {
    body = <StatementReview
      // A figures correction raises the revision: the review reopens on the corrected statement.
      key={`${reviewing.id}:${reviewing.revision}`}
      budget={budget}
      statement={reviewing}
      entry={current}
      workspace={workspace}
      snapshot={snapshot}
      available={activityAvailable}
      refreshing={reading}
      tools={<><span role="status" className="text-xs text-muted-foreground">{sourceText}</span>{refreshButton}{helpButton}</>}
      onClose={() => { setReviewed(reviewing.id); go({ review: null, tab: "statements", statement: null }); }}
      onEditFigures={() => setEditor({ kind: "statement", statement: reviewing, fromReview: true })}
      onMakePlan={(rowId) => setEditor({ kind: "plan", rowId })}
      onOpenPlan={(planId) => go({ review: null, tab: "plans", plan: planId, statement: null })}
    />;
  } else if (card && current) {
    const cardIssue = !refreshing && !refreshError && !directory.isFetching && classes.available && !cardEligible
      ? "This account is closed, off-budget or no longer a Credit Card account in Accounts. Saved statements are kept." : null;
    body = <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-sm">
      {cardIssue && <p className="shrink-0 border-b px-4 py-2 text-xs">{cardIssue}</p>}
      {snapshot?.issues.length ? <p className="shrink-0 border-b px-4 py-2 text-xs">
        Some Actual transactions are incomplete. Review them before payments can be confirmed.
      </p> : null}
      {url.tab === "overview" && <OverviewScreen
        budget={budget}
        entry={current}
        workspace={workspace}
        onStatement={(id) => setTab("statements", { statement: id })}
        onEnter={() => enterStatement(view?.awaitingStatement)}
        onReview={(statement) => go({ review: statement.id })}
        onActivityCurrent={() => setTab("activity", { in: "current" })}
        onPlans={() => setTab("plans")}
        onPayment={(id) => setTab("payments", { payment: id })}
      />}
      {url.tab === "statements" && <StatementsScreen
        entry={current}
        workspace={workspace}
        eligible={cardEligible}
        filter={(url.view as StatementFilter | null) ?? "all"}
        onFilter={(filter) => go({ view: filter === "all" ? null : filter, statement: null }, "replace")}
        panelId={url.statement}
        focusId={reviewed}
        onPanel={(id) => go({ statement: id }, "replace")}
        onEnter={enterStatement}
        onEdit={(statement) => setEditor({ kind: "statement", statement })}
        onReview={(statement) => go({ review: statement.id })}
        onAction={statementAction}
        onPayment={(id) => setTab("payments", { payment: id })}
      />}
      {url.tab === "payments" && <PaymentsScreen
        entry={current}
        accounts={accounts}
        filter={url.view}
        onFilter={(filter) => go({ view: filter, payment: null }, "replace")}
        panelId={url.payment}
        onPanel={(id) => go({ payment: id }, "replace")}
        onStatement={(id) => setTab("statements", { statement: id })}
      />}
      {url.tab === "activity" && (snapshot ? <ActivityScreen
        budget={budget}
        entry={current}
        workspace={workspace}
        snapshot={snapshot}
        available={activityAvailable}
        statementFilter={url.in}
        planFilter={url.plan}
        typeFilter={url.view}
        onFilters={(patch) => go(patch, "replace")}
        onMappings={() => setEditor({ kind: "settings" })}
        onMakePlan={(rowId) => setEditor({ kind: "plan", rowId })}
        onOpenPlan={(planId) => setTab("plans", { plan: planId })}
      /> : loadingActivity)}
      {url.tab === "plans" && <PlansScreen
        budget={budget}
        entry={current}
        workspace={workspace}
        canEdit={activityAvailable && cardEligible}
        planId={url.plan}
        onOpenPlan={(planId) => go({ plan: planId })}
        onAdd={() => setEditor({ kind: "plan" })}
        onAddFound={(candidate) => setEditor({ kind: "plan", candidate })}
        onEdit={(plan) => setEditor({ kind: "plan", plan })}
        onActivity={(planId) => setTab("activity", { plan: planId })}
      />}
      {url.tab === "insights" && <InsightsScreen
        entry={current}
        workspace={workspace}
        onStatement={(id) => setTab("statements", { statement: id })}
        onSettings={() => setEditor({ kind: "settings" })}
      />}
    </div>;
  } else if (workspace.cards.length === 0) {
    body = <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border border-border bg-muted/50">
        <CardIcon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-base font-semibold">No credit cards yet</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">Add your first card to track statements and repayments from your Actual account.</p>
      </div>
      <Button size="sm" onClick={() => setEditor({ kind: "add" })} disabled={!available || unregistered.length === 0}>
        <Plus className="size-4" aria-hidden="true" />Add card
      </Button>
      {available && unregistered.length === 0 && <p className="max-w-sm text-xs text-muted-foreground">
        Mark an on-budget account as Credit Card in <Link className="underline underline-offset-2" href="/accounts">Accounts</Link> to add it here.
      </p>}
      {!classes.available && <p className="text-xs text-muted-foreground">Account types are loading. You can add a card once they load.</p>}
    </div>;
  } else {
    body = <PortfolioScreen sort={portfolioSort} onSort={setPortfolioSort} entries={entries} workspace={workspace} focusCardId={lastCard} onOpen={selectCard} />;
  }

  // Plan accounts for the card editors (Add card and Settings): from the directory, so they're known before
  // any card activity is read; transfers per card account come from each plan account's read history.
  const planAccountChoices: PlanAccountChoices | undefined = accountsData ? {
    registered: [...planAccountIds(workspace)].map((id) => {
      const history = trackingSources.find((source) => source?.accountId === id);
      const peers = new Map((history?.counterparts ?? []).map((row) => [row.id, row.accountId]));
      const transfers: Record<string, number> = {};
      for (const row of history?.rows ?? []) {
        const peer = row.transferId ? peers.get(row.transferId) : undefined;
        if (peer) transfers[peer] = (transfers[peer] ?? 0) + 1;
      }
      return {
        id,
        name: accountsData.find((account) => account.id === id)?.name ?? "Plan account",
        usedBy: workspace.plans.filter((plan) => plan.planAccountId === id).map((plan) => plan.name),
        transfers: history ? transfers : null,
      };
    }),
    available: accountsData.filter((account) => account.offBudget && !account.closed).map((account) => ({ id: account.id, name: account.name })),
  } : undefined;
  const planRow = editor?.kind === "plan" && editor.rowId ? snapshot?.rows.find((row) => row.id === editor.rowId) : undefined;
  return <Tabs value={url.tab} onValueChange={(value) => setTab(value as WorkspaceTab)} className="min-h-0 flex-1 overflow-hidden">
    <PageLayout scrollManaged header={header}>
      {banner}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
      </div>
      <SaveToast notice={notice} stamp={workspace} canUndo={canUndo} onUndo={() => { void creditCardStore.getState().undo(budget); }} />
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }} state={confirm} />
      {editor?.kind === "add" && <CardEditor
        budgetSyncId={budget}
        accounts={unregistered}
        planAccounts={planAccountChoices}
        categories={categoryOptions}
        categoriesLoading={categories.isFetching}
        categoriesError={categories.isError}
        onRetryCategories={() => { void categories.refetch(); }}
        canRegister={available}
        onClose={() => setEditor(null)}
        onSaved={(id) => { setEditor(null); selectCard(id); }}
      />}
      {editor?.kind === "settings" && card && <CardEditor
        budgetSyncId={budget}
        card={card}
        accounts={accounts}
        categories={categoryOptions}
        categoriesLoading={categories.isFetching}
        categoriesError={categories.isError}
        onRetryCategories={() => { void categories.refetch(); }}
        canRegister={available}
        planAccounts={planAccountChoices}
        limitChanges={workspace.limitChanges.filter((entry) => entry.cardId === card.id)}
        onClose={() => setEditor(null)}
        onSaved={() => setEditor(null)}
        onDeleted={() => {
          setEditor(null);
          selectCard(null);
          requestAnimationFrame(() => headingRef.current?.focus());
        }}
      />}
      {editor?.kind === "statement" && card && current && <StatementEditor
        budgetSyncId={budget}
        card={card}
        cardName={current.name}
        statement={editor.statement}
        suggested={editor.draft}
        previousMissing={previousMissing(editor.statement?.closingDate ?? editor.draft?.closingDate)}
        canRecord={cardEligible}
        onClose={() => setEditor(null)}
        onSaved={(id) => { setEditor(null); go({ tab: "statements", statement: id, review: editor.statement && !editor.fromReview ? null : id }); }}
      />}
      {editor?.kind === "plan" && card && snapshot && <PlanEditor
        key={editor.plan?.id ?? editor.rowId ?? editor.candidate?.key ?? "new"}
        budget={budget}
        card={card}
        plan={editor.plan}
        candidate={editor.candidate}
        row={planRow}
        workspace={workspace}
        snapshot={snapshot}
        available={activityAvailable}
        onClose={() => setEditor(null)}
      />}
    </PageLayout>
  </Tabs>;
}

export function CreditCardWorkspace() {
  const connection = useConnectionStore(selectActiveInstance);
  if (!connection) {
    return <PageLayout title="Credit Cards">
      <div className="flex min-h-96 flex-col items-center justify-center gap-4 p-8 text-center">
        <CardIcon className="size-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Connect a budget to manage its credit cards</h2>
        <p className="max-w-sm text-sm text-muted-foreground">Credit Cards reads balances and transactions from the Actual budget you connect.</p>
        <Link className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" href="/connect">Connect budget</Link>
      </div>
    </PageLayout>;
  }
  return <StoredWorkspace key={`${connection.id}:${connection.budgetSyncId}`} connection={connection} />;
}

/** Loads the budget's credit-card records from the app database before showing the workspace. */
function StoredWorkspace({ connection }: { connection: ConnectionInstance }) {
  const budget = connection.budgetSyncId;
  const status = useStore(creditCardStore, (state) => state.status[budget]);
  useEffect(() => { void creditCardStore.getState().load(budget); }, [budget]);
  // Start the Actual directory and account-type reads now, beside the app-database load, not after it.
  useCreditCardDirectory(connection);
  useAccountClasses();
  if (status?.state === "ready") return <GuideProvider><ConnectedWorkspace connection={connection} /></GuideProvider>;
  return <PageLayout title="Credit Cards">
    <div className="flex min-h-96 flex-col items-center justify-center gap-4 p-8 text-center">
      {status?.state === "unavailable" ? <>
        <h2 className="text-lg font-semibold">Credit-card data unavailable</h2>
        <p role="alert" className="max-w-sm text-sm text-muted-foreground">{status.error}</p>
        <Button variant="outline" onClick={() => void creditCardStore.getState().load(budget, true)}>Retry</Button>
      </> : <div role="status" aria-label="Loading credit cards" className="w-full max-w-3xl space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-muted/60" />
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded bg-muted/40" />)}
      </div>}
    </div>
  </PageLayout>;
}
