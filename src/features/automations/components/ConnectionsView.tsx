"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { PageLayout } from "@/components/layout/PageLayout";
import { cn } from "@/lib/utils";
import { withdrawCredential } from "@/features/sync/lib/syncApi";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isHttpApiConnection, selectActiveInstance, useConnectionStore } from "@/store/connection";
import { listEnrolledConnections, listServerBudgets, type EnrolledConnection } from "../lib/automationsApi";
import { formatDateTime } from "../lib/presentation";
import { AutomationsTabs } from "./AutomationsTabs";
import { EnrolConnection } from "./EnrolConnection";
import { EnrolServerBudgetsDialog } from "./EnrolServerBudgetsDialog";

/**
 * Unattended access (RD-058, given a home).
 *
 * The list of budgets Bench may act on with nobody watching, and - the column
 * that earns this page - what depends on each one. Withdrawing a credential
 * stops every automation naming it; the engine already fails closed and says
 * why, but nobody should discover that by doing it.
 *
 * It lives beside Automations and Run history because this is the prerequisite
 * for everything those two pages show. Budget File Sync keeps its own in-context
 * enrolment: someone switching a flow to unattended should not be sent here
 * mid-task, which is the exact problem this page exists to fix elsewhere.
 */

const headerCell = "px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide";

/** A server's budget list is cached this long, so opening the page does not sign in every time. */
const SERVER_BUDGETS_STALE_MS = 5 * 60_000;

function modeName(mode: string | undefined): string {
  return mode === "http-api" ? "HTTP API" : "Direct";
}

/** One entry per server: the first enrolled budget on it stands for the server. */
function enrolledServers(connections: EnrolledConnection[]): EnrolledConnection[] {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    const key = `${connection.mode} ${connection.baseUrl.trim().replace(/\/+$/, "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The other budgets on one enrolled server (PR-071a). Listed automatically -
 * the server signs in from a worker with its saved password or key - and
 * enrolled from there with nothing from the browser.
 */
function OtherServerBudgets({ server, onEnrolled }: { server: EnrolledConnection; onEnrolled: () => void }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["server-budgets", server.connectionFingerprint],
    queryFn: () => listServerBudgets(server.connectionFingerprint),
    staleTime: SERVER_BUDGETS_STALE_MS,
    retry: false,
  });
  const budgets = query.data?.budgets ?? [];
  const others = budgets.filter((budget) => !budget.enrolled && !budget.enrolledVia);
  const viaOther = budgets.filter((budget) => !budget.enrolled && budget.enrolledVia);

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{server.baseUrl}</span>
        <span className="ml-1.5 text-muted-foreground">({modeName(server.mode)})</span>
        <span className="block text-muted-foreground">
          {query.isLoading
            ? "Looking for other budgets on this server..."
            : query.isError
              ? (query.error as Error).message
              : others.length === 0
                ? "Every budget on this server is enrolled."
                : `${others.length} other ${others.length === 1 ? "budget" : "budgets"}: ${others.map((budget) => budget.name).join(", ")}`}
        </span>
        {viaOther.length > 0 && (
          <span className="block text-muted-foreground">
            Already enrolled another way:{" "}
            {viaOther.map((budget) => `${budget.name} (through ${modeName(budget.enrolledVia)})`).join(", ")}
          </span>
        )}
      </span>
      {query.isError ? (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void query.refetch()}>
          Try again
        </Button>
      ) : (
        others.length > 0 && (
          <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>
            Enrol budgets on this server
          </Button>
        )
      )}
      {query.data && (
        <EnrolServerBudgetsDialog
          open={open}
          onOpenChange={setOpen}
          server={query.data.server}
          budgets={budgets}
          onEnrolled={onEnrolled}
        />
      )}
    </li>
  );
}

export function ConnectionsView() {
  const queryClient = useQueryClient();
  const active = useConnectionStore(selectActiveInstance);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const query = useQuery({
    queryKey: ["automation-connections"],
    queryFn: listEnrolledConnections,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["automation-connections"] });
    void queryClient.invalidateQueries({ queryKey: ["vault-status"] });
  };
  // A budget just enrolled changes the "other budgets" list; the list itself is
  // not re-read from the server, only its enrolled flags.
  const onServerBudgetEnrolled = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: ["server-budgets"] });
  };

  const withdraw = useMutation({
    mutationFn: withdrawCredential,
    onSuccess: () => {
      toast.success("Credential withdrawn");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      // Refresh re-reads each server's budgets too, past the cache.
      await Promise.all([query.refetch(), queryClient.refetchQueries({ queryKey: ["server-budgets"] })]);
    } finally {
      setRefreshing(false);
    }
  }

  const connections = query.data?.connections ?? [];
  const activeEnrolled =
    active && isHttpApiConnection(active)
      ? connections.some(
          (entry) => entry.connectionFingerprint === connectionFingerprint(active)
        )
      : false;

  return (
    <PageLayout
      header={<AutomationsTabs />}
      scrollManaged
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                Unattended access
                <span className="ml-2 font-normal text-muted-foreground">
                  {connections.length} {connections.length === 1 ? "budget" : "budgets"}
                </span>
              </h2>
              {/* No reading-column cap: the sentence is one thought and fits on
                  one line at desk width. Capped at 3xl it wrapped for no
                  reason, since nothing sits beside it but the Refresh button. */}
              <p className="mt-0.5 text-xs text-muted-foreground">
                Bench can act on these budgets while your browser is closed - that is what a
                scheduled sync, bank pull or backup needs. Each budget is enrolled separately, so
                three budgets means three entries here.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              aria-label="Refresh connections"
              title="Re-read which budgets are enrolled"
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
              Refresh
            </Button>
          </div>

          {/* Enrolling what you are connected to right now is the one thing
              this page can do directly, so it sits at the top when it applies. */}
          {!activeEnrolled && (
            <div className="mb-3">
              <EnrolConnection connection={active ?? null} onEnrolled={invalidate} allowDirect onConnectionsPage />
            </div>
          )}

          {connections.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No budget is enrolled yet. Until one is, anything you schedule can only run while Bench
              is open in a tab.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th scope="col" className={headerCell}>
                      Budget
                    </th>
                    <th scope="col" className={headerCell}>
                      Server
                    </th>
                    <th scope="col" className={headerCell}>
                      Enrolled
                    </th>
                    <th scope="col" className={headerCell}>
                      Used by
                    </th>
                    <th scope="col" className={cn(headerCell, "text-right")}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((connection) => (
                    <tr key={connection.connectionFingerprint} className="border-t border-border/60">
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5 font-medium">
                          <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />
                          {connection.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {connection.baseUrl}
                        <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px]">{modeName(connection.mode)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {formatDateTime(connection.enrolledAt)}
                      </td>
                      <td className="px-3 py-1.5">
                        {connection.usedBy.length === 0 ? (
                          <span className="text-muted-foreground">not used yet</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {connection.usedBy.map((automation) => (
                              <Link
                                key={automation.id}
                                href={`/automations?open=${automation.id}`}
                                className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground underline-offset-4 hover:underline"
                                title={`${automation.typeLabel}${automation.enabled ? "" : " (paused)"}`}
                              >
                                {automation.name}
                              </Link>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs text-destructive"
                            disabled={withdraw.isPending}
                            onClick={() =>
                              setConfirm({
                                title: `Withdraw access to "${connection.label}"?`,
                                message:
                                  connection.usedBy.length > 0
                                    ? `${connection.usedBy.length} automation(s) rely on it - ${connection.usedBy
                                        .map((automation) => automation.name)
                                        .join(", ")} - and will stop, pausing with the reason. The stored key is deleted; nothing else changes.`
                                    : "The stored key is deleted. Nothing is using it, so nothing stops. You can enrol this budget again whenever you like.",
                                destructiveLabel: "Withdraw",
                                onConfirm: () => withdraw.mutate(connection.connectionFingerprint),
                              })
                            }
                          >
                            {withdraw.isPending &&
                            withdraw.variables === connection.connectionFingerprint ? (
                              <Loader2 className="animate-spin" aria-hidden />
                            ) : null}
                            Withdraw
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {connections.length > 0 && query.data?.vaultEnabled !== false && (
            <section className="mt-4">
              <h3 className="text-sm font-semibold">Other budgets on your servers</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Bench already has each server&rsquo;s password or API key, so the other budgets on it can be enrolled
                without connecting to them.
              </p>
              <ul className="mt-2 space-y-1.5">
                {enrolledServers(connections).map((server) => (
                  <OtherServerBudgets key={server.connectionFingerprint} server={server} onEnrolled={onServerBudgetEnrolled} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        state={confirm}
      />
    </PageLayout>
  );
}
