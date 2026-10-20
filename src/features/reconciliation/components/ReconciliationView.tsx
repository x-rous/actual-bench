"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  REASON,
  applyDisposition,
  correctAmountFromStatement,
  linkManually,
  resolveToTransaction,
  resolveSingleCandidateTransactions,
  summarizeCoverage,
} from "@/lib/reconciliation/session/build";
import {
  fingerprintStatement,
  type NormalizedStatement,
  type StatementFormat,
} from "@/lib/reconciliation/statement/normalize";
import type {
  ActualTransactionSnapshot,
  MatchConfig,
  ReconciliationItem,
  StagedPatch,
  StatementRow,
} from "@/lib/reconciliation/types";
import { useStagedStore } from "@/store/staged";
import { useStagedAccounts, useStagedCategories, useStagedPayees } from "@/hooks/useStagedEntities";
import { usePayees } from "@/features/payees/hooks/usePayees";
import { useCategoryGroups } from "@/features/categories/hooks/useCategoryGroups";
import {
  canStageField,
  stageField,
  unstageField,
  type StageableField,
} from "@/lib/reconciliation/session/staging";
import type { ReconciliationDisposition } from "@/lib/reconciliation/types";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useAccounts } from "@/features/accounts/hooks/useAccounts";
import {
  loadCandidateWindow,
  refreshBudget,
  resumeWindowInput,
} from "../lib/loadCandidates";
import {
  DEFAULT_APPLY_CONFIG,
  buildApplyPlan,
  createMarker,
  normalizeApplyConfig,
  type ApplyConfig,
} from "@/lib/reconciliation/session/plan";
import { prospectiveTransaction } from "@/lib/reconciliation/session/prospective";
import { decisionSignature } from "@/lib/reconciliation/session/signature";
import { sessionCommand, saveWork, updateSession as updateSessionQuietly } from "../lib/reconciliationApi";
import {
  withoutOperations,
  writeActionLabel,
} from "../lib/writeSummary";
import { applyConfigAfterLeavingReview } from "../lib/reviewSettings";
import { executeApplyPlan, type ApplyRunResult } from "@/lib/reconciliation/apply/executor";
import {
  driftTargets,
  reconcilePlanWithDrift,
  type DriftReport,
} from "@/lib/reconciliation/apply/drift";
import { loadLatestForDrift } from "../lib/loadDrift";
import { recoverApply } from "@/lib/reconciliation/apply/recovery";
import { verifyApply, type VerificationReport } from "@/lib/reconciliation/apply/verification";
import {
  findPossiblePairs,
  wouldWrite,
  type PossiblePair,
} from "@/lib/reconciliation/session/possiblePairs";
import {
  diagnoseInvertedSigns,
  invertStatementRows,
} from "@/lib/reconciliation/session/invertedSigns";
import { buildTextCorpus } from "@/lib/reconciliation/match/text";
import {
  mergeOperationResults,
  summarizeResults,
  type OperationResult,
  type ApplyPlan,
} from "@/lib/reconciliation/apply/operations";
import { createReconciliationTransport } from "@/lib/reconciliation/transportAdapter";
import { getTransport } from "@/lib/actual";
import { ApplyResultPanel } from "./ApplyResultPanel";
import { ReviewPanel } from "./ReviewPanel";
import { PhaseNav } from "./PhaseNav";
import { SessionHeader, type SessionStep } from "./SessionHeader";
import {
  useReconciliationMutations,
  usePdfStatementLayouts,
  useReconciliationProfiles,
  useReconciliationSession,
  useReconciliationSessions,
} from "../hooks/useReconciliation";
import type {
  ReconciliationProfileRecord,
  ReconciliationSessionRecord,
} from "../lib/reconciliationApi";
import { ImportPanel } from "./ImportPanel";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { NewSessionDialog } from "./NewSessionDialog";
import { CardStatementFigures, ReviewCardStatementLink, useRegisteredCards } from "@/features/credit-cards/components/CardStatementFigures";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { resolveAccountClass } from "@/lib/account-class";
import type { Card } from "@/features/credit-cards/lib/models";
import { ReviewGateDialog } from "./ReviewGateDialog";
import { SessionList, rowCountOf } from "./SessionList";
import { Workbench } from "./Workbench";

/**
 * How often apply progress is written while a run is in flight. Frequent enough
 * that an interruption loses little, rare enough that persistence does not
 * dominate the run.
 */
const PROGRESS_FLUSH_MS = 1000;

/** How often the on-screen counter moves. Often enough to read, rarely enough
 * that redrawing the review table does not compete with the writing. */
const PROGRESS_UI_MS = 250;

/**
 * The step a session is opened on.
 *
 * Opening always landed on the reconcile step, which for a draft meant a
 * workbench with nothing in it and for an applied session meant the step
 * before the result the reader came back to see. A session knows how far it
 * has got, so it opens where its work is.
 *
 * A partial apply opens on its result because that is where the failures are
 * listed; the result screen keeps its own way back into the workbench for the
 * rows that still need work.
 */
function screenForSession(session: ReconciliationSessionRecord): Screen {
  if (session.status === "draft") {
    return {
      name: "import",
      sessionId: session.id,
      accountId: session.accountId,
      accountName: session.accountName ?? "this account",
    };
  }
  if (session.status === "completed" || session.status === "partial") {
    return { name: "result", sessionId: session.id };
  }
  return { name: "workbench", sessionId: session.id };
}

type Screen =
  | { name: "home" }
  | { name: "import"; sessionId: string; accountId: string; accountName: string }
  | { name: "workbench"; sessionId: string }
  | { name: "review"; sessionId: string }
  | { name: "result"; sessionId: string };

export function ReconciliationView() {
  const connection = useConnectionStore(selectActiveInstance);
  const identity = connection ? JSON.stringify([connection.id, connection.mode, connection.baseUrl, connection.budgetSyncId]) : "disconnected";
  return <ReconciliationSessionView key={identity} />;
}

function ReconciliationSessionView() {
  const connection = useConnectionStore(selectActiveInstance);
  useAccounts();
  const accounts = useStagedStore((state) => state.accounts);
  // Credit cards (PR-128): a reconciliation can also enter the card's bank statement figures.
  const accountClasses = useAccountClasses();
  const { cards: registeredCards } = useRegisteredCards(connection);
  const [cardFigures, setCardFigures] = useState<{ sessionId: string; card: Card; cardName: string; statementId: string | null } | null>(null);
  /** Opens the card statement figures for a session's card: the linked statement, or a new choice. */
  function openCardFigures(session: ReconciliationSessionRecord | undefined) {
    const card = session ? registeredCards.find((entry) => entry.accountId === session.accountId) : undefined;
    if (session && card) setCardFigures({ sessionId: session.id, card, cardName: session.accountName ?? "Credit card", statementId: session.cardStatementId });
  }

  usePayees();
  useCategoryGroups();
  const { groups: accountGroups } = useStagedAccounts();
  const payeeOptions = useStagedPayees();
  const { categories: stagedCategories, groups: categoryGroups } = useStagedCategories();

  const sessionsQuery = useReconciliationSessions();
  const mutations = useReconciliationMutations();

  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [accountId, setAccountId] = useState<string>("");

  // The Actual side of the workbench: the candidate window as it stands now,
  // loaded at match time and re-read when a session is resumed. What the session
  // *matched against* is `baselines` below — the two were one field until
  // refreshing the grid started moving the drift baseline with it.
  const [snapshot, setSnapshot] = useState<ActualTransactionSnapshot[]>([]);
  /**
   * Whether the transport reported transfer membership for the loaded window.
   *
   * `false` means *unknown*, not *no transfers* — `transferStatusOf` reads it
   * that way and `canStageDelete` blocks on it. It starts pessimistic so a
   * session whose window has not been read cannot authorise a delete on an
   * assumption (F-151d).
   */
  const [transfersReported, setTransfersReported] = useState(false);
  /** True while the Actual side is the persisted copy rather than a fresh read. */
  const [snapshotIsStored, setSnapshotIsStored] = useState(false);
  /**
   * What each transaction looked like when the session was matched — the thing
   * drift is measured from, kept deliberately apart from the live window.
   *
   * Refreshing the grid must not refresh this. `replaceItems` rewrites every
   * item's stored snapshot, so reading the baseline out of a re-read window
   * would quietly move it forward and absorb exactly the change the pre-flight
   * check exists to catch.
   */
  const [baselines, setBaselines] = useState<Map<string, ActualTransactionSnapshot>>(new Map());
  const [parsedRows, setParsedRows] = useState<StatementRow[]>([]);
  const [items, setItemsState] = useState<ReconciliationItem[]>([]);
  const itemsRef = useRef(items);
  const setItems = useCallback((next: ReconciliationItem[] | ((previous: ReconciliationItem[]) => ReconciliationItem[])) => {
    const value = typeof next === "function" ? next(itemsRef.current) : next;
    itemsRef.current = value;
    setItemsState(value);
  }, []);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function ensureConnection() {
    const current = selectActiveInstance(useConnectionStore.getState());
    if (!mounted.current || !connection || current?.id !== connection.id || current.budgetSyncId !== connection.budgetSyncId ||
      current.baseUrl !== connection.baseUrl || current.mode !== connection.mode) {
      throw new Error("The active connection changed. Reopen the reconciliation on its budget.");
    }
  }
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
  const [checkedPlan, setCheckedPlan] = useState<ApplyPlan | null>(null);
  const acknowledgedDrift = useRef<string | null>(null);
  const applyRunning = useRef(false);
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
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
    format: StatementFormat | null;
  } | null>(null);

  /**
   * Stable, because the import panel reports upward from an effect that depends
   * on it. An inline arrow would be a new function every render, so the effect
   * would fire every render, store a fresh object, and re-render — a loop.
   * React Compiler would probably memoise it away, but a render loop is not
   * something to leave resting on that.
   */
  const handleStatementReady = useCallback(
    (
      result: NormalizedStatement | null,
      fileName: string | null,
      format: StatementFormat | null
    ) => {
      setPendingStatement(result ? { result, fileName, format } : null);
    },
    []
  );
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  /** The last bulk action's prior state, so one press can reverse it. */
  const [lastBulk, setLastBulk] = useState<{
    label: string;
    before: ReconciliationItem[];
  } | null>(null);

  // Matching options live with the session (and, once saved, the import
  // profile) because they describe how this account's transactions are created.
  const [matchConfig, setMatchConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const [matchPreset, setMatchPreset] = useState<TextTargetPreset>(DEFAULT_TEXT_PRESET);

  // Profiles are per account, so the panel can propose the one this account
  // used last rather than making the user configure the same statement layout
  // every month.
  const profileAccountId = screen.name === "import" ? screen.accountId : accountId || undefined;
  const profilesQuery = useReconciliationProfiles(profileAccountId);
  const pdfStatementLayoutsQuery = usePdfStatementLayouts(profileAccountId);

  const sessionId = screen.name === "home" ? null : screen.sessionId;
  const sessionQuery = useReconciliationSession(sessionId);

  /**
   * Rehydrate a resumed session from the app database.
   *
   * A session outlives the component, so returning to one must rebuild the
   * workbench from what was persisted rather than showing an empty grid.
   *
   * The statement side and every decision come from the database untouched. The
   * **Actual side is re-read**, because the stored snapshots cannot serve it: an
   * item persists one snapshot — the drift baseline for the transaction it was
   * decided on — while a review item may offer five candidates, and rebuilding
   * the grid from those silently dropped the other four (F-151c). Their guards
   * then defaulted permissive, so a reconciled row or a transfer leg released
   * after a reload became deletable (F-151d).
   *
   * Re-reading needs nothing new: `loadCandidateWindow` is a function of the
   * account and the persisted period and match config, so it returns the same
   * window the session matched against — current, complete, and carrying the
   * transport's real `transfersReported`.
   *
   * The graph is *not* recomputed. Items, dispositions and staged changes are
   * read as they were stored; only the Actual-side data behind them refreshes.
   * A failed current read leaves editing and Apply disabled. Stored snapshots
   * remain available only for conflict checks and historical results.
   */
  const hydratedSessionId = sessionQuery.data?.session.id;
  useEffect(() => {
    const data = sessionQuery.data;
    // Any screen that names a session, not the workbench alone: opening an
    // applied session lands on the apply screen, and hydrating only on the
    // workbench left it blank until the user walked back through match.
    if (!data || data.session.id !== sessionId) return;
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
        importedPayee: row.importedPayee,
        bankNotes: row.bankNotes ?? undefined,
        bankReference: row.bankReference ?? undefined,
        externalId: row.externalId ?? undefined,
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
    // The rows this would have reversed are gone, and `updateItem` would find
    // none of their ids - so the control would sit there offering to undo
    // nothing. Cleared wherever the item set is replaced, which is here and at
    // the end of a match.
    setLastBulk(null);
    const stored = data.items
      .map((item) => item.actualSnapshot as ActualTransactionSnapshot | null)
      .filter((snapshot): snapshot is ActualTransactionSnapshot => snapshot != null);
    setSnapshot([]);
    // The stored copies are the baselines by definition: each is what its item
    // was decided against.
    setBaselines(new Map(stored.map((transaction) => [transaction.id, transaction])));
    // Pessimistic until the re-read says otherwise: `false` means "unknown" to
    // `transferStatusOf`, and a session whose transfer data has not been
    // confirmed must not authorise a delete on an assumption.
    setTransfersReported(false);
    setSnapshotIsStored(true);

    // Rebuild what the last apply did, from the record kept as it happened.
    // Without this the outcome is written faithfully to the database and then
    // unreachable: reopening an applied session landed on the grid with no way
    // to see what was written, or what failed and could be retried.
    const persisted = Array.isArray(data.session.applyResults)
      ? (data.session.applyResults as OperationResult[])
      : data.session.status === "completed" ? [] : null;
    setApplyResult(
      persisted && (persisted.length > 0 || data.session.status === "completed")
        ? { results: persisted, ...summarizeResults(persisted) }
        : null
    );
    setPeriod(data.session.statementStart && data.session.statementEnd
      ? { start: data.session.statementStart, end: data.session.statementEnd } : null);
    setStatementName(data.session.statementName);
    const savedMatch = data.session.matchConfig as Partial<MatchConfig> | null;
    setMatchConfig({ ...DEFAULT_MATCH_CONFIG, ...savedMatch,
      text: { ...DEFAULT_MATCH_CONFIG.text, ...savedMatch?.text } });
    setMatchPreset(DEFAULT_TEXT_PRESET);
    setAccountId(data.session.accountId);
    setVerification(null);
    setDriftReport(null);
    // Read through the normaliser: a session saved before the notes model
    // changed still carries the old three-way `notesStrategy`.
    setApplyConfig(normalizeApplyConfig(data.session.applyConfig));
    setLoadedSessionId(data.session.id);
  }, [sessionQuery.data, hydratedSessionId, sessionId, loadedSessionId, setItems]);

  /**
   * Pair a statement row with a transaction the matcher never related.
   *
   * At component scope rather than inside the screen, because the possible-pairs
   * dialog offers the same action from outside any one screen's render.
   *
   * Rows are removed as well as changed - the transaction's own row is
   * absorbed into the pair - so the whole set is rewritten rather than
   * patched, the same as resolving a candidate.
   */
  function handleManualMatch(statementItemId: string, actualItemId: string) {
    if (snapshotIsStored || applyRunning.current || sessionStatus === "applying" || sessionStatus === "completed" ||
        appliedItemIds.has(statementItemId) || appliedItemIds.has(actualItemId)) return;
    const next = linkManually({
      items: itemsRef.current,
      statementItemId,
      actualItemId,
      statementRows: statementRowsById,
      transactions: transactionsById,
      transfersReported,
    });
    // Null when the two rows are not a statement row and a transaction. The
    // toolbar only offers the action for that shape, so this is defence in
    // depth rather than a path the UI can reach.
    if (!next) return;

    // The link absorbs the Actual-only row into the statement row, so a bulk
    // undo can no longer put things back: `updateItem` restores fields on ids
    // that still exist and silently skips the one that does not. The statement
    // row would return to "create" while still holding the transaction - and
    // then create a second copy of it. Same rule as hydration and re-matching:
    // when the rows change, the undo that referred to them is spent.
    setLastBulk(null);
    setItems(next);
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
          actualSnapshot: baselineFor(entry),
          stagedChanges: entry.stagedChanges ?? null,
        })),
      })
      .catch((error: unknown) => {
        setMatchError(error instanceof Error ? error.message : "Could not link those rows");
      });
  }

  /**
   * Refresh the Actual side of a resumed session.
   *
   * Hydration keeps the grid disabled until the current read completes,
   * but those are drift baselines: one per item, for the transaction it was
   * decided on. A review item offering five candidates stores one, so the
   * workbench rebuilt from them shows a five-candidate decision as a
   * one-candidate decision, and the four it cannot resolve fall back to
   * permissive guards (F-151c / F-151d).
   *
   * So the window is read again. Nothing new is needed for it: the account, the
   * statement period and the match config are all persisted, and
   * `loadCandidateWindow` is a function of exactly those - it returns the same
   * window the session matched against, current and complete.
   *
   * Decisions are untouched. This refreshes the data behind the graph, never the
   * graph. A failure leaves decisions disabled and offers a retry; historical
   * results can still use their saved comparison evidence.
   */
  useEffect(() => {
    if (!snapshotIsStored || !connection) return;
    const session = sessionQuery.data?.session;
    if (!session || loadedSessionId !== session.id || session.budgetSyncId !== connection.budgetSyncId) return;

    const input = resumeWindowInput(session);
    if (!input) return;
    let cancelled = false;

    void (async () => {
      if (!await refreshBudget(connection)) throw new Error("Could not refresh Actual. Retry before making decisions.");
      const window = await loadCandidateWindow(connection, input);
      if (cancelled) return;
      const ids = new Set(window.transactions.map((row) => row.id));
      const transport = createReconciliationTransport(getTransport(connection));
      for (const id of new Set(itemsRef.current.flatMap((item) => item.actualTransactionIds))) {
        if (ids.has(id)) continue;
        const row = await transport.readTransaction({ accountId: session.accountId, transactionId: id });
        if (cancelled) return;
        if (row) { window.transactions.push(row); ids.add(id); }
      }
      const current = new Map(window.transactions.map((row) => [row.id, row]));
      const previous = itemsRef.current;
      const represented = new Set(previous.flatMap((item) => item.actualTransactionIds));
      const fingerprints = new Map((sessionQuery.data?.statementRows ?? []).map((row) => [row.id, row.fingerprint]));
      const ownMarkers = new Set(previous.filter((item) => item.disposition === "create").map((item) =>
        createMarker({ budgetSyncId: session.budgetSyncId, accountId: session.accountId, sessionId: session.id,
          fingerprint: fingerprints.get(item.statementRowIds[0]) ?? "" })));
      const frozen = new Set((Array.isArray(session.applyResults) ? session.applyResults as OperationResult[] : [])
        .filter((result) => result.status === "applied" || result.status === "skipped").map((result) => result.operationId));
      const refreshed = previous.map((item) => {
        const row = current.get(item.actualTransactionIds[0]);
        const applied = ["create", "update", "delete"].some((kind) => frozen.has(`${kind}:${item.id}`));
        return row && !applied && session.status !== "applying" ? { ...item, guards: { protectedReconciled: row.reconciled, splitParent: row.isParent,
          transfer: (!window.transfersReported ? "unknown" : row.transferId ? "yes" : "no") as ReconciliationItem["guards"]["transfer"] } } : item;
      });
      const added = session.status === "completed" || session.status === "applying" ? [] : window.transactions.filter((row) =>
        !represented.has(row.id) && !ownMarkers.has(row.importedId ?? "") &&
        row.date >= window.visible.start && row.date <= window.visible.end);
      const next = [...refreshed, ...added.map((row): ReconciliationItem => ({ id: generateId(), statementRowIds: [],
        actualTransactionIds: [row.id],
        disposition: row.date < session.statementStart! || row.date > session.statementEnd! ? "keep" : "unresolved",
        reasonCode: row.date < session.statementStart! || row.date > session.statementEnd! ? REASON.outsideStatementPeriod : REASON.notOnStatement,
        guards: { protectedReconciled: row.reconciled, splitParent: row.isParent,
          transfer: !window.transfersReported ? "unknown" : row.transferId ? "yes" : "no" } }))];
      if (added.length) {
        await saveWork(session.id, { items: next.map((item) => ({ ...item,
          actualSnapshot: baselines.get(item.actualTransactionIds[0]) ?? current.get(item.actualTransactionIds[0]) ?? null,
          stagedChanges: item.stagedChanges ?? null })) });
        if (cancelled) return;
      }
      setItems(next); setSnapshot(window.transactions);
      setTransfersReported(window.transfersReported); setSnapshotIsStored(false);
    })().catch((error: unknown) => {
      if (!cancelled) setMatchError(error instanceof Error ? error.message : "Could not load current Actual transactions");
    });

    return () => {
      cancelled = true;
    };
  }, [snapshotIsStored, connection, sessionQuery.data?.session, loadedSessionId, resumeAttempt, setItems, baselines, sessionQuery.data?.statementRows]);

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

  /**
   * The snapshot to persist as an item's drift baseline.
   *
   * Prefers what the session recorded over what Actual says now. A transaction
   * that has no baseline was never part of a decision - a candidate the re-read
   * surfaced, say - so the current row becomes its baseline the first time it is
   * written, which is the same rule matching follows.
   */
  const baselineFor = useCallback(
    (item: ReconciliationItem): ActualTransactionSnapshot | null => {
      const id = item.actualTransactionIds[0];
      if (!id) return null;
      return baselines.get(id) ?? transactionsById.get(id) ?? null;
    },
    [baselines, transactionsById]
  );

  // Named by group, so the category pickers can head each group without the
  // group list being threaded through every panel.
  const categoryOptions = useMemo(() => {
    const groupNames = new Map(categoryGroups.map((group) => [group.id, group.name]));
    return stagedCategories.map((category) => ({ ...category, groupName: groupNames.get(category.groupId) }));
  }, [stagedCategories, categoryGroups]);

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

  const appliedItemIds = useMemo(() => new Set(items.filter((item) =>
    ["create", "update", "delete"].some((kind) => appliedOperationIds?.has(`${kind}:${item.id}`))
  ).map((item) => item.id)), [items, appliedOperationIds]);
  const historicalTransactions = useMemo(() => new Map([...transactionsById, ...baselines]), [transactionsById, baselines]);

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
        transactions: historicalTransactions,
        applyConfig,
        statementFormat: sessionQuery.data?.session.statementFormat ?? null,
      }),
    [
      sessionId,
      connection,
      sessionQuery.data,
      items,
      statementRowsById,
      historicalTransactions,
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
        statementFormat: sessionQuery.data?.session.statementFormat ?? null,
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

  useEffect(() => {
    setCheckedPlan(null);
    acknowledgedDrift.current = null;
  }, [items, applyConfig, sessionId]);

  /*
   * Statement rows and transactions that look like the same thing.
   *
   * Read from the items rather than the plan, so a pair is offered while it can
   * still be linked instead of after two decisions have been staged against it.
   * The config and the corpus live here, so the wiring does too; the engine
   * stays transport-free.
   */
  const possiblePairs = useMemo(
    () =>
      findPossiblePairs({
        items,
        statementRows: statementRowsById,
        transactions: transactionsById,
        text: matchConfig.text,
        needleFloor: matchConfig.needleFloor,
        corpus: buildTextCorpus(snapshot.map((transaction) => transaction.notes)),
      }),
    [items, statementRowsById, transactionsById, matchConfig, snapshot]
  );

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  /**
   * Pairs still worth stopping someone for on the way to Review.
   *
   * Narrower than what the workbench shows, on purpose. A pair neither side of
   * which is staged writes nothing, and interrupting for it is how a dialog
   * becomes something people dismiss without reading. Dismissals are remembered
   * for the session only — persistence was judged not worth a schema change.
   */
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set());
  const [reviewGateFor, setReviewGateFor] = useState<string | null>(null);

  const gatePairs = useMemo(
    () =>
      possiblePairs.filter(
        (pair) => wouldWrite(pair, itemsById) && !dismissedPairs.has(pairKey(pair))
      ),
    [possiblePairs, itemsById, dismissedPairs]
  );

  /**
   * Rows with no decision, split by side.
   *
   * Undecided rows are safe - nothing is written for them - so this never
   * blocks. But the two sides do not weigh the same: a statement row left
   * undecided is a transaction that happened and will not be recorded, while an
   * Actual row the statement never mentioned is fine left alone. Saying which
   * is which is what makes the count worth reading.
   */
  const undecided = useMemo(() => {
    let statement = 0;
    let actual = 0;
    for (const item of items) {
      if (item.disposition !== "unresolved") continue;
      if (item.statementRowIds.length > 0) statement += 1;
      else if (item.actualTransactionIds.length > 0) actual += 1;
    }
    return { statement, actual };
  }, [items]);


  const coverage = useMemo(
    () =>
      summarizeCoverage(items, {
        statementRows: parsedRows.length,
        loadedTransactions: snapshot.length,
      }),
    [items, parsedRows.length, snapshot.length]
  );

  /**
   * Nothing matched because the statement's signs are the other way round.
   *
   * Derived here rather than in the workbench because it needs the rows and the
   * snapshot as lists, and because the recovery it offers is a re-match - which
   * only this component can run. Returns null on every ordinary session; the
   * notice it feeds does not exist unless matching failed completely and the
   * flip test explains why.
   */
  const invertedSigns = useMemo(
    () =>
      diagnoseInvertedSigns({
        statementRows: parsedRows,
        transactions: snapshot,
        matched: coverage.statement.matched,
      }),
    [parsedRows, snapshot, coverage.statement.matched]
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
    }).catch(() => undefined);
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
    async function startSession(chosenId?: string, tag?: string | null, enterCardFigures = false) {
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
      // The import screen stays underneath; skipping or saving the figures returns to it.
      const card = enterCardFigures ? registeredCards.find((entry) => entry.accountId === account.id) : undefined;
      if (card) setCardFigures({ sessionId: session.id, card, cardName: account.name, statementId: null });
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
      (appliedSession.status === "completed" || appliedSession.status === "partial" ||
        appliedSession.appliedAt || (Array.isArray(appliedSession.applyResults) && appliedSession.applyResults.length > 0))
        ? "This reconciliation has already been applied. Matching again would lose the record of what was written - start a new reconciliation to check the account as it stands now."
        : null;
    const writeSettingsLocked = Boolean(
      isApplying ||
        isCheckingDrift ||
        appliedSession?.status === "applying" ||
        appliedSession?.appliedAt
    );

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
    /**
     * The only way into Review.
     *
     * Both the phase trail and the primary button come through here, because a
     * gate with a path around it is worse than no gate - the review screen no
     * longer carries the warning this replaces. Returning to Review from a
     * withheld Apply is deliberately *not* routed here: that is the drift
     * report showing itself, not someone arriving fresh.
     */
    async function finishWithoutWrites(id: string) {
      if (applyRunning.current) return;
      applyRunning.current = true;
      setIsCheckingDrift(true);
      try {
        await mutations.flushSaves();
        ensureConnection();
        const session = sessionQuery.data?.session;
        if (!session) return;
        const plan = buildApplyPlan({ sessionId: id, budgetSyncId: session.budgetSyncId, accountId: session.accountId,
          items: itemsRef.current, statementRows: statementRowsById, transactions: transactionsById,
          applyConfig, statementFormat: sessionQuery.data?.session.statementFormat ?? null, appliedOperationIds });
        if (plan.operations.length || plan.blocked.length || itemsRef.current.some((item) => item.disposition === "unresolved")) return;
        const { session: completed } = await sessionCommand(id, { action: "complete", expected: decisionSignature(itemsRef.current, applyConfig) });
        ensureConnection();
        const history = (Array.isArray(completed.applyResults)
          ? completed.applyResults as OperationResult[] : [])
          .filter((entry) => entry.status === "applied" || entry.status === "skipped");
        await sessionQuery.refetch();
        setApplyResult({ results: history, ...summarizeResults(history) });
        setScreen({ name: "result", sessionId: id });
      } catch (error) { setMatchError(error instanceof Error ? error.message : "Could not finish the session"); }
      finally { applyRunning.current = false; setIsCheckingDrift(false); }
    }

    function enterReview(id: string) {
      if (snapshotIsStored || isApplying || isCheckingDrift) return;
      if (items.length > 0 && applyPlan.operations.length === 0 && applyPlan.blocked.length === 0 &&
          !items.some((item) => item.disposition === "unresolved")) {
        void finishWithoutWrites(id); return;
      }
      if (gatePairs.length > 0 || undecided.statement + undecided.actual > 0) {
        setReviewGateFor(id);
        return;
      }
      setScreen({ name: "review", sessionId: id });
    }

    function goToStep(step: SessionStep, id: string) {
      setDriftReport(null);
      if (step === "import") {
        // Through the same confirmation as the toolbar's Import again: going
        // back to the statement discards the decisions made against the old
        // rows, whichever control the user reached it by.
        const current = sessionQuery.data?.session;
        if (current) reimport(current);
      } else if (step === "reconcile") {
        // This is a review-time choice, not a sticky workbench preference. Both
        // the progress header and the toolbar pass through here so Back cannot
        // behave differently depending on which control the user chose.
        if (screen.name === "review") {
          const nextConfig = applyConfigAfterLeavingReview(applyConfig, writeSettingsLocked);
          if (nextConfig !== applyConfig) handleApplyConfigChange(nextConfig);
        }
        updateItems(itemsRef.current.flatMap((item) => {
          const row = transactionsById.get(item.actualTransactionIds[0]);
          if (!row) return [];
          const guards: ReconciliationItem["guards"] = { protectedReconciled: row.reconciled,
            splitParent: row.isParent, transfer: !transfersReported ? "unknown" : row.transferId ? "yes" : "no" };
          return JSON.stringify(guards) === JSON.stringify(item.guards) ? [] : [{ id: item.id, change: (previous: ReconciliationItem) => ({ ...previous, guards }) }];
        }));
        setScreen({ name: "workbench", sessionId: id });
      } else if (step === "review") enterReview(id);
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
      /** Recorded on the session so surfaces without a parse config can branch. */
      statementFormat?: StatementFormat | null;
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
      /*
       * Brought up to date before anything is read, because everything after
       * this is built on what comes back: the candidate window, the matches,
       * every decision, and the ids the writes will target. A session started
       * from a stale copy of the budget is wrong from its first row.
       */
      setMatchStage("Bringing the budget up to date…");

      try {
        if (!await refreshBudget(connection)) throw new Error("Could not refresh Actual. Retry matching after the connection recovers.");
        ensureConnection();

        setMatchStage("Loading transactions from Actual…");
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

        ensureConnection();
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
        // A fresh graph: the rows a bulk action touched no longer exist.
        setLastBulk(null);
        // Matching is the moment the baseline is taken.
        setBaselines(new Map(window.transactions.map((t) => [t.id, t])));
        setTransfersReported(window.transfersReported);
        setSnapshotIsStored(false);
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
            ...(input.statementFormat !== undefined
              ? { statementFormat: input.statementFormat }
              : {}),
            ...(input.totals !== undefined ? { totals: input.totals } : {}),
          },
        });

        ensureConnection();
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
    function updateItems(changes: { id: string; change: (item: ReconciliationItem) => ReconciliationItem }[]) {
      if (snapshotIsStored || applyRunning.current || sessionQuery.data?.session.status === "applying" || sessionQuery.data?.session.status === "completed") return;
      const changed = new Map<string, ReconciliationItem>();
      const byId = new Map(itemsRef.current.map((item) => [item.id, item]));
      for (const { id, change } of changes) {
        const current = changed.get(id) ?? byId.get(id);
        if (current && !appliedItemIds.has(id)) changed.set(id, change(current));
      }
      if (!changed.size) return;
      setItems((previous) => previous.map((item) => changed.get(item.id) ?? item));
      void mutations.patchItems.mutateAsync({ sessionId: sessionId ?? "", items: [...changed.values()].map((item) => ({
        id: item.id, disposition: item.disposition, reasonCode: item.reasonCode ?? null,
        actualTransactionIds: item.actualTransactionIds, stagedChanges: item.stagedChanges ?? null,
        match: item.match ?? null, guards: item.guards, actualSnapshot: baselineFor(item),
      })) }).catch((error: unknown) => setMatchError(error instanceof Error ? error.message : "Could not save decisions"));
    }

    function updateItem(itemId: string, change: (item: ReconciliationItem) => ReconciliationItem) {
      // A later row edit must not be overwritten by an older bulk snapshot.
      setLastBulk(null);
      updateItems([{ id: itemId, change }]);
    }

    function restoreItems(next: ReconciliationItem[]) {
      if (snapshotIsStored || applyRunning.current || sessionQuery.data?.session.status === "applying" || sessionQuery.data?.session.status === "completed") return;
      setLastBulk(null);
      setItems(next);
      void mutations.replaceItems.mutateAsync({ sessionId: sessionId ?? "", items: next.map((item) => ({
        ...item, actualSnapshot: baselineFor(item), stagedChanges: item.stagedChanges ?? null,
      })) }).catch((error: unknown) => setMatchError(error instanceof Error ? error.message : "Could not save pairing"));
    }

    function snapshotFor(item: ReconciliationItem): ActualTransactionSnapshot | undefined {
      return transactionsById.get(item.actualTransactionIds[0] ?? "");
    }

    /** Record a decision. The rules that travel with one live in `applyDisposition`. */
    function handleDisposition(itemId: string, disposition: ReconciliationDisposition) {
      const item = itemsRef.current.find((entry) => entry.id === itemId);
      if (disposition === "matched" && item?.actualTransactionIds.length === 1) {
        resolveSingleCandidates([itemId], (entry) => applyDisposition({ item: entry, disposition,
          statementRow: statementRowsById.get(entry.statementRowIds[0] ?? ""), transaction: snapshotFor(entry) }));
        return;
      }
      updateItem(itemId, (item) =>
        applyDisposition({
          item,
          disposition,
          statementRow: statementRowsById.get(item.statementRowIds[0] ?? ""),
          transaction: transactionsById.get(item.actualTransactionIds[0] ?? ""),
        })
      );
    }

    /**
     * Pick one of several competing candidates, or none of them.
     *
     * Decided across the whole set rather than on one item, because a cluster
     * offers the same transactions to several rows: the chosen one is withdrawn
     * from every row still undecided about it, and a transaction nobody else
     * wants becomes a row of its own so it cannot be left in the budget and
     * absent from the screen.
     */
    function handleUseCandidate(itemId: string, transactionId: string | null) {
      if (snapshotIsStored || applyRunning.current || sessionStatus === "applying" || sessionStatus === "completed" || appliedItemIds.has(itemId)) return;
      const resolvedSet = resolveToTransaction({
        items: itemsRef.current,
        itemId,
        transactionId,
        transactions: transactionsById,
        transfersReported,
        makeId: () => generateId(),
      });
      if (resolvedSet === itemsRef.current) return;
      setLastBulk(null);

      const next = resolvedSet.map((entry) =>
        entry.id === itemId
          ? correctAmountFromStatement({
              item: entry,
              statementRow: statementRowsById.get(entry.statementRowIds[0] ?? ""),
              transaction: transactionsById.get(entry.actualTransactionIds[0] ?? ""),
            })
          : entry
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
            actualSnapshot: baselineFor(entry),
            stagedChanges: entry.stagedChanges ?? null,
          })),
        })
        .catch((error: unknown) => {
          setMatchError(error instanceof Error ? error.message : "Could not save that decision");
        });
    }

    /**
     * Persist a change to how decisions become writes.
     *
     * Shared by the import screen, the workbench and the review screen: one
     * setting, one place it is written, whichever control the user reached.
     */
    function handleApplyConfigChange(config: ApplyConfig) {
      if (writeSettingsLocked || applyRunning.current) return;
      setApplyConfig(config);
      if (sessionId) {
        const write = mutations.updateSession.mutateAsync({ id: sessionId, payload: { applyConfig: config } });
        void write.catch((error: unknown) => {
          setMatchError(
            error instanceof Error ? error.message : "Could not save the reconciliation settings"
          );
        });
      }
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
        pending: prospectiveTransaction({
          item: entry,
          statementRow,
          transaction,
          applyConfig,
          statementFormat: sessionQuery.data?.session.statementFormat ?? null,
        }),
        categoryName: (id: string | null) =>
          categoryOptions.find((option) => option.id === id)?.name ?? null,
        payeeName: (id: string | null) =>
          payeeOptions.find((option) => option.id === id)?.name ?? null,
      };
    }

    /** Stage what a transformation produced, one write per changed row. */
    function handleTransform(changes: { itemId: string; patch: StagedPatch | undefined }[]) {
      if (changes.length > 0) setLastBulk(null);
      updateItems(changes.map((change) => ({ id: change.itemId,
        change: (entry) => ({ ...entry, stagedChanges: change.patch }) })));
    }

    /**
     * Remember what a bulk action is about to overwrite.
     *
     * One level, last action only — deliberately. Undo is otherwise per row, so
     * reversing a fifty-row create meant fifty presses of `u`, which is not an
     * undo so much as a penalty. A full history would want the inverse-patch
     * machinery the Budget page has; this is the cheap ninety percent, and the
     * bulk bar is the one place that makes fifty changes in a single press.
     *
     * Captures the fields a bulk action can touch. A later row edit or
     * transformation clears this snapshot so undo cannot discard newer work.
     */
    function rememberBulk(itemIds: string[], label: string) {
      const selected = new Set(itemIds);
      const before = itemsRef.current.filter((entry) => selected.has(entry.id));
      if (before.length > 0) setLastBulk({ label, before });
    }

    function undoLastBulk() {
      if (!lastBulk) return;
      updateItems(lastBulk.before.map((entry) => ({ id: entry.id, change: () => entry })));
      setLastBulk(null);
    }

    function handleBulkDisposition(itemIds: string[], disposition: ReconciliationDisposition) {
      if (disposition === "matched") {
        resolveSingleCandidates(itemIds, (item) => applyDisposition({ item, disposition,
          statementRow: statementRowsById.get(item.statementRowIds[0] ?? ""), transaction: snapshotFor(item) }),
          `${itemIds.length} rows`);
        return;
      }
      rememberBulk(itemIds, `${itemIds.length} ${itemIds.length === 1 ? "row" : "rows"}`);
      updateItems(itemIds.map((id) => ({ id, change: (item) => applyDisposition({
        item, disposition, statementRow: statementRowsById.get(item.statementRowIds[0] ?? ""),
        transaction: transactionsById.get(item.actualTransactionIds[0] ?? ""),
      }) })));
    }

    function handleBulkCorrectAmount(
      entries: { itemId: string; transactionId: string; amount: number }[]
    ) {
      const byId = new Map(entries.map((entry) => [entry.itemId, entry]));
      resolveSingleCandidates(entries.map((entry) => entry.itemId), (item) => {
        const entry = byId.get(item.id)!;
        return withCorrectedAmount(item, entry.transactionId, entry.amount);
      }, `${entries.length} ${entries.length === 1 ? "amount" : "amounts"}`);
    }

    /** Single-candidate bulk decisions still withdraw the candidate from competing rows. */
    function resolveSingleCandidates(itemIds: string[], change: (item: ReconciliationItem) => ReconciliationItem, label?: string) {
      if (snapshotIsStored || applyRunning.current || sessionStatus === "applying" || sessionStatus === "completed") return;
      const before = itemsRef.current;
      const selected = new Set(itemIds);
      const eligible = new Set(before.filter((item) => selected.has(item.id) && !appliedItemIds.has(item.id) &&
        item.actualTransactionIds.length === 1 && change(item) !== item).map((item) => item.id));
      const resolved = resolveSingleCandidateTransactions({ items: before, itemIds: [...eligible],
        transactions: transactionsById, transfersReported });
      const next = resolved.map((item, index) => eligible.has(item.id) && item !== before[index] ? change(item) : item);
      const changes = next.flatMap((item, index) => item === before[index] ? [] : [{ id: item.id, change: () => item }]);
      if (!changes.length) return;
      if (label) rememberBulk(changes.map((entry) => entry.id), label);
      else setLastBulk(null);
      updateItems(changes);
    }

    /** Explicit corrections stage integer minor units with the same guards in both surfaces. */
    function withCorrectedAmount(item: ReconciliationItem, transactionId: string, amount: number): ReconciliationItem {
      const snapshot = transactionsById.get(transactionId);
      if (!snapshot || item.actualTransactionIds.length !== 1 || item.actualTransactionIds[0] !== transactionId ||
          !canStageField(item, "amount").allowed) return item;
      const { patch } = stageField({
        patch: item.stagedChanges,
        field: "amount",
        original: snapshot.amount,
        next: amount,
        source: "manual",
      });
      return { ...item, disposition: "correct-amount", stagedChanges: patch };
    }

    function handleCorrectAmount(itemId: string, transactionId: string, amount: number) {
      resolveSingleCandidates([itemId], (item) => withCorrectedAmount(item, transactionId, amount));
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
        if (field === "payeeId" && value === null && item.disposition === "create") {
          patch.payeeId = { original: null, staged: null, source: "manual" };
        }
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
      if (!connection || !session || !applyPlan.operations.length || snapshotIsStored || applyRunning.current) return;
      if (session.status === "applying") {
        setMatchError("Apply is running or was interrupted. Recover it only after its original tab has stopped.");
        return;
      }
      applyRunning.current = true;
      setMatchError(null);
      setVerification(null);
      setIsCheckingDrift(true);
      const base = createReconciliationTransport(getTransport(connection));
      // A connection switch can happen between sequential operations. Never
      // let an old handler reopen/write its budget through the current runtime.
      const transport = { ...base,
        createTransactions: (input: Parameters<typeof base.createTransactions>[0]) => { ensureConnection(); return base.createTransactions(input); },
        updateTransaction: (input: Parameters<typeof base.updateTransaction>[0]) => { ensureConnection(); return base.updateTransaction(input); },
        deleteTransaction: (input: Parameters<typeof base.deleteTransaction>[0]) => { ensureConnection(); return base.deleteTransaction(input); },
        ...(base.batchWrite ? { batchWrite: (input: Parameters<NonNullable<typeof base.batchWrite>>[0]) => {
          ensureConnection(); return base.batchWrite!(input);
        } } : {}),
      };
      let claimed = false;
      let wrote = false;
      const activeOperations = new Set(applyPlan.operations.map((op) => op.id));
      const previousResults = (Array.isArray(session.applyResults) ? session.applyResults as OperationResult[] : [])
        .filter((entry) => entry.status === "applied" || entry.status === "skipped" || activeOperations.has(entry.operationId));
      const collected: OperationResult[] = [];
      try {
        await mutations.flushSaves();
        ensureConnection();
        if (session.budgetSyncId !== connection.budgetSyncId) throw new Error("This session belongs to a different budget.");
        if (!await refreshBudget(connection)) throw new Error("Could not refresh Actual before checking changes. Nothing was written.");
        ensureConnection();
        const dates = [...snapshot.map((row) => row.date), ...applyPlan.operations.map((op) => op.date),
          session.statementStart ?? "", session.statementEnd ?? ""].filter(Boolean).sort();
        const window = await transport.loadTransactions({ accountId: session.accountId,
          startDate: dates[0] ?? "", endDate: dates.at(-1) ?? "" });
        ensureConnection();
        const latest = await loadLatestForDrift({ transport, accountId: session.accountId,
          transactionIds: driftTargets(applyPlan), startDate: dates[0] ?? "", endDate: dates.at(-1) ?? "", window });
        const checked = reconcilePlanWithDrift({ plan: applyPlan, snapshots: historicalTransactions, latest, transfersReported: window.transfersReported });
        setSnapshot([...new Map([...window.transactions.map((row) => [row.id, row] as const),
          ...[...latest.values()].filter((row): row is ActualTransactionSnapshot => Boolean(row)).map((row) => [row.id, row] as const)]).values()]);
        setTransfersReported(window.transfersReported);
        setCheckedPlan(checked.plan);
        setDriftReport(checked.report);
        const conflictKey = JSON.stringify(checked.report.withheld);
        if (checked.report.withheld.length > 0 && acknowledgedDrift.current !== conflictKey) {
          acknowledgedDrift.current = conflictKey;
          setScreen({ name: "review", sessionId: session.id });
          return;
        }
        const plan = checked.plan;
        const withheld = new Set(checked.report.withheld.map((entry) => entry.operationId));
        const retained = new Set(plan.operations.map((op) => op.id));
        const converged: OperationResult[] = applyPlan.operations.filter((op) => !retained.has(op.id) && !withheld.has(op.id))
          .map((op) => ({ operationId: op.id, status: "skipped", transactionId: op.kind === "create" ? null : op.transactionId,
            skippedBecause: "Already matches the approved change in Actual." }));
        if (!plan.operations.length && !converged.length) return;
        const retryMarkers = plan.operations.filter((op) => op.kind === "create" &&
          previousResults.some((entry) => entry.operationId === op.id)).map((op) => op.kind === "create" ? op.marker : "");
        const recoveredCreates = retryMarkers.length && transport.findCreatedTransactions
          ? await transport.findCreatedTransactions({ accountId: session.accountId, markers: retryMarkers }) : [];
        ensureConnection();
        const markerRows = [...new Map([...window.transactions, ...recoveredCreates].map((row) => [row.id, row])).values()];
        const existingCreates = plan.operations.filter((op) => op.kind === "create" &&
          markerRows.some((row) => row.importedId === op.marker));
        const markerCheck = verifyApply({ plan: { ...plan, operations: existingCreates },
          results: existingCreates.map((op) => ({ operationId: op.id, status: "applied" })),
          latest: markerRows, snapshots: historicalTransactions });
        if (!markerCheck.ok) throw new Error("A previously created transaction differs from this plan or appears more than once. Review it in Actual before retrying.");

        // Newly appearing rows must be available for manual linking rather
        // than duplicating them from a saved Create decision.
        const known = new Set(itemsRef.current.flatMap((item) => item.actualTransactionIds));
        const markers = new Set(plan.operations.flatMap((op) => op.kind === "create" ? [op.marker] : []));
        const newRows = window.transactions.filter((row) => !known.has(row.id) && !markers.has(row.importedId ?? ""));
        const createRows = plan.operations.flatMap((op) => op.kind === "create"
          ? [statementRowsById.get(op.statementRowId)!].filter(Boolean) : []);
        if (newRows.length && createRows.length) {
          const graph = match({ statementRows: createRows, actualTransactions: newRows, config: matchConfig });
          if (graph.matched.length || graph.ambiguous.length) {
            const discovered = buildReconciliationItems({ statementRows: createRows, actualTransactions: newRows,
              graph, transfersReported: window.transfersReported, makeId: () => generateId(),
              statementPeriod: session.statementStart && session.statementEnd ? { start: session.statementStart, end: session.statementEnd } : null });
            const candidates = new Map(discovered.filter((item) => item.statementRowIds.length && item.actualTransactionIds.length)
              .map((item) => [item.statementRowIds[0], item]));
            const next = itemsRef.current.map((item): ReconciliationItem => {
              const candidate = item.disposition === "create" ? candidates.get(item.statementRowIds[0]) : undefined;
              return candidate ? { ...item, actualTransactionIds: candidate.actualTransactionIds, guards: candidate.guards,
                match: candidate.match, reasonCode: candidate.reasonCode, disposition: "unresolved" } : item;
            }).concat(discovered.filter((item) => !item.statementRowIds.length));
            setSnapshot(window.transactions); setTransfersReported(window.transfersReported);
            setLastBulk(null);
            setItems(next);
            setCheckedPlan(null);
            setMatchError("New Actual transactions may match rows marked Create. Review the new rows before applying.");
            setScreen({ name: "workbench", sessionId: session.id });
            const discoveredById = new Map(newRows.map((row) => [row.id, row]));
            await mutations.replaceItems.mutateAsync({ sessionId: session.id, items: next.map((item) => ({
              ...item, stagedChanges: item.stagedChanges ?? null,
              actualSnapshot: baselineFor(item) ?? discoveredById.get(item.actualTransactionIds[0]) ?? null,
            })) });
            return;
          }
        }

        const itemPatches = plan.operations.flatMap((op) => {
          if (op.kind === "create") return [];
          const item = itemsRef.current.find((entry) => entry.id === op.itemId);
          const current = latest.get(op.transactionId);
          return item && current ? [{ id: item.id, disposition: item.disposition,
            stagedChanges: op.kind === "update" ? op.patch : item.stagedChanges ?? null,
            actualSnapshot: current, guards: { protectedReconciled: current.reconciled,
              splitParent: current.isParent, transfer: !window.transfersReported ? "unknown" : current.transferId ? "yes" : "no" } }] : [];
        });
        ensureConnection();
        await sessionCommand(session.id, { action: "claim", expected: decisionSignature(itemsRef.current, applyConfig), itemPatches });
        claimed = true;
        setItems((previous) => previous.map((item) => {
          const patch = itemPatches.find((entry) => entry.id === item.id);
          return patch ? { ...item, stagedChanges: patch.stagedChanges as StagedPatch | undefined, guards: patch.guards as ReconciliationItem["guards"] } : item;
        }));
        setBaselines((previous) => new Map([...previous, ...itemPatches.map((entry) => [entry.actualSnapshot.id, entry.actualSnapshot] as const)]));
        setIsCheckingDrift(false); setIsApplying(true);
        setApplyProgress({ done: 0, total: plan.operations.length });
        let lastFlush = 0;
        let lastProgress = 0;
        const result = await executeApplyPlan({ plan, transport, previousResults,
          existingMarkers: new Set(markerRows.flatMap((row) => row.importedId ? [row.importedId] : [])),
          onResult: async (entry) => {
            wrote ||= entry.status === "applied" || entry.status === "skipped";
            collected.push(entry);
            if (Date.now() - lastFlush >= PROGRESS_FLUSH_MS) {
              lastFlush = Date.now();
              await updateSessionQuietly(session.id, { applyResults: mergeOperationResults(previousResults, collected) });
            }
          },
          onProgress: (progress) => {
            if (progress.completed < progress.total && Date.now() - lastProgress < PROGRESS_UI_MS) return;
            lastProgress = Date.now();
            setApplyProgress({ done: progress.completed, total: progress.total });
          },
        });
        const history = mergeOperationResults(previousResults, [...converged, ...result.results]);
        const totals = summarizeResults(history);
        setApplyResult({ results: history, ...totals });
        const remaining = itemsRef.current.some((item) => item.disposition === "unresolved");
        await sessionCommand(session.id, { action: "finish", patch: { applyResults: history,
          status: !totals.complete ? "partial" : remaining || applyPlan.blocked.length > 0 || checked.report.withheld.length > 0 ? "needs_review" : "completed",
          appliedAt: new Date().toISOString() } });
        claimed = false;
        await sessionQuery.refetch();
        ensureConnection();
        await getTransport(connection).sync();
        ensureConnection();
        setIsVerifying(true);
        try {
          const writtenDates = plan.operations.flatMap((op) => op.kind === "update"
            ? [op.date, op.patch.date?.staged ?? op.date] : [op.date]).sort();
          const fresh = await transport.loadTransactions({ accountId: session.accountId,
            startDate: writtenDates[0] ?? "", endDate: writtenDates.at(-1) ?? "" });
          // A moved surviving delete/update must not be mistaken for absence.
          for (const op of plan.operations) if (op.kind !== "create" && !fresh.transactions.some((row) => row.id === op.transactionId)) {
            const row = await transport.readTransaction({ accountId: session.accountId, transactionId: op.transactionId });
            if (row) fresh.transactions.push(row);
          }
          setVerification(verifyApply({ plan, results: result.results, latest: fresh.transactions, snapshots: historicalTransactions }));
        } catch { setMatchError("Changes were applied, but the read-back check could not finish. Check Actual before retrying."); }
        finally { setIsVerifying(false); }
        acknowledgedDrift.current = null;
        setScreen({ name: "result", sessionId: session.id });
      } catch (error) {
        // Keep an interrupted claim when results might be uncertain. Recovery
        // explicitly reads Actual; an exception is never permission to retry blindly.
        if (claimed) {
          try { await updateSessionQuietly(session.id, { applyResults: mergeOperationResults(previousResults, collected) }); }
          catch { /* The stored applying state still prevents another writer. */ }
          await sessionQuery.refetch();
        }
        setMatchError(error instanceof Error ? error.message : wrote ? "Apply was interrupted. Check Actual before recovering." : "Could not apply changes");
      } finally {
        applyRunning.current = false; setIsApplying(false); setIsCheckingDrift(false); setApplyProgress(null);
      }
    }

    async function handleRecover() {
      const session = sessionQuery.data?.session;
      if (!session || session.status !== "applying" || applyRunning.current || snapshotIsStored || loadedSessionId !== session.id) return;
      applyRunning.current = true;
      setIsCheckingDrift(true); setMatchError(null);
      try {
        await mutations.flushSaves();
        ensureConnection();
        if (!await refreshBudget(connection!)) throw new Error("Could not refresh Actual. The session remains locked.");
        ensureConnection();
        const transport = createReconciliationTransport(getTransport(connection!));
        const dates = [session.candidateStart, session.candidateEnd, session.statementStart, session.statementEnd,
          ...fullPlan.operations.flatMap((op) => op.kind === "update" ? [op.date, op.patch.date?.staged] : [op.date])]
          .filter((date): date is string => Boolean(date)).sort();
        const window = await transport.loadTransactions({ accountId: session.accountId,
          startDate: dates[0] ?? "", endDate: dates.at(-1) ?? "" });
        const latest = await loadLatestForDrift({ transport, accountId: session.accountId,
          transactionIds: driftTargets(fullPlan), startDate: dates[0] ?? "", endDate: dates.at(-1) ?? "", window });
        ensureConnection();
        const rows = new Map(window.transactions.map((row) => [row.id, row]));
        for (const row of latest.values()) if (row) rows.set(row.id, row);
        const markers = fullPlan.operations.flatMap((op) => op.kind === "create" ? [op.marker] : []);
        if (transport.findCreatedTransactions) for (const row of await transport.findCreatedTransactions({ accountId: session.accountId, markers })) rows.set(row.id, row);
        ensureConnection();
        const previous = Array.isArray(session.applyResults) ? session.applyResults as OperationResult[] : [];
        const confirmed = new Set(previous.filter((entry) => entry.status === "applied" || entry.status === "skipped").map((entry) => entry.operationId));
        const results = mergeOperationResults(previous, recoverApply({
          plan: { ...fullPlan, operations: fullPlan.operations.filter((op) => !confirmed.has(op.id)) },
          latest: [...rows.values()], snapshots: historicalTransactions }));
        const totals = summarizeResults(results);
        await sessionCommand(session.id, { action: "recover", patch: { applyResults: results,
          status: !totals.complete ? "partial" : fullPlan.blocked.length > 0 || itemsRef.current.some((item) => item.disposition === "unresolved") ? "needs_review" : "completed",
          appliedAt: session.appliedAt ?? new Date().toISOString() } });
        ensureConnection();
        setApplyResult({ results, ...totals }); setLoadedSessionId(null);
        await sessionQuery.refetch();
        setScreen({ name: "result", sessionId: session.id });
      } catch (error) { setMatchError(error instanceof Error ? error.message : "Could not recover Apply. The session remains locked."); }
      finally { applyRunning.current = false; setIsCheckingDrift(false); }
    }

    const recoveryNotice = sessionStatus === "applying" && !isApplying && !isCheckingDrift ? (
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 text-sm">
        <p>Apply is running in another tab or was interrupted.</p>
        <Button size="sm" variant="outline" disabled={snapshotIsStored || loadedSessionId !== sessionId} onClick={() => setConfirm({
          title: "Recover interrupted Apply?", destructive: false, destructiveLabel: "Read Actual and recover",
          message: "Continue only after the original tab has stopped applying. Recovery reads Actual to confirm completed changes and leaves the rest for review.",
          onConfirm: () => void handleRecover(),
        })}>Recover interrupted Apply</Button>
      </div>
    ) : null;

    const errorNotice = matchError ? (
      <div className="flex items-center gap-2 px-4 pt-3 text-xs">
        <p role="alert" className="text-destructive">{matchError}</p>
        {(snapshotIsStored || mutations.hasFailedSaves) && <Button size="sm" variant="outline" onClick={() => {
          void mutations.retrySaves(sessionId).then(() => {
            setMatchError(null);
            if (snapshotIsStored) setResumeAttempt((value) => value + 1);
          }).catch((error: unknown) => setMatchError(error instanceof Error ? error.message : "Could not retry saving"));
        }}>{snapshotIsStored ? "Retry reading Actual" : "Retry saving"}</Button>}
      </div>
    ) : null;

    async function handleParsed(
      result: NormalizedStatement,
      fileName: string | null,
      format: StatementFormat | null
    ) {
      if (screen.name !== "import" || !result.period) return;
      await runMatch({
        sessionId: screen.sessionId,
        accountId: screen.accountId,
        statementRows: result.rows,
        statementPeriod: result.period,
        totals: result.totals,
        statementName: fileName,
        statementFormat: format,
        config: matchConfig,
      });
    }

    if (screen.name === "import") {
      // A session that has already matched can be re-imported, so leaving here
      // should return to the work rather than abandoning it.
      const hasParsedStatement = Boolean(sessionQuery.data?.session.statementStart);

      return (
        <PageLayout
          header={
            <SessionHeader
              onCardFigures={() => openCardFigures(sessionQuery.data?.session)}
              session={sessionQuery.data?.session}
              current="import"
              // Navigable only once the session has a statement to go back to.
              // On a first import there is no workbench yet, so the steps would
              // lead nowhere.
              onNavigate={
                hasParsedStatement ? (step) => goToStep(step, screen.sessionId) : undefined
              }
              onExit={isApplying || isCheckingDrift ? undefined : () => setScreen({ name: "home" })}
              actions={
                <PhaseNav
                  back={
                    // Only when there is a workbench to go back to. On a first
                    // import there is no previous phase; leaving is what the
                    // exit in the header is for.
                    hasParsedStatement
                      ? {
                          label: "Back to the workbench",
                          onClick: () =>
                            setScreen({ name: "workbench", sessionId: screen.sessionId }),
                          disabled: isMatching,
                        }
                      : undefined
                  }
                  next={{
                    label: isMatching ? "Matching…" : "Match against Actual",
                    progress: matchStage,
                    onClick: () => {
                      if (pendingStatement) {
                        void handleParsed(
                          pendingStatement.result,
                          pendingStatement.fileName,
                          pendingStatement.format
                        );
                      }
                    },
                    disabled: !pendingStatement,
                    busy: isMatching,
                  }}
                />
              }
            />
          }
          scrollManaged
        >
          {recoveryNotice}
          {errorNotice}
          <ImportPanel
            accountName={screen.accountName}
            applyConfig={applyConfig}
            onApplyConfigChange={handleApplyConfigChange}
            writeSettingsLocked={writeSettingsLocked}
            previousStatement={
              sessionQuery.data?.session.statementName
                ? {
                    name: sessionQuery.data.session.statementName,
                    start: sessionQuery.data.session.statementStart,
                    end: sessionQuery.data.session.statementEnd,
                  }
                : null
            }
            matchConfig={matchConfig}
            matchPreset={matchPreset}
            profiles={profilesQuery.data ?? []}
            pdfStatementLayouts={pdfStatementLayoutsQuery.data}
            isLoadingPdfStatementLayouts={pdfStatementLayoutsQuery.isPending}
            isSavingProfile={mutations.saveProfile.isPending}
            isSavingPdfStatementLayout={mutations.savePdfStatementLayout.isPending}
            onApplyProfile={(profile: ReconciliationProfileRecord) => {
              const saved = profile.matchConfig as MatchConfig | null;
              if (saved) setMatchConfig({ ...DEFAULT_MATCH_CONFIG, ...saved });
            }}
            onSaveProfile={(name: string, parseConfig: unknown) => {
              void mutations.saveProfile.mutateAsync({
                accountId: screen.accountId,
                name,
                mapping: parseConfig,
                matchConfig,
              });
            }}
            onSavePdfStatementLayout={(input) => mutations.savePdfStatementLayout.mutateAsync({
              accountId: screen.accountId,
              ...input,
            })}
            onAssignPdfStatementLayout={(layoutId) => mutations.assignPdfStatementLayout.mutateAsync({
              accountId: screen.accountId,
              layoutId,
            })}
            onRemovePdfStatementLayoutAssignment={() =>
              mutations.removePdfStatementLayoutAssignment.mutateAsync({ accountId: screen.accountId })
            }
            onRenamePdfStatementLayoutBank={(from, to) =>
              mutations.renamePdfStatementLayoutBank.mutateAsync({ from, to })
            }
            onRenamePdfStatementLayout={(layoutId, name) =>
              mutations.renamePdfStatementLayout.mutateAsync({ layoutId, name })
            }
            onDeletePdfStatementLayout={(layoutId) =>
              mutations.deletePdfStatementLayout.mutateAsync(layoutId)
            }
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
                // Carried so the warning can say what became of that session
                // rather than assuming it was applied (F-126).
                status: entry.status,
                appliedAt: entry.appliedAt,
              }))}
            onReadyChange={handleStatementReady}
          />
        </PageLayout>
      );
    }

    if (screen.name === "review" || screen.name === "result") {
      const session = sessionQuery.data?.session;

      /*
       * Named apart, because they are not the same claim. Recording the bank's
       * merchant text on a matched row changes nothing of the user's, and
       * rolling both into "Apply 88 changes" is how a screen that exists to
       * count changes honestly stops being believed.
       *
       * A drift check names the exact operations it withholds, so the second
       * Apply can classify the remaining plan rather than falling back to
       * calling every remaining write a change.
       */
      const withheldIds = new Set(
        driftReport?.withheld.map((verdict) => verdict.operationId) ?? []
      );
      const reviewPlan = checkedPlan ?? applyPlan;
      const applicablePlan = withoutOperations(reviewPlan, withheldIds);
      const applicableChanges = applicablePlan.operations.length;
      const applyButtonLabel =
        applicableChanges === 0
          ? "Nothing to apply"
          : writeActionLabel("Apply", applicablePlan, { other: withheldIds.size > 0 });

      return (
        <PageLayout
          header={
            <SessionHeader
              onCardFigures={() => openCardFigures(sessionQuery.data?.session)}
              session={session}
              current={screen.name === "review" ? "review" : "applied"}
              period={period}
              statementName={statementName}
              onNavigate={isApplying || isCheckingDrift ? undefined : (step) => goToStep(step, screen.sessionId)}
              blockedSteps={rematchBlockedReason ? { import: rematchBlockedReason } : undefined}
              onExit={isApplying || isCheckingDrift ? undefined : () => setScreen({ name: "home" })}
              actions={
                <PhaseNav
                  back={{
                    label: "Back to the workbench",
                    disabled: isApplying || isCheckingDrift,
                    onClick: () => {
                      goToStep("reconcile", screen.sessionId);
                    },
                  }}
                  /*
                   * Finishing is a step, and it had no button. On the result
                   * screen the primary slot stood empty exactly when the user
                   * was most likely to be done, so leaving meant retreating
                   * through the workbench — a screen an applied session can no
                   * longer use.
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
                            // Still something to put right, so retrying stays
                            // the primary and finishing sits beside it.
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
            />
          }
          scrollManaged
        >
          {recoveryNotice}
          {errorNotice}
          {/* Once applied, offer the linked card statement's review (never an automatic jump). */}
          {screen.name === "result" && (applyResult || session?.appliedAt) && (
            <ReviewCardStatementLink statementId={session?.cardStatementId} />
          )}
          {screen.name === "review" ? (
            <ReviewPanel
              plan={reviewPlan}
              items={items}
              statementRows={statementRowsById}
              transactions={transactionsById}
              payees={payeeOptions}
              categories={categoryOptions}
              drift={driftReport}
              applyConfig={applyConfig}
              statementFormat={sessionQuery.data?.session.statementFormat ?? null}
              onApplyConfigChange={handleApplyConfigChange}
              writeSettingsLocked={writeSettingsLocked}
            />
          ) : (
            applyResult && (
              <ApplyResultPanel
                plan={fullPlan}
                items={items}
                statementRows={statementRowsById}
                transactions={historicalTransactions}
                payees={payeeOptions}
                applyConfig={applyConfig}
                statementFormat={sessionQuery.data?.session.statementFormat ?? null}
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

      const reviewButtonLabel = writeActionLabel("Review", applyPlan);

      return (
        <PageLayout
          header={
            <SessionHeader
              onCardFigures={() => openCardFigures(sessionQuery.data?.session)}
              session={session}
              current="reconcile"
              period={period}
              statementName={statementName}
              onNavigate={isApplying || isCheckingDrift ? undefined : (step) => goToStep(step, screen.sessionId)}
              blockedSteps={rematchBlockedReason ? { import: rematchBlockedReason } : undefined}
              onExit={isApplying || isCheckingDrift ? undefined : () => setScreen({ name: "home" })}
              actions={
                <PhaseNav
                  secondary={
                    session
                      ? {
                          label: "Import again",
                          onClick: () => reimport(session),
                          // Refused on an applied session for the same reason
                          // re-running the match is: importing again rebuilds
                          // the rows, which orphans the record of what was
                          // written and would offer the same transactions for a
                          // second write.
                          disabled: isMatching || Boolean(rematchBlockedReason),
                          title: rematchBlockedReason ?? undefined,
                        }
                      : undefined
                  }
                  next={{
                    label:
                      applyPlan.operations.length === 0 && items.length > 0 && coverage.decisions.pending === 0 && applyPlan.blocked.length === 0
                        ? "Finish"
                        : reviewButtonLabel,
                    /*
                     * Said, not enforced. Leaving rows for later is a documented
                     * capability, and it has to stay one: a session is meant to
                     * be resumable across sittings, and a partly-applied one has
                     * to be able to reach Review to retry what failed. Blocking
                     * would break both to prevent something that is already
                     * safe — an undecided row is untouched by Apply.
                     *
                     * What was missing was the consequence being legible on the
                     * way past. Review states it again beneath the table.
                     */
                    note:
                      coverage.decisions.pending > 0
                        ? `${coverage.decisions.pending} still undecided`
                        : null,
                    onClick: () => enterReview(screen.sessionId),
                    disabled: snapshotIsStored || isMatching || session?.status === "applying" || session?.status === "completed",
                  }}
                />
              }
            />
          }
          scrollManaged
        >
          {recoveryNotice}
          {errorNotice}
          <Workbench
            items={items}
            statementRows={statementRowsById}
            transactions={transactionsById}
            coverage={coverage}
            possiblePairs={possiblePairs}
            matchConfig={matchConfig}
            matchPreset={matchPreset}
            isMatching={isMatching}
            canRematch={canRematch}
            rematchBlockedReason={rematchBlockedReason}
            readOnly={snapshotIsStored || isMatching || isApplying || isCheckingDrift || session?.status === "applying" || session?.status === "completed"}
            appliedItemIds={appliedItemIds}
            onRestoreItems={restoreItems}
            writeSettingsLocked={writeSettingsLocked}
            snapshotIsStored={snapshotIsStored}
            payees={payeeOptions}
            categories={categoryOptions}
            onDisposition={handleDisposition}
            onUseCandidate={handleUseCandidate}
            onCorrectAmount={handleCorrectAmount}
            onStage={handleStage}
            onUnstage={handleUnstage}
            onBulkDisposition={handleBulkDisposition}
            onBulkCorrectAmount={handleBulkCorrectAmount}
            onManualMatch={handleManualMatch}
            lastBulkLabel={lastBulk?.label ?? null}
            onUndoBulk={lastBulk ? undoLastBulk : undefined}
            transformContextFor={transformContextFor}
            applyConfig={applyConfig}
            onApplyConfigChange={handleApplyConfigChange}
            statementFormat={sessionQuery.data?.session.statementFormat ?? null}
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
              const run = () => void runMatch({
                sessionId: session.id,
                accountId: session.accountId,
                statementRows: parsedRows,
                statementPeriod: period,
                config: matchConfig,
              });
              const changed = items.filter((item) => item.stagedChanges && Object.keys(item.stagedChanges).length > 0 ||
                item.match?.evidenceSource === "manual" || ["create", "delete", "correct-amount", "ignored"].includes(item.disposition)).length;
              if (changed) setConfirm({ title: "Re-run matching?", message: `${changed} decided or edited rows will be rebuilt. Nothing in Actual changes until Apply.`,
                destructiveLabel: "Discard and re-run", onConfirm: run });
              else run();
            }}
            invertedSigns={invertedSigns}
            onRerunInverted={() => {
              if (!session || !period) return;
              /*
               * The negated rows are persisted by `runMatch`, so this corrects
               * the session rather than just its display - the alternative was
               * re-importing the file and hunting for the sign setting.
               *
               * Matching runs from scratch, so it discards every decision on the
               * session, and it is reachable at a point where there can be
               * plenty: nothing matched, so the fastest way through was to work
               * the "Not in Actual" rows - and those are exactly the decisions
               * this throws away. Confirmed on the same terms as re-importing,
               * which discards the same work for the same reason.
               */
              const go = () =>
                void runMatch({
                  sessionId: session.id,
                  accountId: session.accountId,
                  statementRows: invertStatementRows(parsedRows),
                  statementPeriod: period,
                  config: matchConfig,
                });

              const decided = items.filter((item) => item.disposition !== "unresolved").length;
              const staged = items.filter(
                (item) => item.stagedChanges && Object.keys(item.stagedChanges).length > 0
              ).length;

              if (decided === 0 && staged === 0) {
                go();
                return;
              }

              setConfirm({
                title: "Re-run with the amounts inverted?",
                message: (
                  <>
                    Matching will run again from scratch, so the {decided} decision
                    {decided === 1 ? "" : "s"}
                    {staged > 0 ? ` and ${staged} edited row${staged === 1 ? "" : "s"}` : ""} on this
                    reconciliation will be discarded. Nothing in your budget changes, and anything
                    already applied stays applied.
                  </>
                ),
                destructiveLabel: "Discard and re-run",
                onConfirm: go,
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
        {errorNotice}

        <NewSessionDialog
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
          accounts={visibleAccounts}
          accountGroups={accountGroups}
          knownTags={[
            ...new Set(
              (sessionsQuery.data ?? [])
                .map((session) => session.tag)
                .filter((tag): tag is string => Boolean(tag))
            ),
          ].sort()}
          isCreating={mutations.createSession.isPending}
          cardStatus={(id) => {
            const account = visibleAccounts.find((entry) => entry.id === id);
            if (!account || resolveAccountClass(account.id, account.groupId, accountClasses.maps).accountClass !== "credit-card") return null;
            return registeredCards.some((entry) => entry.accountId === id) ? "registered" : "unregistered";
          }}
          onStart={(id, tag, enterCardFigures) => {
            setAccountId(id);
            void startSession(id, tag, enterCardFigures);
          }}
        />

        <SessionList
            sessions={sessionsQuery.data ?? []}
            onOpen={(session) => {
              void (async () => {
                await mutations.flushSaves();
                const current = await mutations.loadSession(session.id);
                ensureConnection();
                setParsedRows([]); setItems([]); setSnapshot([]); setPeriod(null);
                setStatementName(null); setApplyResult(null); setLoadedSessionId(null);
                setSnapshotIsStored(true); setMatchError(null);
                setScreen(screenForSession(current.session));
              })().catch((error: unknown) => setMatchError(error instanceof Error ? error.message : "Could not open reconciliation"));
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
      {cardFigures && connection && <CardStatementFigures
        connection={connection}
        card={cardFigures.card}
        cardName={cardFigures.cardName}
        statementId={cardFigures.statementId}
        onClose={() => setCardFigures(null)}
        onLinked={(statementId) => {
          const { sessionId: linkedSession } = cardFigures;
          setCardFigures(null);
          void mutations.updateSession.mutateAsync({ id: linkedSession, payload: { cardStatementId: statementId } })
            .catch((error: unknown) => setMatchError(error instanceof Error
              ? `The figures were saved, but the reconciliation could not remember the statement: ${error.message}`
              : "The figures were saved, but the reconciliation could not remember the statement"));
        }}
      />}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        state={confirm}
      />

      {/* The last look at a possible pair before its decisions are reviewed. */}
      <ReviewGateDialog
        open={reviewGateFor !== null}
        pairs={gatePairs}
        undecided={undecided}
        items={itemsById}
        statementRows={statementRowsById}
        transactions={transactionsById}
        onLink={(statementItemId, actualItemId) => {
          handleManualMatch(statementItemId, actualItemId);
        }}
        onDismiss={(pair) =>
          setDismissedPairs((previous) => new Set(previous).add(pairKey(pair)))
        }
        onBackToRows={() => setReviewGateFor(null)}
        onContinue={() => {
          const id = reviewGateFor;
          setReviewGateFor(null);
          if (id) setScreen({ name: "review", sessionId: id });
        }}
      />
    </>
  );
}

/** The snapshot stored alongside an item, for drift detection before Apply. */
/** Stable identity for a pair, so a dismissal survives the list being recomputed. */
function pairKey(pair: PossiblePair): string {
  return `${pair.statementItemId}|${pair.actualItemId}`;
}

function transactionsSnapshotFor(
  item: ReconciliationItem,
  transactions: ActualTransactionSnapshot[]
): ActualTransactionSnapshot | undefined {
  const id = item.actualTransactionIds[0];
  if (!id) return undefined;
  return transactions.find((transaction) => transaction.id === id);
}
