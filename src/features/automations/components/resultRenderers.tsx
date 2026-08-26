"use client";

import Link from "next/link";
import type { AutomationRun, JsonObject, JsonValue } from "@/lib/app-db/types";

/**
 * Per-job-type run result renderers (RD-079 / PR-043d).
 *
 * The engine stores a type-owned result payload and never looks inside it, so
 * the UI must not either. A type registers a renderer here; the list and detail
 * components stay untouched when a new job type arrives — which is the same
 * acceptance criterion as the registry itself, applied to the view layer.
 *
 * The fallback matters as much as the specific renderers: an unregistered type
 * still shows its result readably rather than an empty panel, so a job type can
 * ship its engine half before its UI half.
 */

export type AutomationResultRendererProps = {
  run: AutomationRun;
  result: JsonObject;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function renderScalar(value: JsonValue): string {
  if (value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Budget File Sync: counts plus a link back to the sync run it produced. */
function BudgetFileSyncResult({ result }: AutomationResultRendererProps) {
  const applied = Number(result.applied ?? 0);
  const updated = Number(result.updated ?? 0);
  const deleted = Number(result.deleted ?? 0);
  const failed = Number(result.failed ?? 0);
  const blocked = Number(result.blocked ?? 0);
  const syncRunId = typeof result.syncRunId === "string" ? result.syncRunId : null;
  const flowId = typeof result.flowId === "string" ? result.flowId : null;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <Field label="Added" value={applied} />
        <Field label="Updated" value={updated} />
        <Field label="Deleted" value={deleted} />
        {failed > 0 && <Field label="Failed" value={failed} />}
        {blocked > 0 && <Field label="Needs review" value={blocked} />}
      </dl>

      {flowId && (
        <p className="text-xs">
          <Link href="/sync" className="text-primary underline-offset-4 hover:underline">
            Open Budget File Sync
          </Link>
          {syncRunId && (
            <span className="text-muted-foreground">
              {" "}
              — this run is recorded there in full{" "}
              <span className="font-mono text-[11px]">({syncRunId.slice(0, 8)})</span>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** Anything without a registered renderer: readable, not raw JSON soup. */
function GenericResult({ result }: AutomationResultRendererProps) {
  const entries = Object.entries(result).filter(([key]) => key !== "log");
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">This run recorded no details.</p>;
  }

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
      {entries.map(([key, value]) => (
        <Field key={key} label={key} value={renderScalar(value)} />
      ))}
    </dl>
  );
}

type BankSyncAccountRow = {
  accountId: string;
  accountName: string | null;
  status: string;
  message: string | null;
  observedNewTransactions: number | null;
};

const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  synced: "Synced",
  accepted: "Sync started",
  failed: "Failed",
  "not-linked": "No bank link",
};

/** Bank sync: what happened per account, in this type's own terms. */
function BankSyncResult({ result }: AutomationResultRendererProps) {
  const accounts = Array.isArray(result.accounts) ? (result.accounts as unknown as BankSyncAccountRow[]) : [];
  const countsObserved = result.countsObserved === true;

  if (accounts.length === 0) {
    return <p className="text-xs text-muted-foreground">No accounts were synced.</p>;
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-xs">
        {accounts.map((account) => (
          <li key={account.accountId} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{account.accountName ?? account.accountId}</span>
            <span
              className={
                account.status === "failed"
                  ? "text-destructive"
                  : account.status === "not-linked"
                    ? "text-muted-foreground"
                    : undefined
              }
            >
              {ACCOUNT_STATUS_LABEL[account.status] ?? account.status}
            </span>
            {typeof account.observedNewTransactions === "number" && (
              <span className="text-muted-foreground">
                · {account.observedNewTransactions} new
              </span>
            )}
            {account.message && <span className="text-muted-foreground">· {account.message}</span>}
          </li>
        ))}
      </ul>

      {!countsObserved && (
        // The distinction the whole feature rests on: a server that answered
        // "started" has not told us what arrived, and inventing a zero here
        // would be the one thing this must never do.
        <p className="text-[11px] text-muted-foreground">
          Actual imports in the background, so Bench cannot say how many transactions arrived.
        </p>
      )}
    </div>
  );
}

const RENDERERS: Record<string, (props: AutomationResultRendererProps) => React.ReactElement> = {
  "budget-file-sync": BudgetFileSyncResult,
  "bank-sync": BankSyncResult,
};

export function AutomationResult({ run }: { run: AutomationRun }) {
  const result = (run.result?.data ?? {}) as JsonObject;
  const Renderer = RENDERERS[run.type] ?? GenericResult;
  return <Renderer run={run} result={result} />;
}
