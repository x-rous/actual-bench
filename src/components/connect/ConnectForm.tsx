"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Server,
  Plus,
  Check,
  KeyRound,
  BookOpen,
  ExternalLink,
  X,
  ChevronLeft,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useIsHydrated } from "@/hooks/useIsHydrated";
import { useConnectForm } from "./useConnectForm";
import { useConnectionVault } from "@/features/connect/useConnectionVault";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConnectionsList } from "./ConnectionsList";
import { mergeConnections } from "./mergeConnections";
import { RememberToggle } from "./RememberToggle";
import { deriveLabel, getConnectionModeBadge } from "./utils";

const DOCS_URL = "https://x-rous.github.io/actual-bench";
const GITHUB_URL = "https://github.com/x-rous/actual-bench";

type ConnectFormProps = {
  directBrowserApiEnabled: boolean;
};

export function ConnectForm({ directBrowserApiEnabled }: ConnectFormProps) {
  const router = useRouter();
  const hydrated = useIsHydrated();
  const connectedInstance = useConnectionStore(selectActiveInstance);
  const vault = useConnectionVault();

  // Budgets already reachable via a saved (vault) connection — lets us warn when
  // reconnecting the same budget through a different mode/URL.
  const savedBudgets = useMemo(
    () =>
      vault.budgets.flatMap((b) => {
        const srv = vault.servers.find((s) => s.serverFingerprint === b.serverFingerprint);
        return srv
          ? [{ budgetSyncId: b.budgetSyncId, mode: srv.mode, baseUrl: srv.baseUrl, label: b.name || deriveLabel(srv.baseUrl) }]
          : [];
      }),
    [vault.budgets, vault.servers]
  );

  const {
    instances,
    savedServersForMode,
    removeInstance,
    connectionMode,
    handleModeChange,
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    serverPassword,
    setServerPassword,
    validateStatus,
    setValidateStatus,
    selectedServerId,
    setSelectedServerId,
    budgets,
    validatedMode,
    validatedUrl,
    validatedApiVersion,
    validatedServerVersion,
    selectedGroupId,
    setSelectedGroupId,
    encryptionPassword,
    setEncryptionPassword,
    connectStatus,
    setConnectStatus,
    reconnectBusyId,
    validateBusy,
    connectBusy,
    anyBusy,
    resetStep2,
    handleCredentialChange,
    handleSelectServer,
    handleReconnect,
    handleValidate,
    handleKeyDown,
    handleConnect,
    rememberOnServer,
    setRememberOnServer,
    startFromRememberedServer,
    openRememberedBudget,
    handleSelectBudget,
    pendingBudgetSwitch,
    dismissBudgetSwitch,
  } = useConnectForm({ savedBudgets });

  // One server-grouped view of everything openable: this-session connections +
  // the saved vault. Each budget appears once, deduped by server + sync id.
  const mergedServers = useMemo(
    () => mergeConnections(instances, vault.servers, vault.budgets),
    [instances, vault.servers, vault.budgets]
  );

  // Sync ids already open this session / saved in the vault — used to flag
  // budgets in the picker so you can tell which are new and which you already have.
  const openSyncIds = useMemo(() => new Set(instances.map((i) => i.budgetSyncId)), [instances]);
  const savedSyncIds = useMemo(() => new Set(vault.budgets.map((b) => b.budgetSyncId)), [vault.budgets]);

  // Whether the add-a-server workspace is expanded (returning users start on a
  // calm CTA so the saved list stays the focus).
  const [addingServer, setAddingServer] = useState(false);

  useEffect(() => {
    if (hydrated && connectedInstance) {
      router.replace("/overview");
    }
  }, [hydrated, connectedInstance, router]);

  if (hydrated && connectedInstance) {
    return null;
  }

  const activeValidatedMode = validatedMode ?? connectionMode;
  const hasSideContent = mergedServers.length > 0;
  const inFlow = budgets !== null; // budgets loaded → choosing a budget
  const showForm = !hasSideContent || addingServer || inFlow;
  const workspaceState = !showForm ? "idle" : inFlow ? "step2" : "step1";

  function openAdd() {
    setAddingServer(true);
  }
  function closeAdd() {
    setAddingServer(false);
    resetStep2();
    setBaseUrl("");
    setApiKey("");
    setServerPassword("");
    setSelectedServerId(null);
    setValidateStatus({ kind: "idle" });
  }

  // ── Step 1: choose a server ─────────────────────────────────────────────────
  const step1 = (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-action text-[11px] font-bold text-action-foreground">
          1
        </span>
        <h3 className="flex-1 text-sm font-semibold tracking-tight">
          {hasSideContent ? "Add a server" : "Connect your Actual server"}
        </h3>
        {hasSideContent && (
          <button
            type="button"
            onClick={closeAdd}
            disabled={anyBusy}
            aria-label="Cancel"
            className="flex size-8 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="size-[15px]" />
          </button>
        )}
      </div>

      <p className="-mt-1 text-sm leading-relaxed text-muted-foreground">
        Point Actual Bench at your budget server to review, sync, and manage it. Choose{" "}
        <span className="font-medium text-foreground">HTTP API</span> for a hosted API server, or{" "}
        <span className="font-medium text-foreground">Direct</span> to talk to Actual itself.
      </p>

      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Connection type">
        <button
          type="button"
          role="tab"
          aria-selected={connectionMode === "http-api"}
          disabled={anyBusy}
          onClick={() => handleModeChange("http-api")}
          className={cn(
            "flex flex-col gap-1.5 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
            connectionMode === "http-api"
              ? "border-action bg-action/[0.06] ring-3 ring-action/15"
              : "border-input bg-muted/40 hover:border-muted-foreground/40"
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4 text-action" />
            HTTP API Server
          </span>
          <span className="text-xs leading-snug text-muted-foreground">Through an actual-http-api server.</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={connectionMode === "browser-api"}
          disabled={anyBusy || !directBrowserApiEnabled}
          title={directBrowserApiEnabled ? "Direct Actual Server" : "Direct mode is disabled for this deployment"}
          onClick={() => handleModeChange("browser-api")}
          className={cn(
            "flex flex-col gap-1.5 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
            connectionMode === "browser-api"
              ? "border-action bg-action/[0.06] ring-3 ring-action/15"
              : "border-input bg-muted/40 hover:border-muted-foreground/40"
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4 text-action" />
            Direct Actual Server
          </span>
          <span className="text-xs leading-snug text-muted-foreground">Actual&apos;s API runs in your browser.</span>
        </button>
      </div>

      {!directBrowserApiEnabled && (
        <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            Direct mode is disabled for this deployment. Remove <code>DIRECT_BROWSER_API=0</code> and restart to
            show both modes.
          </span>
        </div>
      )}

      {savedServersForMode.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {savedServersForMode.map((server) => (
            <button
              key={server.id}
              type="button"
              disabled={anyBusy}
              onClick={() => handleSelectServer(server)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                selectedServerId === server.id
                  ? "bg-primary text-primary-foreground"
                  : "border bg-background hover:bg-muted"
              )}
            >
              {selectedServerId === server.id && <Check className="size-3" />}
              {server.label}
            </button>
          ))}
          <button
            type="button"
            disabled={anyBusy}
            onClick={() => handleSelectServer(null)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              selectedServerId === null
                ? "border border-action bg-action/5 text-action"
                : "border border-dashed text-muted-foreground hover:bg-muted"
            )}
          >
            <Plus className="size-3" />
            New server
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="baseUrl" className="text-sm text-muted-foreground">
          {connectionMode === "browser-api" ? "Actual Server URL" : "HTTP API Server URL"}
        </Label>
        <Input
          id="baseUrl"
          type="text"
          placeholder={connectionMode === "browser-api" ? "https://actual.example.com" : "https://budgetapi.example.com"}
          autoComplete="off"
          spellCheck={false}
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            if (validateStatus.kind === "error") setValidateStatus({ kind: "idle" });
            setSelectedServerId(null);
            handleCredentialChange();
          }}
          onKeyDown={handleKeyDown}
          disabled={anyBusy}
        />
      </div>

      {connectionMode === "http-api" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="apiKey" className="text-sm text-muted-foreground">
            API Key
          </Label>
          <Input
            id="apiKey"
            type="password"
            placeholder="••••••••••••••••"
            autoComplete="current-password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              if (validateStatus.kind === "error") setValidateStatus({ kind: "idle" });
              handleCredentialChange();
            }}
            onKeyDown={handleKeyDown}
            disabled={anyBusy}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="serverPassword" className="text-sm text-muted-foreground">
            Server password
          </Label>
          <Input
            id="serverPassword"
            type="password"
            placeholder="••••••••••••••••"
            autoComplete="current-password"
            value={serverPassword}
            onChange={(e) => {
              setServerPassword(e.target.value);
              if (validateStatus.kind === "error") setValidateStatus({ kind: "idle" });
              handleCredentialChange();
            }}
            onKeyDown={handleKeyDown}
            disabled={anyBusy}
          />
        </div>
      )}

      {validateStatus.kind === "error" && (
        <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{validateStatus.message}</span>
        </div>
      )}

      <Button className="w-full" onClick={handleValidate} disabled={anyBusy}>
        {validateBusy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Loading budgets…
          </>
        ) : (
          "Load budgets"
        )}
      </Button>
    </div>
  );

  // ── Step 2: choose a budget ─────────────────────────────────────────────────
  const step2 =
    budgets !== null ? (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={resetStep2}
            disabled={connectBusy || !!reconnectBusyId}
            aria-label="Back"
            className="flex size-8 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <ChevronLeft className="size-[17px]" />
          </button>
          <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-staged-new text-action-foreground">
            <Check className="size-3" />
          </span>
          <h3 className="flex-1 text-sm font-semibold tracking-tight">Choose a budget</h3>
          {hasSideContent && (
            <button
              type="button"
              onClick={closeAdd}
              disabled={connectBusy || !!reconnectBusyId}
              aria-label="Cancel"
              className="flex size-8 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="size-[15px]" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 shrink-0 text-staged-new" />
          <span className="truncate">
            Connected to <span className="font-mono font-medium text-foreground">{deriveLabel(validatedUrl)}</span> ·{" "}
            {getConnectionModeBadge(activeValidatedMode)} · {budgets.length}{" "}
            {budgets.length === 1 ? "budget" : "budgets"} found
            {validatedApiVersion && ` · API v${validatedApiVersion}`}
            {validatedServerVersion && ` · Actual v${validatedServerVersion}`}
          </span>
        </div>

        <div className="-mx-1 flex max-h-[21rem] flex-col gap-2 overflow-y-auto px-1">
          {budgets.map((budget) => {
            const selected = selectedGroupId === budget.groupId;
            return (
              <button
                key={budget.groupId}
                type="button"
                disabled={connectBusy || !!reconnectBusyId}
                onClick={() => {
                  if (budget.groupId) handleSelectBudget(budget.groupId);
                  else setSelectedGroupId(null);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50",
                  selected
                    ? "border-primary bg-muted"
                    : "border-border hover:border-muted-foreground/40 hover:bg-muted/40"
                )}
              >
                <span
                  className={cn(
                    "grid size-[18px] shrink-0 place-items-center rounded-full transition-colors",
                    selected ? "bg-primary text-primary-foreground" : "border-2 border-border"
                  )}
                >
                  {selected && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {budget.name || budget.cloudFileId}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    Sync ID: {budget.groupId}
                  </span>
                </span>
                {budget.groupId && openSyncIds.has(budget.groupId) ? (
                  <span className="shrink-0 rounded-full bg-staged-new/12 px-2 py-0.5 text-[10px] font-medium text-staged-new">
                    open now
                  </span>
                ) : budget.groupId && savedSyncIds.has(budget.groupId) ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    saved
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="encryptionPassword" className="text-sm text-muted-foreground">
            Encryption password <span className="text-muted-foreground/70">(optional)</span>
          </Label>
          <Input
            id="encryptionPassword"
            type="password"
            placeholder="Only if this budget is end-to-end encrypted"
            autoComplete="off"
            value={encryptionPassword}
            onChange={(e) => {
              setEncryptionPassword(e.target.value);
              if (connectStatus.kind === "error") setConnectStatus({ kind: "idle" });
            }}
            disabled={connectBusy || !!reconnectBusyId}
          />
        </div>

        {connectStatus.kind === "error" && (
          <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{connectStatus.message}</span>
          </div>
        )}

        <RememberToggle
          vault={vault}
          checked={rememberOnServer}
          onCheckedChange={setRememberOnServer}
          disabled={connectBusy || !!reconnectBusyId}
        />

        <Button className="w-full" onClick={handleConnect} disabled={connectBusy || !!reconnectBusyId || !selectedGroupId}>
          {connectBusy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Connecting…
            </>
          ) : (
            "Connect"
          )}
        </Button>
      </div>
    ) : null;

  // ── Idle CTA (returning users, form collapsed) ──────────────────────────────
  const idleCta = (
    <div className="px-5 py-7 text-center">
      <div className="mx-auto mb-3.5 grid size-14 place-items-center rounded-2xl bg-action/10 text-action">
        <Plus className="size-7" />
      </div>
      <h3 className="text-base font-semibold tracking-tight">Add a server</h3>
      <p className="mx-auto mb-4 mt-1 max-w-[34ch] text-sm text-muted-foreground">
        Connect another Actual server, Direct or through an HTTP API server.
      </p>
      <Button onClick={openAdd}>Add a server</Button>
    </div>
  );

  const workspace = (
    <div className="overflow-hidden rounded-xl border bg-card shadow-lg lg:sticky lg:top-6">
      <div key={workspaceState} className="animate-in fade-in slide-in-from-right-2 duration-300">
        {workspaceState === "idle" ? idleCta : workspaceState === "step2" ? step2 : step1}
      </div>
    </div>
  );

  return (
    <div className={cn("flex w-full flex-col", hasSideContent ? "max-w-[70rem]" : "max-w-md")}>
      {/* Brand header */}
      <div className="mb-7 flex justify-center">
        <Image src="/logo.png" alt="Actual Bench" width={160} height={40} priority />
      </div>

      {hasSideContent ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {/* Left: saved connections */}
          <div className="flex flex-col gap-4">
            <ConnectionsList
              vault={vault}
              servers={mergedServers}
              onReconnectInstance={handleReconnect}
              reconnectBusyId={reconnectBusyId}
              onOpenBudget={openRememberedBudget}
              onOpenServer={startFromRememberedServer}
              onForgetInstance={removeInstance}
              busy={anyBusy}
            />
          </div>

          {/* Right: workspace */}
          <div>{workspace}</div>
        </div>
      ) : (
        /* First run — single centered column */
        <section className="flex flex-col gap-4">{workspace}</section>
      )}

      {/* Docs / GitHub — always available */}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BookOpen className="size-4" />
          Documentation
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-4" />
          GitHub
        </a>
      </div>

      <ConfirmDialog
        open={!!pendingBudgetSwitch}
        onOpenChange={(open) => {
          if (!open) dismissBudgetSwitch();
        }}
        state={pendingBudgetSwitch}
      />
    </div>
  );
}
