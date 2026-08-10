"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageLayout } from "@/components/layout/PageLayout";
import { getBudgetFileSyncCapabilities } from "@/lib/sync/capabilities";
import { generateId } from "@/lib/uuid";
import {
  DEFAULT_MATCH_CONFIG,
  DEFAULT_TEXT_PRESET,
  type TextTargetPreset,
} from "@/lib/reconciliation/match/config";
import { match } from "@/lib/reconciliation/match/matcher";
import {
  buildReconciliationItems,
  resolveToTransaction,
  summarizeCoverage,
} from "@/lib/reconciliation/session/build";
import type { NormalizedStatement } from "@/lib/reconciliation/statement/normalize";
import type {
  ActualTransactionSnapshot,
  MatchConfig,
  ReconciliationItem,
  StagedPatch,
  StatementRow,
} from "@/lib/reconciliation/types";
import { useStagedStore } from "@/store/staged";
import { usePayees } from "@/features/payees/hooks/usePayees";
import { useCategoryGroups } from "@/features/categories/hooks/useCategoryGroups";
import {
  stageField,
  unstageField,
  type StageableField,
} from "@/lib/reconciliation/session/staging";
import type { ReconciliationDisposition } from "@/lib/reconciliation/types";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useAccounts } from "@/features/accounts/hooks/useAccounts";
import { loadCandidateWindow } from "../lib/loadCandidates";
import {
  DEFAULT_APPLY_CONFIG,
  buildApplyPlan,
  type ApplyConfig,
} from "@/lib/reconciliation/session/plan";
import { prospectiveTransaction } from "@/lib/reconciliation/session/prospective";
import { updateSession as updateSessionQuietly } from "../lib/reconciliationApi";
import { executeApplyPlan, type ApplyRunResult } from "@/lib/reconciliation/apply/executor";
import type { OperationResult } from "@/lib/reconciliation/apply/operations";
import { createReconciliationTransport } from "@/lib/reconciliation/transportAdapter";
import { getTransport } from "@/lib/actual";
import { ApplyResultPanel } from "./ApplyResultPanel";
import { ReviewPanel } from "./ReviewPanel";
import {
  useReconciliationMutations,
  useReconciliationProfiles,
  useReconciliationSession,
  useReconciliationSessions,
} from "../hooks/useReconciliation";
import type { ReconciliationProfileRecord } from "../lib/reconciliationApi";
import type { ColumnMapping } from "@/lib/reconciliation/statement/normalize";
import { ImportPanel } from "./ImportPanel";
import { SessionList } from "./SessionList";
import { Workbench } from "./Workbench";

/**
 * Bank Statement Reconciliation (RD-071).
 *
 * Screen 1 lists persistent sessions, screen 2 imports and parses a statement,
 * screen 3 is the workbench. Nothing in this milestone writes to the budget:
 * matching, staging and review are all local until an explicit Apply, which
 * arrives with the next milestone.
 */

/**
 * How often apply progress is written while a run is in flight. Frequent enough
 * that an interruption loses little, rare enough that persistence does not
 * dominate the run.
 */
const PROGRESS_FLUSH_MS = 1000;

type Screen =
  | { name: "home" }
  | { name: "import"; sessionId: string; accountId: string; accountName: string }
  | { name: "workbench"; sessionId: string }
  | { name: "review"; sessionId: string }
  | { name: "result"; sessionId: string };

export function ReconciliationView() {
  const connection = useConnectionStore(selectActiveInstance);
  useAccounts();
  const accounts = useStagedStore((state) => state.accounts);

  usePayees();
  useCategoryGroups();
  const stagedPayees = useStagedStore((state) => state.payees);
  const stagedCategories = useStagedStore((state) => state.categories);

  const sessionsQuery = useReconciliationSessions();
  const mutations = useReconciliationMutations();

  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [accountId, setAccountId] = useState<string>("");

  // Held in memory for the life of the workbench view: the snapshot the session
  // matched against. Re-reading it before Apply is how drift is detected.
  const [snapshot, setSnapshot] = useState<ActualTransactionSnapshot[]>([]);
  const [parsedRows, setParsedRows] = useState<StatementRow[]>([]);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [statementName, setStatementName] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  /**
   * Which session the in-memory rows and items belong to.
   *
   * Without this the workbench cannot tell "nothing loaded yet" from "another
   * session's work is loaded", and opening a second session shows the first
   * one's decisions under the second one's header.
   */
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyRunResult | null>(null);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const [applyConfig, setApplyConfig] = useState<ApplyConfig>(DEFAULT_APPLY_CONFIG);

  // Matching options live with the session (and, once saved, the import
  // profile) because they describe how this account's transactions are created.
  const [matchConfig, setMatchConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const [matchPreset, setMatchPreset] = useState<TextTargetPreset>(DEFAULT_TEXT_PRESET);

  // Profiles are per account, so the panel can propose the one this account
  // used last rather than making the user configure the same statement layout
  // every month.
  const profileAccountId = screen.name === "import" ? screen.accountId : accountId || undefined;
  const profilesQuery = useReconciliationProfiles(profileAccountId);

  const sessionId = screen.name === "home" ? null : screen.sessionId;
  const sessionQuery = useReconciliationSession(sessionId);

  /**
   * Rehydrate a resumed session from the app database.
   *
   * A session outlives the component, so returning to one must rebuild the
   * workbench from what was persisted rather than showing an empty grid. The
   * Actual side is rebuilt from the snapshot stored on each item — that is
   * deliberately the snapshot the session matched against, not a fresh read,
   * because it is also what drift is measured from before Apply.
   */
  const hydratedSessionId = sessionQuery.data?.session.id;
  useEffect(() => {
    const data = sessionQuery.data;
    if (!data || screen.name !== "workbench" || data.session.id !== screen.sessionId) return;
    // Hydrate whenever the loaded state belongs to a different session — or to
    // none. Keying on emptiness instead would leave another session's decisions
    // on screen, and skipping when it already matches keeps a fresh match result
    // from being overwritten by the persisted copy behind it.
    if (loadedSessionId === data.session.id) return;

    setParsedRows(
      data.statementRows.map((row) => ({
        id: row.id,
        sourceRowNumber: row.sourceRowNumber,
        postedDate: row.postedDate,
        amount: row.amount,
        description: row.description,
        reference: row.reference ?? undefined,
        transactionDate: row.transactionDate ?? undefined,
        // Without these a resumed session silently stops matching foreign
        // purchases on their original amount.
        originalAmount: row.originalAmount ?? undefined,
        originalCurrency: row.originalCurrency ?? undefined,
        raw: row.raw,
        fingerprint: row.fingerprint,
      }))
    );
    setItems(
      data.items.map((item) => ({
        id: item.id,
        statementRowIds: item.statementRowIds,
        actualTransactionIds: item.actualTransactionIds,
        disposition: item.disposition as ReconciliationItem["disposition"],
        reasonCode: item.reasonCode ?? undefined,
        match: (item.match ?? undefined) as ReconciliationItem["match"],
        guards: (item.guards ?? {
          protectedReconciled: false,
          splitParent: false,
          transfer: "unknown",
        }) as ReconciliationItem["guards"],
        stagedChanges: (item.stagedChanges ?? undefined) as ReconciliationItem["stagedChanges"],
      }))
    );
    setSnapshot(
      data.items
        .map((item) => item.actualSnapshot as ActualTransactionSnapshot | null)
        .filter((snapshot): snapshot is ActualTransactionSnapshot => snapshot != null)
    );
    if (data.session.statementStart && data.session.statementEnd) {
      setPeriod({ start: data.session.statementStart, end: data.session.statementEnd });
    }
    setStatementName(data.session.statementName);
    if (data.session.matchConfig) setMatchConfig(data.session.matchConfig as MatchConfig);
    if (data.session.applyConfig) setApplyConfig(data.session.applyConfig as ApplyConfig);
    setLoadedSessionId(data.session.id);
  }, [sessionQuery.data, hydratedSessionId, screen, loadedSessionId]);

  const capabilities = useMemo(
    () => (connection ? getBudgetFileSyncCapabilities(connection) : null),
    [connection]
  );

  // The staged store wraps each entity; reconciliation only reads, so it takes
  // the entity and ignores the staging metadata. Deleted/closed accounts are
  // hidden because you cannot reconcile a statement against them.
  const visibleAccounts = useMemo(
    () =>
      Object.values(accounts)
        .filter((staged) => !staged.isDeleted && !staged.entity.closed)
        .map((staged) => staged.entity),
    [accounts]
  );

  const statementRowsById = useMemo(
    () => new Map(parsedRows.map((row) => [row.id, row])),
    [parsedRows]
  );
  const transactionsById = useMemo(
    () => new Map(snapshot.map((transaction) => [transaction.id, transaction])),
    [snapshot]
  );

  const payeeOptions = useMemo(
    () =>
      Object.values(stagedPayees)
        .filter((staged) => !staged.isDeleted)
        .map((staged) => ({ id: staged.entity.id, name: staged.entity.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stagedPayees]
  );

  const categoryOptions = useMemo(
    () =>
      Object.values(stagedCategories)
        .filter((staged) => !staged.isDeleted)
        .map((staged) => ({ id: staged.entity.id, name: staged.entity.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stagedCategories]
  );

  /**
   * What Apply would do, derived rather than tracked.
   *
   * The review screen and the executor read the same plan, so what is shown and
   * what runs cannot drift apart.
   */
  const applyPlan = useMemo(
    () =>
      buildApplyPlan({
        sessionId: sessionId ?? "",
        budgetSyncId: connection?.budgetSyncId ?? "",
        accountId: sessionQuery.data?.session.accountId ?? "",
        items,
        statementRows: statementRowsById,
        transactions: transactionsById,
        applyConfig,
      }),
    [
      sessionId,
      connection,
      sessionQuery.data,
      items,
      statementRowsById,
      transactionsById,
      applyConfig,
    ]
  );

  const coverage = useMemo(
    () =>
      summarizeCoverage(items, {
        statementRows: parsedRows.length,
        loadedTransactions: snapshot.length,
      }),
    [items, parsedRows.length, snapshot.length]
  );

  if (!connection) {
    return (
      <PageLayout title="Bank Reconciliation">
        <p className="px-4 py-8 text-sm text-muted-foreground">
          Connect to a budget to reconcile a bank statement.
        </p>
      </PageLayout>
    );
  }

  // Capability-gated rather than mode-gated: both transports support the
  // transaction primitives this feature needs, but a future one might not.
  if (capabilities && !capabilities.capabilities.listTransactions) {
    return (
      <PageLayout title="Bank Reconciliation">
        <p className="px-4 py-8 text-sm text-muted-foreground">
          This connection cannot read transactions, so reconciliation is unavailable.
        </p>
      </PageLayout>
    );
  }

  async function startSession() {
    const account = visibleAccounts.find((entry) => entry.id === accountId);
    if (!account) return;
    const { session } = await mutations.createSession.mutateAsync({
      accountId: account.id,
      accountName: account.name,
    });
    setParsedRows([]);
    setItems([]);
    setPeriod(null);
    setSnapshot([]);
    setApplyResult(null);
    setLoadedSessionId(null);
    setScreen({
      name: "import",
      sessionId: session.id,
      accountId: account.id,
      accountName: account.name,
    });
  }

  /**
   * Load the candidate window, match, and persist.
   *
   * Shared by the first run and by re-running from the workbench, so changing a
   * matching option never means re-importing the statement.
   */
  async function runMatch(input: {
    sessionId: string;
    accountId: string;
    statementRows: StatementRow[];
    statementPeriod: { start: string; end: string };
    totals?: unknown;
    statementName?: string | null;
    config: MatchConfig;
  }) {
    if (!connection) return;
    setIsMatching(true);
    setMatchError(null);

    try {
      const window = await loadCandidateWindow(connection, {
        accountId: input.accountId,
        statementStart: input.statementPeriod.start,
        statementEnd: input.statementPeriod.end,
        matchToleranceDays: input.config.dateToleranceDays,
        paddingDays: input.config.candidatePaddingDays,
      });

      const graph = match({
        statementRows: input.statementRows,
        actualTransactions: window.transactions,
        config: input.config,
      });

      const built = buildReconciliationItems({
        statementRows: input.statementRows,
        actualTransactions: window.transactions,
        graph,
        transfersReported: window.transfersReported,
        statementPeriod: input.statementPeriod,
        visibleWindow: window.visible,
        makeId: () => generateId(),
      });

      setSnapshot(window.transactions);
      setParsedRows(input.statementRows);
      setPeriod(input.statementPeriod);
      setItems(built);
      setLoadedSessionId(input.sessionId);
      if (input.statementName !== undefined) setStatementName(input.statementName);

      await mutations.saveParsedStatement.mutateAsync({
        sessionId: input.sessionId,
        statementRows: input.statementRows,
        items: built.map((item) => ({
          id: item.id,
          statementRowIds: item.statementRowIds,
          actualTransactionIds: item.actualTransactionIds,
          disposition: item.disposition,
          reasonCode: item.reasonCode ?? null,
          match: item.match,
          guards: item.guards,
          actualSnapshot: transactionsSnapshotFor(item, window.transactions) ?? null,
        })),
        patch: {
          status: "needs_review",
          statementStart: input.statementPeriod.start,
          statementEnd: input.statementPeriod.end,
          matchConfig: input.config,
          ...(input.statementName !== undefined ? { statementName: input.statementName } : {}),
          ...(input.totals !== undefined ? { totals: input.totals } : {}),
        },
      });

      setScreen({ name: "workbench", sessionId: input.sessionId });
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : "Could not match the statement");
    } finally {
      setIsMatching(false);
    }
  }

  /**
   * Apply a change to one item, in memory and in the database.
   *
   * Updated locally first so the workbench responds immediately, then persisted;
   * a decision the user can see but that was never saved is worse than a slow
   * one, so a failed write surfaces rather than being swallowed.
   */
  function updateItem(
    itemId: string,
    change: (item: ReconciliationItem) => ReconciliationItem
  ) {
    const current = items.find((entry) => entry.id === itemId);
    if (!current) return;
    const next = change(current);

    setItems((previous) => previous.map((entry) => (entry.id === itemId ? next : entry)));

    void mutations.patchItem
      .mutateAsync({
        id: itemId,
        sessionId: sessionId ?? "",
        payload: {
          disposition: next.disposition,
          reasonCode: next.reasonCode ?? null,
          actualTransactionIds: next.actualTransactionIds,
          stagedChanges: next.stagedChanges ?? null,
          match: next.match,
        },
      })
      .catch((error: unknown) => {
        setMatchError(
          error instanceof Error ? error.message : "Could not save that decision"
        );
      });
  }

  function snapshotFor(item: ReconciliationItem): ActualTransactionSnapshot | undefined {
    return transactionsById.get(item.actualTransactionIds[0] ?? "");
  }

  function handleDisposition(itemId: string, disposition: ReconciliationDisposition) {
    updateItem(itemId, (item) => ({
      ...item,
      disposition,
      // Returning a row to undecided drops what was staged for it: keeping edits
      // attached to a decision the user withdrew would apply them by surprise.
      stagedChanges: disposition === "unresolved" ? undefined : item.stagedChanges,
    }));
  }

  /**
   * Pick one of several competing candidates, or none of them.
   *
   * The transactions not picked are returned to rows of their own. They were
   * only ever visible through the item that offered them, so simply dropping
   * the reference would leave them in the budget and absent from the screen.
   */
  function handleUseCandidate(itemId: string, transactionId: string | null) {
    const current = items.find((entry) => entry.id === itemId);
    if (!current) return;

    const { item, released } = resolveToTransaction({
      item: current,
      transactionId,
      transactions: transactionsById,
      transfersReported: true,
      makeId: () => generateId(),
    });

    const next = items.flatMap((entry) =>
      entry.id === itemId ? [item, ...released] : [entry]
    );
    setItems(next);

    // Rows were added, so the whole set is rewritten rather than patched.
    void mutations.replaceItems
      .mutateAsync({
        sessionId: sessionId ?? "",
        items: next.map((entry) => ({
          id: entry.id,
          statementRowIds: entry.statementRowIds,
          actualTransactionIds: entry.actualTransactionIds,
          disposition: entry.disposition,
          reasonCode: entry.reasonCode ?? null,
          match: entry.match,
          guards: entry.guards,
          actualSnapshot: transactionsSnapshotFor(entry, snapshot) ?? null,
          stagedChanges: entry.stagedChanges ?? null,
        })),
      })
      .catch((error: unknown) => {
        setMatchError(error instanceof Error ? error.message : "Could not save that decision");
      });
  }

  /**
   * Everything a transformation rule needs to judge one row, resolved to the
   * names the user sees rather than the ids the model holds.
   */
  function transformContextFor(entry: ReconciliationItem) {
    const statementRow = statementRowsById.get(entry.statementRowIds[0] ?? "");
    const transaction = transactionsById.get(entry.actualTransactionIds[0] ?? "");
    return {
      item: entry,
      statementRow,
      transaction,
      pending: prospectiveTransaction({ item: entry, statementRow, transaction, applyConfig }),
      categoryName: (id: string | null) =>
        categoryOptions.find((option) => option.id === id)?.name ?? null,
      payeeName: (id: string | null) =>
        payeeOptions.find((option) => option.id === id)?.name ?? null,
    };
  }

  /** Stage what a transformation produced, one write per changed row. */
  function handleTransform(changes: { itemId: string; patch: StagedPatch | undefined }[]) {
    for (const change of changes) {
      updateItem(change.itemId, (entry) => ({ ...entry, stagedChanges: change.patch }));
    }
  }

  function handleBulkDisposition(itemIds: string[], disposition: ReconciliationDisposition) {
    for (const itemId of itemIds) handleDisposition(itemId, disposition);
  }

  function handleBulkCorrectAmount(
    entries: { itemId: string; transactionId: string; amount: number }[]
  ) {
    for (const entry of entries) {
      handleCorrectAmount(entry.itemId, entry.transactionId, entry.amount);
    }
  }

  function handleCorrectAmount(itemId: string, transactionId: string, amount: number) {
    updateItem(itemId, (item) => {
      const snapshot = transactionsById.get(transactionId);
      if (!snapshot) return item;
      const { patch } = stageField({
        patch: item.stagedChanges,
        field: "amount",
        original: snapshot.amount,
        next: amount,
        source: "manual",
      });
      return {
        ...item,
        actualTransactionIds: [transactionId],
        disposition: "correct-amount",
        stagedChanges: patch,
      };
    });
  }

  function handleStage(itemId: string, field: StageableField, value: string | null) {
    updateItem(itemId, (item) => {
      const snapshot = snapshotFor(item);
      const original =
        field === "payeeId"
          ? snapshot?.payeeId ?? null
          : field === "categoryId"
            ? snapshot?.categoryId ?? null
            : field === "notes"
              ? snapshot?.notes ?? null
              : snapshot?.date ?? null;

      const { patch } = stageField({
        patch: item.stagedChanges,
        field,
        original,
        next: value,
        source: "manual",
      });
      return { ...item, stagedChanges: patch };
    });
  }

  function handleUnstage(itemId: string, field: StageableField) {
    updateItem(itemId, (item) => {
      const patch = unstageField(item.stagedChanges, field);
      return {
        ...item,
        stagedChanges: Object.keys(patch).length > 0 ? patch : undefined,
        // Withdrawing the amount change withdraws the decision it was made for.
        disposition:
          field === "amount" && item.disposition === "correct-amount"
            ? "unresolved"
            : item.disposition,
      };
    });
  }

  /**
   * Write the plan.
   *
   * Markers already in the account are read first, so a create that succeeded in
   * an earlier attempt is recognised and skipped even if this session's own
   * record of it was lost. Each outcome is persisted as it happens rather than
   * in one write at the end, so an interruption leaves a truthful record.
   */
  async function handleApply() {
    const session = sessionQuery.data?.session;
    if (!connection || !session || applyPlan.operations.length === 0) return;

    setIsApplying(true);
    setMatchError(null);
    setApplyProgress({ done: 0, total: applyPlan.operations.length });
    const transport = createReconciliationTransport(getTransport(connection));

    try {
      const existingMarkers = await transport.readExistingMarkers({
        accountId: session.accountId,
        startDate: session.statementStart ?? undefined,
        endDate: session.statementEnd ?? undefined,
      });

      const collected: OperationResult[] = [];
      const previousResults = Array.isArray(session.applyResults)
        ? (session.applyResults as OperationResult[])
        : [];

      /*
       * Progress is written straight through the API rather than through a
       * mutation, and in batches.
       *
       * A mutation per operation invalidated the session query, so every write
       * dragged a refetch of the whole session and a re-render of the workbench
       * along behind it — between writes. On a real statement that turns a
       * few seconds of work into minutes of thrashing.
       *
       * Batching costs nothing in safety: the record is the fast path for a
       * retry, and the durable marker in the account is what actually prevents
       * a duplicate create. Losing the last few results means a retry re-checks
       * them, not that it repeats them.
       */
      let lastFlush = 0;
      let pending = false;

      const flush = async (force: boolean) => {
        if (!pending && !force) return;
        const now = Date.now();
        if (!force && now - lastFlush < PROGRESS_FLUSH_MS) return;
        lastFlush = now;
        pending = false;
        await updateSessionQuietly(session.id, { applyResults: [...collected] });
      };

      const result = await executeApplyPlan({
        plan: applyPlan,
        transport,
        existingMarkers,
        previousResults,
        onResult: async (entry) => {
          collected.push(entry);
          pending = true;
          await flush(false);
        },
        onProgress: (progress) =>
          setApplyProgress({ done: progress.completed, total: progress.total }),
      });

      await flush(true);
      setApplyResult(result);

      // One invalidating write at the end, so the session list and the
      // workbench refresh once rather than once per operation.
      await mutations.updateSession.mutateAsync({
        id: session.id,
        payload: {
          applyResults: result.results,
          status: result.complete ? "completed" : "partial",
          appliedAt: new Date().toISOString(),
        },
      });

      // Direct-mode writes need the browser runtime told about them.
      await getTransport(connection).sync();
      setScreen({ name: "result", sessionId: session.id });
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : "Could not apply the changes");
    } finally {
      setIsApplying(false);
      setApplyProgress(null);
    }
  }

  async function handleParsed(result: NormalizedStatement, fileName: string | null) {
    if (screen.name !== "import" || !result.period) return;
    await runMatch({
      sessionId: screen.sessionId,
      accountId: screen.accountId,
      statementRows: result.rows,
      statementPeriod: result.period,
      totals: result.totals,
      statementName: fileName,
      config: matchConfig,
    });
  }

  if (screen.name === "import") {
    return (
      <PageLayout
        title="Bank Reconciliation"
        actions={
          <Button variant="ghost" size="sm" onClick={() => setScreen({ name: "home" })}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Back
          </Button>
        }
        scrollManaged
      >
        {matchError && (
          <p role="alert" className="px-4 pt-3 text-xs text-destructive">
            {matchError}
          </p>
        )}
        <ImportPanel
          accountName={screen.accountName}
          matchConfig={matchConfig}
          matchPreset={matchPreset}
          profiles={profilesQuery.data ?? []}
          isSavingProfile={mutations.saveProfile.isPending}
          onApplyProfile={(profile: ReconciliationProfileRecord) => {
            const saved = profile.matchConfig as MatchConfig | null;
            if (saved) setMatchConfig({ ...DEFAULT_MATCH_CONFIG, ...saved });
          }}
          onSaveProfile={(name: string, mapping: ColumnMapping) => {
            void mutations.saveProfile.mutateAsync({
              accountId: screen.accountId,
              name,
              mapping,
              matchConfig,
            });
          }}
          onMatchConfigChange={(preset, config) => {
            setMatchPreset(preset);
            setMatchConfig(config);
          }}
          onCancel={() => setScreen({ name: "home" })}
          onParsed={(result, fileName) => void handleParsed(result, fileName)}
          isSaving={isMatching}
        />
      </PageLayout>
    );
  }

  if (screen.name === "review" || screen.name === "result") {
    const session = sessionQuery.data?.session;
    return (
      <PageLayout title="Bank Reconciliation" scrollManaged>
        {matchError && (
          <p role="alert" className="px-4 pt-3 text-xs text-destructive">
            {matchError}
          </p>
        )}
        {screen.name === "review" ? (
          <ReviewPanel
            plan={applyPlan}
            statementRows={statementRowsById}
            transactions={transactionsById}
            isApplying={isApplying}
            progress={applyProgress}
            applyConfig={applyConfig}
            onApplyConfigChange={(config) => {
              setApplyConfig(config);
              if (sessionId) {
                void mutations.updateSession.mutateAsync({
                  id: sessionId,
                  payload: { applyConfig: config },
                });
              }
            }}
            onBack={() => setScreen({ name: "workbench", sessionId: screen.sessionId })}
            onApply={() => void handleApply()}
          />
        ) : (
          applyResult && (
            <ApplyResultPanel
              plan={applyPlan}
              result={applyResult}
              isApplying={isApplying}
              onRetry={() => void handleApply()}
              onBack={() => setScreen({ name: "workbench", sessionId: screen.sessionId })}
            />
          )
        )}
        {screen.name === "result" && !applyResult && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {session?.appliedAt
              ? "This reconciliation has already been applied."
              : "Nothing has been applied yet."}
          </p>
        )}
      </PageLayout>
    );
  }

  if (screen.name === "workbench") {
    const session = sessionQuery.data?.session;
    const canRematch = Boolean(session && period && parsedRows.length > 0);
    return (
      <PageLayout
        title="Bank Reconciliation"
        actions={
          <Button variant="ghost" size="sm" onClick={() => setScreen({ name: "home" })}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            All reconciliations
          </Button>
        }
        scrollManaged
      >
        {matchError && (
          <p role="alert" className="px-4 pt-3 text-xs text-destructive">
            {matchError}
          </p>
        )}
        <Workbench
          accountName={session?.accountName ?? "Account"}
          statementName={statementName ?? session?.statementName ?? null}
          period={period}
          items={items}
          statementRows={statementRowsById}
          transactions={transactionsById}
          coverage={coverage}
          matchConfig={matchConfig}
          matchPreset={matchPreset}
          isMatching={isMatching}
          canRematch={canRematch}
          payees={payeeOptions}
          categories={categoryOptions}
          onDisposition={handleDisposition}
          onUseCandidate={handleUseCandidate}
          onCorrectAmount={handleCorrectAmount}
          onStage={handleStage}
          onUnstage={handleUnstage}
          onBulkDisposition={handleBulkDisposition}
          onBulkCorrectAmount={handleBulkCorrectAmount}
          transformContextFor={transformContextFor}
          onTransform={handleTransform}
          changeCount={applyPlan.operations.length}
          onReview={() => setScreen({ name: "review", sessionId: screen.sessionId })}
          onMatchConfigChange={(preset, config) => {
            setMatchPreset(preset);
            setMatchConfig(config);
          }}
          onRematch={() => {
            if (!session || !period) return;
            void runMatch({
              sessionId: session.id,
              accountId: session.accountId,
              statementRows: parsedRows,
              statementPeriod: period,
              config: matchConfig,
            });
          }}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Bank Reconciliation"
      count={
        sessionsQuery.data?.length
          ? `${sessionsQuery.data.length} session${sessionsQuery.data.length === 1 ? "" : "s"}`
          : undefined
      }
      isLoading={sessionsQuery.isLoading}
      isError={sessionsQuery.isError}
      error={sessionsQuery.error}
      onRetry={() => void sessionsQuery.refetch()}
      scrollManaged
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-border/50 px-4 py-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="reconciliation-account" className="text-xs">
            Account
          </Label>
          <select
            id="reconciliation-account"
            className="h-8 min-w-64 rounded-md border border-input bg-background px-2 text-sm"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Select an account…</option>
            {visibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          disabled={!accountId || mutations.createSession.isPending}
          onClick={() => void startSession()}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          New reconciliation
        </Button>
      </div>

      <SessionList
          sessions={sessionsQuery.data ?? []}
          onOpen={(session) => {
            // Cleared rather than left for the effect to replace, so the
            // previous session's rows are never briefly shown under this one.
            if (loadedSessionId !== session.id) {
              setParsedRows([]);
              setItems([]);
              setSnapshot([]);
              setPeriod(null);
              setStatementName(null);
              setApplyResult(null);
              setLoadedSessionId(null);
            }
            setScreen({ name: "workbench", sessionId: session.id });
          }}
          onDelete={(session) => void mutations.deleteSession.mutateAsync(session.id)}
        onNew={() => document.getElementById("reconciliation-account")?.focus()}
      />
    </PageLayout>
  );
}

/** The snapshot stored alongside an item, for drift detection before Apply. */
function transactionsSnapshotFor(
  item: ReconciliationItem,
  transactions: ActualTransactionSnapshot[]
): ActualTransactionSnapshot | undefined {
  const id = item.actualTransactionIds[0];
  if (!id) return undefined;
  return transactions.find((transaction) => transaction.id === id);
}
