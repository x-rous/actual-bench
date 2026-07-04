"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Play, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  BrowserApiLabInput,
  BrowserApiLabResult,
  BrowserApiLabStepId,
  BrowserApiLabStepStatus,
} from "@/lib/actual/browser/labRuntime";
import { cn } from "@/lib/utils";

type BrowserApiLabClientProps = {
  enabled: boolean;
};

type LabStep = {
  id: BrowserApiLabStepId;
  label: string;
  status: "idle" | BrowserApiLabStepStatus;
  detail?: string;
};

const INITIAL_STEPS: LabStep[] = [
  { id: "load", label: "Load browser API", status: "idle" },
  { id: "init", label: "Initialize worker", status: "idle" },
  { id: "budgets", label: "List budgets", status: "idle" },
  { id: "download", label: "Download budget", status: "idle" },
  { id: "accounts", label: "Read accounts", status: "idle" },
  { id: "sync", label: "Sync", status: "idle" },
  { id: "shutdown", label: "Shutdown", status: "idle" },
];

function stepIcon(status: LabStep["status"]) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  return <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

function getCrossOriginIsolated(): boolean | null {
  if (typeof window === "undefined") return null;
  return window.crossOriginIsolated;
}

export function BrowserApiLabClient({ enabled }: BrowserApiLabClientProps) {
  const [form, setForm] = useState<BrowserApiLabInput>({
    serverUrl: "",
    serverPassword: "",
    budgetSyncId: "",
    encryptionPassword: "",
  });
  const [steps, setSteps] = useState<LabStep[]>(INITIAL_STEPS);
  const [result, setResult] = useState<BrowserApiLabResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [crossOriginIsolated, setCrossOriginIsolated] = useState<boolean | null>(null);
  const [browserEvents, setBrowserEvents] = useState<string[]>([]);

  useEffect(() => {
    setCrossOriginIsolated(getCrossOriginIsolated());

    function addBrowserEvent(message: string) {
      setBrowserEvents((current) => [message, ...current].slice(0, 8));
    }

    function handleError(event: ErrorEvent) {
      addBrowserEvent(event.message || "Unhandled browser error");
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      addBrowserEvent(
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection"
      );
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  const canRun =
    enabled &&
    !isRunning &&
    form.serverUrl.trim() !== "" &&
    form.serverPassword !== "" &&
    form.budgetSyncId.trim() !== "";

  const statusLabel = !enabled
    ? "Disabled"
    : isRunning
      ? "Running"
      : error
        ? "Failed"
        : result
          ? "Passed"
          : "Ready";

  function updateField(field: keyof BrowserApiLabInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetRunState() {
    setSteps(INITIAL_STEPS);
    setResult(null);
    setError(null);
    setBrowserEvents([]);
  }

  function runLab() {
    if (!canRun) return;
    resetRunState();
    setIsRunning(true);
    void (async () => {
      try {
        const { runBrowserApiLab } = await import("@/lib/actual/browser/labRuntime");
        const labResult = await runBrowserApiLab(form, (update) => {
          setSteps((current) =>
            current.map((step) =>
              step.id === update.id
                ? { ...step, status: update.status, detail: update.detail }
                : step
            )
          );
        });
        setResult(labResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown browser API lab failure");
      } finally {
        setIsRunning(false);
      }
    })();
  }

  return (
    <main className="h-screen overflow-y-auto bg-muted/30 p-4 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 py-4 md:py-8">
        <header className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-normal">Direct Browser API Lab</h1>
              <Badge variant={enabled ? "status-warning" : "status-inactive"}>Experimental</Badge>
              <Badge variant={error ? "destructive" : result ? "status-active" : "outline"}>
                {statusLabel}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Runtime check for Actual browser API worker, deployment headers, and Direct transport setup.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <ShieldCheck className={cn("h-4 w-4", crossOriginIsolated ? "text-green-600" : "text-muted-foreground")} />
            <span>crossOriginIsolated:</span>
            <span className="font-mono text-xs">{String(crossOriginIsolated)}</span>
          </div>
        </header>

        {!enabled && (
          <section className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Browser API lab is disabled for this deployment.</p>
              <p className="mt-1">Remove DIRECT_BROWSER_API=0 or NEXT_PUBLIC_DIRECT_BROWSER_API=0 and restart the app to enable this route.</p>
            </div>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-border bg-background p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="serverUrl">Actual Server URL</Label>
                <Input
                  id="serverUrl"
                  type="url"
                  placeholder="https://actual.example.com"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.serverUrl}
                  onChange={(event) => updateField("serverUrl", event.target.value)}
                  disabled={!enabled || isRunning}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="serverPassword">Server Password</Label>
                <Input
                  id="serverPassword"
                  type="password"
                  autoComplete="current-password"
                  value={form.serverPassword}
                  onChange={(event) => updateField("serverPassword", event.target.value)}
                  disabled={!enabled || isRunning}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="encryptionPassword">Budget Encryption Password</Label>
                <Input
                  id="encryptionPassword"
                  type="password"
                  autoComplete="current-password"
                  value={form.encryptionPassword ?? ""}
                  onChange={(event) => updateField("encryptionPassword", event.target.value)}
                  disabled={!enabled || isRunning}
                />
              </div>

              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="budgetSyncId">Budget Sync ID</Label>
                <Input
                  id="budgetSyncId"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.budgetSyncId}
                  onChange={(event) => updateField("budgetSyncId", event.target.value)}
                  disabled={!enabled || isRunning}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={runLab} disabled={!canRun}>
                {isRunning ? (
                  <Loader2 data-icon="inline-start" className="h-4 w-4 animate-spin" />
                ) : (
                  <Play data-icon="inline-start" className="h-4 w-4" />
                )}
                Run lab
              </Button>
              <Button type="button" variant="outline" onClick={resetRunState} disabled={isRunning}>
                Reset
              </Button>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </section>

          <aside className="rounded-lg border border-border bg-background p-5">
            <h2 className="text-sm font-semibold">Run Steps</h2>
            <ol className="mt-4 space-y-3">
              {steps.map((step) => (
                <li key={step.id} className="flex gap-3">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                    {stepIcon(step.status)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{step.label}</span>
                      <span className="text-xs capitalize text-muted-foreground">{step.status}</span>
                    </div>
                    {step.detail && <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>


        {browserEvents.length > 0 && (
          <section className="rounded-lg border border-border bg-background p-5">
            <h2 className="text-sm font-semibold">Browser Events</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {browserEvents.map((event, index) => (
                <li key={`${index}-${event}`} className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">
                  {event}
                </li>
              ))}
            </ul>
          </section>
        )}

        {result && (
          <section className="rounded-lg border border-border bg-background p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Result</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {result.budgetCount} budgets returned. Opened {result.selectedBudgetName ?? result.selectedBudgetSyncId}.
                </p>
              </div>
              <Badge variant="status-active">{result.accounts.length} accounts</Badge>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium">Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {result.accounts.slice(0, 12).map((account) => (
                    <tr key={account.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{account.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {account.closed ? "Closed" : "Open"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {account.offbudget ? "Off budget" : "On budget"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
