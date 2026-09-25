"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  /**
   * Called once, when a batch has finished, with the budgets that enrolled -
   * so the page updates once, not after every budget.
   */
  onEnrolled: (budgets: ServerBudget[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  // A budget is enrolled once (PR-071c). On a Direct server, one enrolled
  // through HTTP API can be switched to Direct, the recommended route; on an
  // HTTP API server, one enrolled through Direct simply shows as enrolled.
  const directServer = server.mode === "browser-api";
  const settled = (budget: ServerBudget) =>
    budget.enrolled || (!!budget.enrolledVia && !directServer) || rows[budget.budgetSyncId]?.kind === "enrolled";
  const choosable = budgets.filter((budget) => !settled(budget));
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

  // Closing forgets what was typed and chosen: encryption passwords are not
  // kept once the dialog is gone, and old row messages do not greet the next
  // open.
  function setOpen(next: boolean) {
    if (!next) {
      setSelected(new Set());
      setPasswords({});
      setRows({});
    }
    onOpenChange(next);
  }

  async function enrolChosen() {
    setRunning(true);
    const done: ServerBudget[] = [];
    let failed = false;
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
          // Stored on the server now; the browser does not need it any more.
          setPasswords((current) => {
            const { [budget.budgetSyncId]: _used, ...rest } = current;
            void _used;
            return rest;
          });
          done.push(budget);
        } catch (error) {
          failed = true;
          setRow(budget.budgetSyncId, {
            kind: "failed",
            message: error instanceof Error ? error.message : "Could not enrol this budget.",
          });
        }
      }
    } finally {
      setRunning(false);
    }
    // The page updates once, with everything that enrolled. The dialog stays
    // open while it works; it closes itself when all went through, and stays
    // open when something failed, so the failure can be fixed and retried.
    if (done.length > 0) {
      onEnrolled(done);
      toast.success(done.length === 1 ? `${done[0].name} enrolled` : `${done.length} budgets enrolled`);
    }
    if (!failed) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enrol budgets on this server</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Bench already has this server&rsquo;s {server.mode === "http-api" ? "API key" : "password"}, so these
            budgets need nothing more, except an encryption password for an encrypted budget. Each one is checked
            with the server first. Nothing is saved if the check fails.
            {directServer && budgets.some((budget) => budget.enrolledVia && !budget.enrolled)
              ? " Switching a budget from HTTP API to Direct moves its automations to Direct."
              : ""}
          </p>

          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {budgets.map((budget) => {
              const row = rows[budget.budgetSyncId] ?? { kind: "idle" };
              const done = settled(budget);
              const switching = directServer && !!budget.enrolledVia && !done;
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
                    {switching && (
                      <span className="text-xs text-muted-foreground">Enrolled through HTTP API - select to switch to Direct</span>
                    )}
                    {done && (
                      <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        {budget.enrolledVia && !directServer ? "Enrolled through Direct" : "Enrolled"}
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
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={running}>
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
