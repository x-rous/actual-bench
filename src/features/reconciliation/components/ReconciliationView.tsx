"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  fingerprintStatement,
  type NormalizedStatement,
} from "@/lib/reconciliation/statement/normalize";
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
import {
  driftTargets,
  reconcilePlanWithDrift,
  type DriftReport,
} from "@/lib/reconciliation/apply/drift";
import { loadLatestForDrift } from "../lib/loadDrift";
import { verifyApply, type VerificationReport } from "@/lib/reconciliation/apply/verification";
import {
  mergeOperationResults,
  summarizeResults,
  type OperationResult,
} from "@/lib/reconciliation/apply/operations";
import { createReconciliationTransport } from "@/lib/reconciliation/transportAdapter";
import { getTransport } from "@/lib/actual";
import { ApplyResultPanel } from "./ApplyResultPanel";
import { ReviewPanel } from "./ReviewPanel";
import { PhaseNav } from "./PhaseNav";
import { SessionHeader, type SessionStep } from "./SessionHeader";
import {
  useReconciliationMutations,
  useReconciliationProfiles,
  useReconciliationSession,
  useReconciliationSessions,
} from "../hooks/useReconciliation";
import type {
  ReconciliationProfileRecord,
  ReconciliationSessionRecord,
} from "../lib/reconciliationApi";
import type { ColumnMapping } from "@/lib/reconciliation/statement/normalize";
import { ImportPanel } from "./ImportPanel";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { NewSessionDialog } from "./NewSessionDialog";
import { SessionList, rowCountOf } from "./SessionList";
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

/** How often the on-screen counter moves. Often enough to read, rarely enough
 * that redrawing the review table does not compete with the writing. */
const PROGRESS_UI_MS = 250;

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
  /** Which part of matching is running, so a long wait explains itself. */
  const [matchStage, setMatchStage] = useState<string | null>(null);
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
  /**
   * What moved in Actual since this session read it, from the check that runs
   * immediately before writing.
   *
   * Held rather than acted on, because rows a guardrail withheld are a decision
   * for the user: the first Apply reports them and writes nothing, and only an
   * explicit second press proceeds with the rest.
   */
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
  const [driftAcknowledged, setDriftAcknowledged] = useState(false);
  const [isCheckingDrift, setIsCheckingDrift] = useState(false);
  /** The read-back check that runs after a write, and whether it is running. */
  const [verification, setVerification] = useState<VerificationReport | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  /**
   * The statement the import screen has parsed, lifted so the toolbar's phase
   * button can act on it. `null` until it parses to at least one row.
   */
  const [pendingStatement, setPendingStatement] = useState<{
    result: NormalizedStatement;
    fileName: string | null;
  } | null>(null);

  /**
   * Stable, because the import panel reports upward from an effect that depends
   * on it. An inline arrow would be a new function every render, so the effect
   * would fire every render, store a fresh object, and re-render — a loop.
   * React Compiler would probably memoise it away, but a render loop is not
   * something to leave resting on that.
   */
  const handleStatementReady = useCallback(
    (result: NormalizedStatement | null, fileName: string | null) => {
      setPendingStatement(result ? { result, fileName } : null);
    },
    []
  );
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

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

    // Rebuild what the last apply did, from the record kept as it happened.
    // Without this the outcome is written faithfully to the database and then
    // unreachable: reopening an applied session landed on the grid with no way
    // to see what was written, or what failed and could be retried.
    const persisted = Array.isArray(data.session.applyResults)
      ? (data.session.applyResults as OperationResult[])
      : null;
    setApplyResult(
      persisted && persisted.length > 0
        ? { results: persisted, ...summarizeResults(persisted) }
        : null
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
  /**
   * What this session has already written, by operation id.
   *
   * Kept out of the plan so an applied session stops offering to apply itself,
   * while a partial one goes on offering exactly what failed.
   */
  const appliedOperationIds = useMemo(() => {
    const results = sessionQuery.data?.session.applyResults;
    if (!Array.isArray(results)) return undefined;
    return new Set(
      (results as OperationResult[])
        .filter((entry) => entry.status === "applied" || entry.status === "skipped")
        .map((entry) => entry.operationId)
    );
  }, [sessionQuery.data]);

  /**
   * The plan without the already-applied filter.
   *
   * The result screen describes work that has *run*, which the plan proper
   * deliberately excludes — so it needs the unfiltered view to say what each
   * operation did. Cheap: same pure function, same inputs.
   */
  const fullPlan = useMemo(
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
        appliedOperationIds,
      }),
    [
      appliedOperationIds,
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

  /**
   * Keep the session's status in step with the work.
   *
   * Only `needs_review` and the post-apply outcomes were ever written, so a
   * session with every row decided still read "In progress" — and the list
   * could not answer the one question worth asking it: which of these are
   * ready to apply?
   *
   * Derived from the items rather than set by each handler, because a decision
   * can be made a dozen ways (per row, in bulk, by a transformation, by
   * correcting an amount) and every one of them would otherwise have to
   * remember to do this.
   */
  const sessionStatus = sessionQuery.data?.session.status;
  const derivedStatus = useMemo<"needs_review" | "ready" | null>(() => {
    if (items.length === 0) return null;
    return items.some((item) => item.disposition === "unresolved") ? "needs_review" : "ready";
  }, [items]);

  useEffect(() => {
    if (!sessionId || !derivedStatus || loadedSessionId !== sessionId) return;
    // Terminal and in-flight states describe an apply, not the decisions, and
    // must not be overwritten by them.
    if (sessionStatus !== "needs_review" && sessionStatus !== "ready") return;
    if (sessionStatus === derivedStatus) return;
    // Through the mutation so the list refreshes with it. It converges: the
    // refetched status then equals the derived one and this stops.
    void mutations.updateSession.mutateAsync({
      id: sessionId,
      payload: { status: derivedStatus },
    });
    // `mutations` is recreated each render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, derivedStatus, sessionStatus, loadedSessionId]);

  /**
   * Which screen to show.
   *
   * Wrapped so that anything rendered for the whole feature — the
   * confirmation dialog especially — mounts on every screen. It used to sit
   * inside the last branch, so a confirmation raised from the workbench set
   * its state and rendered nothing until the user happened to navigate home.
   */
  function renderScreen() {
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

    /**
     * `chosenId` is passed rather than read from state: the dialog sets the
     * account and starts in the same handler, and reading the state it just set
     * would read the previous render's value.
     */
    async function startSession(chosenId?: string, tag?: string | null) {
      const account = visibleAccounts.find((entry) => entry.id === (chosenId ?? accountId));
      if (!account) return;
      setNewSessionOpen(false);
      setPendingStatement(null);
      setMatchError(null);

      // Caught here because the caller fires this and forgets it. Without it a
      // failed write is an unhandled rejection: the dialog has already closed,
      // so the user lands back on the list with no session and no explanation.
      let session: ReconciliationSessionRecord;
      try {
        ({ session } = await mutations.createSession.mutateAsync({
          accountId: account.id,
          accountName: account.name,
          tag: tag ?? null,
        }));
      } catch (error) {
        setMatchError(
          error instanceof Error
            ? `Could not start the reconciliation: ${error.message}`
            : "Could not start the reconciliation"
        );
        return;
      }

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

    /*
     * Re-matching rebuilds the items from scratch, which mints new item ids —
     * and the record of what was already applied is keyed by those ids. Running
     * it on a session that has written to the budget would therefore lose track
     * of that work and offer to update the same transactions a second time.
     *
     * So it is refused once a session has applied, and the user is pointed at
     * the operation that is actually correct: a fresh reconciliation, which
     * reads Actual as it stands now rather than as it stood before the writes.
     *
     * Held here rather than beside the button it disables, because re-importing
     * is reachable from the progress header too — a guard that lives on one
     * control is not a guard.
     */
    const appliedSession = sessionQuery.data?.session;
    const rematchBlockedReason =
      appliedSession &&
      (appliedSession.status === "completed" || appliedSession.status === "partial")
        ? "This reconciliation has already been applied. Matching again would lose the record of what was written - start a new reconciliation to check the account as it stands now."
        : null;

    /**
     * Go back to the statement and import it again.
     *
     * The case this exists for: the statement was pasted short a few rows, and
     * without this the only way forward is to delete the session and redo every
     * decision. Re-importing replaces the statement rows and re-runs matching,
     * which does discard the decisions staged against the old rows — so the cost
     * is stated plainly and confirmed before anything moves.
     */
    function reimport(session: ReconciliationSessionRecord) {
      // Enforced here, not only on the button: the progress header offers this
      // too, and an applied session must refuse it from either.
      if (rematchBlockedReason) return;

      const decided = items.filter((item) => item.disposition !== "unresolved").length;
      const staged = items.filter(
        (item) => item.stagedChanges && Object.keys(item.stagedChanges).length > 0
      ).length;

      const go = () => {
        // Cleared on the way in: the panel reports its own state on mount, but
        // until that first effect runs the toolbar would otherwise still be
        // holding — and willing to match — the statement parsed last time.
        setPendingStatement(null);
        setScreen({
          name: "import",
          sessionId: session.id,
          accountId: session.accountId,
          accountName: session.accountName ?? "Account",
        });
      };

      // Nothing decided yet, so there is nothing to warn about.
      if (decided === 0 && staged === 0) {
        go();
        return;
      }

      setConfirm({
        title: "Import this statement again?",
        message: (
          <>
            Matching will run again from scratch against the new statement, so the{" "}
            {decided} decision{decided === 1 ? "" : "s"}
            {staged > 0 ? ` and ${staged} edited row${staged === 1 ? "" : "s"}` : ""} on this
            reconciliation will be discarded. Nothing in your budget changes, and anything already
            applied stays applied.
          </>
        ),
        destructiveLabel: "Discard and re-import",
        onConfirm: go,
      });
    }

    /**
     * Move between the steps of a session from its progress header.
     *
     * Only ever backwards or to somewhere already reached — the header reports
     * progress, it does not skip work.
     */
    function goToStep(step: SessionStep, id: string) {
      setDriftReport(null);
      setDriftAcknowledged(false);
      if (step === "import") {
        // Through the same confirmation as the toolbar's Import again: going
        // back to the statement discards the decisions made against the old
        // rows, whichever control the user reached it by.
        const current = sessionQuery.data?.session;
        if (current) reimport(current);
      } else if (step === "reconcile") setScreen({ name: "workbench", sessionId: id });
      else if (step === "review") setScreen({ name: "review", sessionId: id });
      else if (step === "applied") setScreen({ name: "result", sessionId: id });
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
      /*
       * Staged, because this is the longest unexplained wait in the feature.
       * Applying says "Writing 12 of 200"; matching said only "Matching…" while
       * it fetched a candidate window over the network and then scored several
       * hundred rows against it — seconds of silence with no sense of progress
       * or of which part was slow.
       */
      setMatchStage("Loading transactions from Actual…");

      try {
        const window = await loadCandidateWindow(connection, {
          accountId: input.accountId,
          statementStart: input.statementPeriod.start,
          statementEnd: input.statementPeriod.end,
          matchToleranceDays: input.config.dateToleranceDays,
          paddingDays: input.config.candidatePaddingDays,
        });

        setMatchStage(
          `Matching ${input.statementRows.length} statement row${
            input.statementRows.length === 1 ? "" : "s"
          } against ${window.transactions.length}…`
        );
        // Yielded to the browser so the stage above actually paints before the
        // matcher takes the thread for a few hundred rows.
        await new Promise((resolve) => setTimeout(resolve, 0));

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

        setMatchStage("Saving the results…");
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
            // Recorded so importing the same statement again can be recognised
            // and questioned rather than quietly reconciled twice.
            statementFingerprint: fingerprintStatement(input.statementRows),
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
        setMatchStage(null);
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
     * Before anything is written, every row the plan touches is re-read and
     * compared against what this session saw when it loaded. A session can be
     * hours or days old, and Actual is not frozen in the meantime: a note edited
     * elsewhere would otherwise be overwritten by a staged change, and an amount
     * corrected elsewhere would be reverted by an update that was never about the
     * amount at all. Rows that moved harmlessly are brought up to date and applied;
     * rows where the user's own edit is at stake are withheld and reported, and
     * writing proceeds only when they press Apply a second time.
     *
     * Markers already in the account are read too, so a create that succeeded in
     * an earlier attempt is recognised and skipped even if this session's own
     * record of it was lost. Each outcome is persisted as it happens rather than
     * in one write at the end, so an interruption leaves a truthful record.
     */
    async function handleApply() {
      const session = sessionQuery.data?.session;
      if (!connection || !session || applyPlan.operations.length === 0) return;

      setMatchError(null);
      // A previous run's check describes a previous run.
      setVerification(null);
      const transport = createReconciliationTransport(getTransport(connection));

      let plan = applyPlan;
      try {
        setIsCheckingDrift(true);
        const targets = driftTargets(applyPlan);
        const dates = snapshot.map((transaction) => transaction.date).sort();
        const latest = await loadLatestForDrift({
          transport,
          accountId: session.accountId,
          transactionIds: targets,
          startDate: dates[0] ?? session.statementStart ?? "",
          endDate: dates[dates.length - 1] ?? session.statementEnd ?? "",
        });

        const checked = reconcilePlanWithDrift({
          plan: applyPlan,
          snapshots: transactionsById,
          latest,
        });
        plan = checked.plan;
        setDriftReport(checked.report);

        // Something is at stake that only the user can settle. Report it and
        // write nothing; pressing Apply again proceeds with the rest.
        //
        // The screen is set explicitly because a retry can arrive from the result
        // screen, and a warning shown somewhere the user is not looking is the
        // same as no warning at all.
        if (checked.report.withheld.length > 0 && !driftAcknowledged) {
          setDriftAcknowledged(true);
          setScreen({ name: "review", sessionId: session.id });
          return;
        }
        if (plan.operations.length === 0) return;
      } catch (error) {
        setMatchError(
          error instanceof Error
            ? `Could not check for changes made in Actual: ${error.message}`
            : "Could not check for changes made in Actual"
        );
        return;
      } finally {
        setIsCheckingDrift(false);
      }

      setIsApplying(true);
      setApplyProgress({ done: 0, total: plan.operations.length });

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
        let lastProgressAt = 0;
        let pending = false;

        const flush = async (force: boolean) => {
          if (!pending && !force) return;
          const now = Date.now();
          if (!force && now - lastFlush < PROGRESS_FLUSH_MS) return;
          lastFlush = now;
          pending = false;
          // Merged, not replaced: a retry's results describe only what it ran,
          // and overwriting would erase every operation that already succeeded.
          await updateSessionQuietly(session.id, {
            applyResults: mergeOperationResults(previousResults, collected),
          });
        };

        const result = await executeApplyPlan({
          plan,
          transport,
          existingMarkers,
          previousResults,
          onResult: async (entry) => {
            collected.push(entry);
            pending = true;
            await flush(false);
          },
          onProgress: (progress) => {
            // Throttled: the review screen stays mounted during a run, and its
            // comparison table redraws every row on each state change. Updating
            // per operation makes the UI the bottleneck rather than the writes.
            const now = Date.now();
            const finished = progress.completed >= progress.total;
            if (!finished && now - lastProgressAt < PROGRESS_UI_MS) return;
            lastProgressAt = now;
            setApplyProgress({ done: progress.completed, total: progress.total });
          },
        });

        await flush(true);

        // The session's whole history, not just this run's part of it. The result
        // screen reports what the *session* did, and the plan reads this back to
        // decide what is left — so a retry that replaced it would resurrect work
        // that had already been written.
        const history = mergeOperationResults(previousResults, result.results);
        const totals = summarizeResults(history);
        setApplyResult({ results: history, ...totals });

        // One invalidating write at the end, so the session list and the
        // workbench refresh once rather than once per operation.
        await mutations.updateSession.mutateAsync({
          id: session.id,
          payload: {
            applyResults: history,
            status: totals.complete ? "completed" : "partial",
            appliedAt: new Date().toISOString(),
          },
        });

        // Direct-mode writes need the browser runtime told about them.
        await getTransport(connection).sync();

        // Read the account back and compare it against what was approved. A
        // transport reporting success for a field it dropped, or a create that
        // landed twice, is invisible from the write side alone.
        setIsVerifying(true);
        try {
          const dates = plan.operations.map((operation) => operation.date).sort();
          const window = await transport.loadTransactions({
            accountId: session.accountId,
            startDate: dates[0] ?? session.statementStart ?? "",
            endDate: dates[dates.length - 1] ?? session.statementEnd ?? "",
          });
          setVerification(
            verifyApply({
              plan,
              results: result.results,
              latest: window.transactions,
              snapshots: transactionsById,
            })
          );
        } catch {
          // A check that cannot run is not a failed apply, and saying nothing is
          // better than reporting problems it did not actually find.
          setVerification(null);
        } finally {
          setIsVerifying(false);
        }

        // A retry is a fresh decision: whatever was withheld a moment ago has to
        // be put in front of the user again rather than carried through on an
        // acknowledgement they gave about a different run.
        setDriftAcknowledged(false);
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
      // A session that has already matched can be re-imported, so leaving here
      // should return to the work rather than abandoning it.
      const hasParsedStatement = Boolean(sessionQuery.data?.session.statementStart);

      return (
        <PageLayout
          title="Bank Reconciliation"
          actions={
            <PhaseNav
              back={
                // Only when there is a workbench to go back to. On a first
                // import there is no previous phase; leaving is what the exit
                // in the header is for.
                hasParsedStatement
                  ? {
                      label: "Back to the workbench",
                      onClick: () => setScreen({ name: "workbench", sessionId: screen.sessionId }),
                      disabled: isMatching,
                    }
                  : undefined
              }
              next={{
                label: isMatching ? "Matching…" : "Match against Actual",
                progress: matchStage,
                onClick: () => {
                  if (pendingStatement) {
                    void handleParsed(pendingStatement.result, pendingStatement.fileName);
                  }
                },
                disabled: !pendingStatement,
                busy: isMatching,
              }}
            />
          }
          scrollManaged
        >
          <SessionHeader
            session={sessionQuery.data?.session}
            current="import"
            // Navigable only once the session has a statement to go back to.
            // On a first import there is no workbench yet, so the steps would
            // lead nowhere.
            onNavigate={
              hasParsedStatement ? (step) => goToStep(step, screen.sessionId) : undefined
            }
            onExit={() => setScreen({ name: "home" })}
          />
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
            knownStatements={(sessionsQuery.data ?? [])
              // The session being imported into has no statement yet, so it can
              // never be its own duplicate.
              .filter((entry) => entry.statementFingerprint && entry.id !== screen.sessionId)
              .map((entry) => ({
                fingerprint: entry.statementFingerprint!,
                accountName: entry.accountName,
                tag: entry.tag,
                createdAt: entry.createdAt,
              }))}
            onReadyChange={handleStatementReady}
          />
        </PageLayout>
      );
    }

    if (screen.name === "review" || screen.name === "result") {
      const session = sessionQuery.data?.session;

      // What Apply will actually do, once drift has withheld anything it must.
      const withheldCount = driftReport?.withheld.length ?? 0;
      const applicableChanges = Math.max(applyPlan.operations.length - withheldCount, 0);
      const applyButtonLabel =
        applicableChanges === 0
          ? "Nothing to apply"
          : withheldCount > 0
            ? `Apply the other ${applicableChanges} change${applicableChanges === 1 ? "" : "s"}`
            : `Apply ${applicableChanges} change${applicableChanges === 1 ? "" : "s"}`;

      return (
        <PageLayout
          title="Bank Reconciliation"
          actions={
            <PhaseNav
              back={{
                label: "Back to the workbench",
                disabled: isApplying || isCheckingDrift,
                onClick: () => {
                  setDriftReport(null);
                  setDriftAcknowledged(false);
                  setScreen({ name: "workbench", sessionId: screen.sessionId });
                },
              }}
              /*
               * Finishing is a step, and it had no button. On the result screen
               * the primary slot stood empty exactly when the user was most
               * likely to be done, so leaving meant retreating through the
               * workbench — a screen an applied session can no longer use.
               */
              secondary={
                screen.name === "result" && applyResult && !applyResult.complete
                  ? { label: "Done", onClick: () => setScreen({ name: "home" }) }
                  : undefined
              }
              next={
                screen.name === "review"
                  ? {
                      label: applyButtonLabel,
                      onClick: () => void handleApply(),
                      disabled: applicableChanges === 0,
                      busy: isApplying || isCheckingDrift,
                      progress: isCheckingDrift
                        ? "Checking what has changed in Actual…"
                        : applyProgress
                          ? `Writing ${applyProgress.done} of ${applyProgress.total}…`
                          : null,
                    }
                  : applyResult && !applyResult.complete
                    ? {
                        // Still something to put right, so retrying stays the
                        // primary and finishing sits beside it.
                        label: "Retry what failed",
                        onClick: () => void handleApply(),
                        busy: isApplying,
                      }
                    : {
                        label: "Done",
                        onClick: () => setScreen({ name: "home" }),
                      }
              }
            />
          }
          scrollManaged
        >
          <SessionHeader
            session={session}
            current={screen.name === "review" ? "review" : "applied"}
            period={period}
            statementName={statementName}
            onNavigate={(step) => goToStep(step, screen.sessionId)}
            blockedSteps={
              rematchBlockedReason ? { import: rematchBlockedReason } : undefined
            }
            onExit={() => setScreen({ name: "home" })}
          />
          {matchError && (
            <p role="alert" className="px-4 pt-3 text-xs text-destructive">
              {matchError}
            </p>
          )}
          {screen.name === "review" ? (
            <ReviewPanel
              plan={applyPlan}
              items={items}
              statementRows={statementRowsById}
              transactions={transactionsById}
              payees={payeeOptions}
              categories={categoryOptions}
              drift={driftReport}
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
            />
          ) : (
            applyResult && (
              <ApplyResultPanel
                plan={fullPlan}
                items={items}
                statementRows={statementRowsById}
                transactions={transactionsById}
                payees={payeeOptions}
                applyConfig={applyConfig}
                result={applyResult}
                verification={verification}
                isVerifying={isVerifying}
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
            <PhaseNav
              secondary={
                session
                  ? {
                      label: "Import again",
                      onClick: () => reimport(session),
                      // Refused on an applied session for the same reason
                      // re-running the match is: importing again rebuilds the
                      // rows, which orphans the record of what was written and
                      // would offer the same transactions for a second write.
                      disabled: isMatching || Boolean(rematchBlockedReason),
                      title: rematchBlockedReason ?? undefined,
                    }
                  : undefined
              }
              next={{
                label:
                  applyPlan.operations.length === 0
                    ? "Nothing to review"
                    : `Review ${applyPlan.operations.length} change${
                        applyPlan.operations.length === 1 ? "" : "s"
                      }`,
                onClick: () => setScreen({ name: "review", sessionId: screen.sessionId }),
                disabled: applyPlan.operations.length === 0,
              }}
            />
          }
          scrollManaged
        >
          <SessionHeader
            session={session}
            current="reconcile"
            period={period}
            statementName={statementName}
            onNavigate={(step) => goToStep(step, screen.sessionId)}
            blockedSteps={
              rematchBlockedReason ? { import: rematchBlockedReason } : undefined
            }
            onExit={() => setScreen({ name: "home" })}
          />
          {matchError && (
            <p role="alert" className="px-4 pt-3 text-xs text-destructive">
              {matchError}
            </p>
          )}
          <Workbench
            items={items}
            statementRows={statementRowsById}
            transactions={transactionsById}
            coverage={coverage}
            matchConfig={matchConfig}
            matchPreset={matchPreset}
            isMatching={isMatching}
            canRematch={canRematch}
            rematchBlockedReason={rematchBlockedReason}
          readOnly={Boolean(rematchBlockedReason)}
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
            onViewResult={
              applyResult
                ? () => setScreen({ name: "result", sessionId: screen.sessionId })
                : undefined
            }
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
        actions={
          <Button size="sm" onClick={() => setNewSessionOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New reconciliation
          </Button>
        }
      >
        {/* Starting a session fails *here*, on the list, so the message has to
            be here too — the other screens render it, but this is the one the
            user is looking at when the write is refused. */}
        {matchError && (
          <p role="alert" className="px-4 pt-3 text-xs text-destructive">
            {matchError}
          </p>
        )}

        <NewSessionDialog
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
          accounts={visibleAccounts.map((account) => ({ id: account.id, name: account.name }))}
          knownTags={[
            ...new Set(
              (sessionsQuery.data ?? [])
                .map((session) => session.tag)
                .filter((tag): tag is string => Boolean(tag))
            ),
          ].sort()}
          isCreating={mutations.createSession.isPending}
          onStart={(id, tag) => {
            setAccountId(id);
            void startSession(id, tag);
          }}
        />

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
            onDelete={(session) => {
              // Deleting takes the statement rows and every decision staged
              // against them with it, and there is no undo — one stray click on
              // a trash icon should not be able to do that.
              const decided = rowCountOf(session);
              setConfirm({
                title: "Delete this reconciliation?",
                message: (
                  <>
                    {session.accountName ?? "This account"}
                    {session.tag ? ` · ${session.tag}` : ""}
                    {decided !== null ? ` · ${decided} statement rows` : ""}. The statement and every
                    decision staged against it are removed. Nothing in your budget changes, and
                    anything already applied stays applied.
                  </>
                ),
                onConfirm: () => void mutations.deleteSession.mutateAsync(session.id),
              });
            }}
          onRetag={(session, tag) =>
            void mutations.updateSession.mutateAsync({ id: session.id, payload: { tag } })
          }
          onNew={() => setNewSessionOpen(true)}
        />
      </PageLayout>
    );
  }

  return (
    <>
      {renderScreen()}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        state={confirm}
      />
    </>
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
