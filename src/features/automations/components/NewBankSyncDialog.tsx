"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Minus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  createAutomation,
  listBankSyncAccounts,
  listVaultConnections,
  type BankSyncAccountPreview,
} from "../lib/automationsApi";
import { formatDateTime, relativeTime } from "../lib/presentation";
import { browserTimezone } from "../lib/timezones";
import { SchedulePicker, type ScheduleValue } from "./SchedulePicker";
import { EnrolConnection } from "./EnrolConnection";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";

/**
 * Scheduling a bank sync (RD-080 / PR-045).
 *
 * Built around the three things a person actually decides — what gets synced,
 * how often, and when it starts — rather than around the fields the record
 * happens to have.
 *
 * The account list is the centre of it. Without it this dialog can only assert
 * "every linked account is synced" and hope; with it, someone can see that two
 * of their four accounts are connected to a bank, and that scheduling this when
 * none are would create an automation that does nothing forever.
 *
 * Cron is still available, because someone will want "weekdays at 07:00" — but
 * it lives under Custom, not beside "every few hours" as an equal choice. A
 * personal-finance app should not ask anybody to write `0 6 * * *`.
 */

const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs";

type NewBankSyncDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

function AccountRow({ account }: { account: BankSyncAccountPreview }) {
  return (
    <li className="flex items-baseline gap-2 py-0.5">
      {account.linked ? (
        <Check className="size-3 shrink-0 translate-y-0.5 text-green-600 dark:text-green-500" aria-hidden />
      ) : (
        <Minus className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" aria-hidden />
      )}
      <span className={account.linked ? undefined : "text-muted-foreground"}>{account.name}</span>
      {account.linked ? (
        account.lastSync && (
          <span className="text-muted-foreground" title={formatDateTime(account.lastSync)}>
            last synced {relativeTime(account.lastSync)}
          </span>
        )
      ) : (
        <span className="text-muted-foreground">not connected to a bank — skipped</span>
      )}
    </li>
  );
}

export function NewBankSyncDialog({ open, onOpenChange, onCreated }: NewBankSyncDialogProps) {
  const vault = useQuery({ queryKey: ["vault-connections"], queryFn: listVaultConnections, enabled: open });
  const active = useConnectionStore(selectActiveInstance);

  const [chosenConnection, setChosenConnection] = useState("");
  const [schedule, setSchedule] = useState<ScheduleValue>(() => ({
    scheduleKind: "interval",
    cronExpression: null,
    intervalMinutes: 360,
    timezone: browserTimezone(),
  }));
  const [scheduleValid, setScheduleValid] = useState(true);

  // A clock read during render is impure; snapshot it, and refresh it while the
  // dialog is open so "first run in 3 minutes" does not quietly go stale.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  const connections = useMemo(() => vault.data?.credentials ?? [], [vault.data]);
  const vaultEnabled = vault.data?.enabled ?? false;

  // Derived rather than written from an effect: the first enrolled connection
  // is the default until someone picks another, which needs no render pass to
  // settle and cannot cascade.
  const connectionFingerprint = chosenConnection || connections[0]?.connectionFingerprint || "";

  const accountsQuery = useQuery({
    queryKey: ["bank-sync-accounts", connectionFingerprint],
    queryFn: () => listBankSyncAccounts(connectionFingerprint),
    enabled: open && Boolean(connectionFingerprint),
  });

  const accounts = accountsQuery.data ?? [];
  const linked = accounts.filter((account) => account.linked);
  const create = useMutation({
    mutationFn: async () => {
      const connection = connections.find((entry) => entry.connectionFingerprint === connectionFingerprint);
      return createAutomation({
        type: "bank-sync",
        name: `Bank sync — ${connection?.label || "budget"}`,
        executionMode: "server",
        scheduleKind: schedule.scheduleKind,
        cronExpression: schedule.cronExpression,
        intervalMinutes: schedule.intervalMinutes,
        timezone: schedule.timezone,
        credentialRef: connectionFingerprint,
        targetRef: { version: 1, data: { connectionFingerprint } },
        config: { version: 1, data: { connectionFingerprint, accountIds: [] } },
      });
    },
    onSuccess: () => {
      toast.success("Bank sync scheduled");
      onCreated();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const blocked = !vaultEnabled || connections.length === 0 || linked.length === 0;
  const canSubmit = !blocked && scheduleValid && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a bank sync</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-4 pb-2 text-xs">
          <p className="text-muted-foreground">
            Pull new transactions from the banks you connected in Actual, on a schedule, without
            keeping Actual Bench open.
          </p>

          {!vaultEnabled ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              This needs the credential vault. Set <code>SYNC_VAULT_KEY</code> on the server and
              restart to enable unattended automations.
            </p>
          ) : connections.length === 0 ? (
            // Enrolling happens here rather than somewhere else: being sent to
            // another feature mid-task is the problem, not the solution.
            <div className="space-y-2">
              <p className="text-muted-foreground">
                A scheduled bank sync runs with your browser closed, so Bench needs the
                budget&rsquo;s API key stored on the server first.
              </p>
              <EnrolConnection connection={active ?? null} onEnrolled={() => void vault.refetch()} />
            </div>
          ) : (
            <>
              {connections.length > 1 && (
                <label className="block">
                  <span className="mb-1 block font-medium">Budget</span>
                  <select
                    className={`${selectClass} w-full`}
                    value={connectionFingerprint}
                    onChange={(event) => setChosenConnection(event.target.value)}
                  >
                    {connections.map((connection) => (
                      <option key={connection.connectionFingerprint} value={connection.connectionFingerprint}>
                        {connection.label || connection.baseUrl}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <section>
                <h3 className="mb-1 font-medium">What will sync</h3>

                {accountsQuery.isLoading ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Checking which accounts are connected to a bank…
                  </p>
                ) : accountsQuery.isError ? (
                  <p className="text-destructive">{(accountsQuery.error as Error).message}</p>
                ) : linked.length === 0 ? (
                  <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      None of the accounts in this budget are connected to a bank, so this would
                      never import anything. Connect an account to SimpleFIN or GoCardless in Actual
                      first.
                    </span>
                  </p>
                ) : (
                  <>
                    <ul className="rounded-md border border-border px-3 py-2">
                      {accounts.map((account) => (
                        <AccountRow key={account.id} account={account} />
                      ))}
                    </ul>
                    <p className="mt-1 text-muted-foreground">
                      {linked.length} of {accounts.length} account{accounts.length === 1 ? "" : "s"} will
                      sync. Each is synced separately, so one bank failing does not stop the others.
                    </p>
                  </>
                )}
              </section>

              <section>
                <h3 className="mb-1 font-medium">How often</h3>
                <SchedulePicker
                  value={schedule}
                  onChange={setSchedule}
                  onValidityChange={setScheduleValid}
                  nowMs={nowMs}
                />
              </section>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => create.mutate()}>
            {create.isPending ? "Scheduling…" : "Schedule sync"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
