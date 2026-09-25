"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { enrollCredential } from "@/features/sync/lib/syncApi";
import type { ServerBudget } from "../lib/automationsApi";

/**
 * Enrolling several budgets on an enrolled server at once (PR-071a).
 *
 * Bench saves one password or API key per server, so the budgets here need
 * nothing from the browser - the server uses the saved one. Only an encrypted
 * budget needs its encryption password, typed on its own row. Each budget is
 * checked with the server and enrolled one at a time, so one failure is
 * reported on its row and can be retried without redoing the rest.
 */

type RowState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "enrolled" }
  | { kind: "failed"; message: string };

export function EnrolServerBudgetsDialog({
  open,
  onOpenChange,
  server,
  budgets,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: { mode: string; baseUrl: string };
  budgets: ServerBudget[];
  /** Called after each budget that enrols, so the page can refresh. */
  onEnrolled: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  const choosable = budgets.filter((budget) => !budget.enrolled && rows[budget.budgetSyncId]?.kind !== "enrolled");
  const chosen = choosable.filter((budget) => selected.has(budget.budgetSyncId));
  const missingPassword = chosen.some((budget) => budget.encrypted && !passwords[budget.budgetSyncId]?.trim());

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const setRow = (id: string, state: RowState) => setRows((current) => ({ ...current, [id]: state }));

  async function enrolChosen() {
    setRunning(true);
    try {
      for (const budget of chosen) {
        setRow(budget.budgetSyncId, { kind: "checking" });
        const password = passwords[budget.budgetSyncId]?.trim();
        try {
          await enrollCredential({
            connectionFingerprint: budget.connectionFingerprint,
            mode: server.mode,
            baseUrl: server.baseUrl,
            budgetSyncId: budget.budgetSyncId,
            label: budget.name,
            secret: budget.encrypted && password ? { encryptionPassword: password } : {},
          });
          setRow(budget.budgetSyncId, { kind: "enrolled" });
          toggle(budget.budgetSyncId, false);
          onEnrolled();
        } catch (error) {
          setRow(budget.budgetSyncId, {
            kind: "failed",
            message: error instanceof Error ? error.message : "Could not enrol this budget.",
          });
        }
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enrol budgets on this server</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Bench already has this server&rsquo;s {server.mode === "http-api" ? "API key" : "password"}, so these
            budgets need nothing more, except an encryption password for an encrypted budget. Each one is checked
            with the server first. Nothing is saved if the check fails.
          </p>

          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {budgets.map((budget) => {
              const row = rows[budget.budgetSyncId] ?? { kind: "idle" };
              const done = budget.enrolled || row.kind === "enrolled";
              const checked = done || selected.has(budget.budgetSyncId);
              return (
                <li key={budget.budgetSyncId} className="rounded-md border border-border px-2.5 py-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={done || running}
                      onChange={(event) => toggle(budget.budgetSyncId, event.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{budget.name}</span>
                    {budget.encrypted && !done && <span className="text-xs text-muted-foreground">Encrypted</span>}
                    {done && (
                      <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Enrolled
                      </span>
                    )}
                    {row.kind === "checking" && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking...
                      </span>
                    )}
                  </label>
                  {budget.encrypted && !done && selected.has(budget.budgetSyncId) && (
                    <Input
                      type="password"
                      autoComplete="off"
                      className="mt-1.5 h-7 text-xs"
                      placeholder="Encryption password"
                      aria-label={`Encryption password for ${budget.name}`}
                      value={passwords[budget.budgetSyncId] ?? ""}
                      disabled={running}
                      onChange={(event) =>
                        setPasswords((current) => ({ ...current, [budget.budgetSyncId]: event.target.value }))
                      }
                    />
                  )}
                  {row.kind === "failed" && <p className="mt-1 text-xs text-destructive">{row.message}</p>}
                </li>
              );
            })}
          </ul>

          {choosable.length === 0 && (
            <p className="text-xs text-muted-foreground">Every budget on this server is enrolled.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={running}>
            Close
          </Button>
          <Button size="sm" onClick={() => void enrolChosen()} disabled={running || chosen.length === 0 || missingPassword}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {running ? "Enrolling..." : chosen.length > 1 ? `Enrol ${chosen.length} budgets` : "Enrol"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
