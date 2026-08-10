"use client";

import { useMemo, useState } from "react";
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
  summarizeCoverage,
} from "@/lib/reconciliation/session/build";
import type { NormalizedStatement } from "@/lib/reconciliation/statement/normalize";
import type {
  ActualTransactionSnapshot,
  MatchConfig,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useAccounts } from "@/features/accounts/hooks/useAccounts";
import { useCandidateWindow } from "../hooks/useCandidateWindow";
import {
  useReconciliationMutations,
  useReconciliationSession,
  useReconciliationSessions,
} from "../hooks/useReconciliation";
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

type Screen =
  | { name: "home" }
  | { name: "import"; sessionId: string; accountId: string; accountName: string }
  | { name: "workbench"; sessionId: string };

export function ReconciliationView() {
  const connection = useConnectionStore(selectActiveInstance);
  useAccounts();
  const accounts = useStagedStore((state) => state.accounts);

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

  // Matching options live with the session (and, once saved, the import
  // profile) because they describe how this account's transactions are created.
  const [matchConfig, setMatchConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const [matchPreset, setMatchPreset] = useState<TextTargetPreset>(DEFAULT_TEXT_PRESET);

  const sessionId = screen.name === "home" ? null : screen.sessionId;
  const sessionQuery = useReconciliationSession(sessionId);

  const candidates = useCandidateWindow({
    accountId: screen.name === "import" ? screen.accountId : null,
    statementStart: period?.start ?? null,
    statementEnd: period?.end ?? null,
    matchToleranceDays: matchConfig.dateToleranceDays,
    paddingDays: matchConfig.candidatePaddingDays,
  });

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

  const coverage = useMemo(
    () =>
      summarizeCoverage(items, {
        statementRows: parsedRows.length,
        actualTransactions: snapshot.length,
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
    setScreen({
      name: "import",
      sessionId: session.id,
      accountId: account.id,
      accountName: account.name,
    });
  }

  /**
   * Parse → load the candidate window → match → persist.
   *
   * The candidate window can only be loaded once the statement period is known,
   * so this runs after parsing rather than alongside it.
   */
  async function handleParsed(result: NormalizedStatement, fileName: string | null) {
    if (screen.name !== "import" || !result.period) return;
    setMatchError(null);
    setParsedRows(result.rows);
    setPeriod(result.period);
    setStatementName(fileName);

    try {
      const loaded = await candidates.refetch();
      const transactions = loaded.data?.transactions ?? [];
      setSnapshot(transactions);

      const graph = match({
        statementRows: result.rows,
        actualTransactions: transactions,
        config: matchConfig,
      });

      const built = buildReconciliationItems({
        statementRows: result.rows,
        actualTransactions: transactions,
        graph,
        transfersReported: loaded.data?.transfersReported ?? false,
        statementPeriod: result.period,
        makeId: () => generateId(),
      });
      setItems(built);

      await mutations.saveParsedStatement.mutateAsync({
        sessionId: screen.sessionId,
        statementRows: result.rows,
        items: built.map((item) => ({
          id: item.id,
          statementRowIds: item.statementRowIds,
          actualTransactionIds: item.actualTransactionIds,
          disposition: item.disposition,
          reasonCode: item.reasonCode ?? null,
          match: item.match,
          guards: item.guards,
          actualSnapshot:
            transactionsSnapshotFor(item, transactions) ?? null,
        })),
        patch: {
          status: "needs_review",
          statementName: fileName,
          statementStart: result.period.start,
          statementEnd: result.period.end,
          totals: result.totals,
          matchConfig,
        },
      });

      setScreen({ name: "workbench", sessionId: screen.sessionId });
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : "Could not match the statement");
    }
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
          onMatchConfigChange={(preset, config) => {
            setMatchPreset(preset);
            setMatchConfig(config);
          }}
          onCancel={() => setScreen({ name: "home" })}
          onParsed={(result, fileName) => void handleParsed(result, fileName)}
          isSaving={mutations.saveParsedStatement.isPending || candidates.isFetching}
        />
      </PageLayout>
    );
  }

  if (screen.name === "workbench") {
    const session = sessionQuery.data?.session;
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
        <Workbench
          accountName={session?.accountName ?? "Account"}
          statementName={statementName ?? session?.statementName ?? null}
          period={period}
          items={items}
          statementRows={statementRowsById}
          transactions={transactionsById}
          coverage={coverage}
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

      <div className="min-h-0 flex-1 overflow-auto">
        <SessionList
          sessions={sessionsQuery.data ?? []}
          onOpen={(session) => setScreen({ name: "workbench", sessionId: session.id })}
          onDelete={(session) => void mutations.deleteSession.mutateAsync(session.id)}
          onNew={() => document.getElementById("reconciliation-account")?.focus()}
        />
      </div>
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
