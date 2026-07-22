"use client";

import Image from "next/image";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, Server, Plus, Check, KeyRound, BookOpen, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    step1Complete,
    showManualForm,
    connectedSyncIds,
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
  } = useConnectForm();

  const vault = useConnectionVault();

  // One server-grouped view of everything openable: this-session connections +
  // the saved vault. Each budget appears once, deduped by server + sync id.
  const mergedServers = useMemo(
    () => mergeConnections(instances, vault.servers, vault.budgets),
    [instances, vault.servers, vault.budgets]
  );

  useEffect(() => {
    if (hydrated && connectedInstance) {
      router.replace("/overview");
    }
  }, [hydrated, connectedInstance, router]);

  if (hydrated && connectedInstance) {
    return null;
  }

  const activeValidatedMode = validatedMode ?? connectionMode;

  // Show the two-column layout when there's anything to continue from.
  const hasSideContent = mergedServers.length > 0;

  // ── Panels ──────────────────────────────────────────────────────────────────

  const step1Panel = (
    <div className="rounded-xl border border-border bg-background p-6 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            step1Complete ? "bg-green-500 text-white" : "bg-primary text-primary-foreground"
          )}
        >
          {step1Complete ? <Check className="h-3.5 w-3.5" /> : "1"}
        </div>
        <h3 className="font-semibold">Choose a server</h3>
        {step1Complete && (
          <button
            type="button"
            onClick={() => { resetStep2(); setSelectedServerId(null); }}
            disabled={anyBusy}
            className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            Change
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="Connection type">
        <button
          type="button"
          role="tab"
          aria-selected={connectionMode === "http-api"}
          disabled={anyBusy}
          onClick={() => handleModeChange("http-api")}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            connectionMode === "http-api"
              ? "border-primary bg-primary/5 text-primary"
              : "border-border hover:bg-muted"
          )}
        >
          <Server className="h-4 w-4" />
          <span className="whitespace-nowrap">HTTP API Server</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={connectionMode === "browser-api"}
          disabled={anyBusy || !directBrowserApiEnabled}
          title={
            directBrowserApiEnabled
              ? "Direct Actual Server"
              : "Direct Actual Server mode is disabled for this deployment"
          }
          onClick={() => handleModeChange("browser-api")}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            connectionMode === "browser-api"
              ? "border-primary bg-primary/5 text-primary"
              : "border-border hover:bg-muted"
          )}
        >
          <KeyRound className="h-4 w-4" />
          <span className="whitespace-nowrap">Direct Actual Server</span>
        </button>
      </div>

      {!directBrowserApiEnabled && (
        <div className="flex items-start gap-2.5 rounded-lg border border-muted bg-muted/40 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Direct Actual Server mode is disabled for this deployment. Remove <code>DIRECT_BROWSER_API=0</code> and restart the app to show both connection modes.</span>
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
                  : "border border-border bg-background hover:bg-muted"
              )}
            >
              {selectedServerId === server.id && <Check className="h-3 w-3" />}
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
                ? "border border-primary text-primary bg-primary/5"
                : "border border-dashed border-border text-muted-foreground hover:bg-muted"
            )}
          >
            <Plus className="h-3 w-3" />
            New server
          </button>
        </div>
      )}

      {showManualForm && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseUrl">
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
              <Label htmlFor="apiKey">API Key</Label>
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
              <p className="text-xs text-muted-foreground">
                The <code>ACTUAL_API_KEY</code> on your API server. Kept in memory only.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="serverPassword">Server password</Label>
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
              <p className="text-xs text-muted-foreground">
                Kept in memory only for this browser tab.
              </p>
            </div>
          )}
        </div>
      )}

      {validateStatus.kind === "error" && (
        <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{validateStatus.message}</span>
        </div>
      )}

      <button
        type="button"
        disabled={anyBusy}
        onClick={handleValidate}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {validateBusy ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Loading…</>
        ) : (
          "Load Budgets"
        )}
      </button>
    </div>
  );

  const step2Panel = budgets !== null ? (
    <div className="rounded-xl border border-border bg-background p-6 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
          2
        </div>
        <h3 className="font-semibold">Choose a budget</h3>
        <div className="ml-auto flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{deriveLabel(validatedUrl)}</span>
          <span className="text-green-600/70">· {getConnectionModeBadge(activeValidatedMode)}</span>
          {validatedApiVersion && <span className="text-green-600/70">· API v{validatedApiVersion}</span>}
          {validatedServerVersion && <span className="text-green-600/70">· Actual v{validatedServerVersion}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-2 max-h-70 overflow-y-auto pr-1">
        {budgets.map((budget) => {
          const selected = selectedGroupId === budget.groupId;
          const alreadyConnected = connectedSyncIds.has(budget.groupId ?? "");
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
                "flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/40"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center",
                  selected ? "border-primary" : "border-muted-foreground/40"
                )}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-primary block" />}
              </span>
              <span className="flex flex-col gap-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-tight">
                    {budget.name || budget.cloudFileId}
                  </span>
                  {alreadyConnected && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {activeValidatedMode === "browser-api" ? "saved" : "connected"}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground font-mono truncate">
                  Sync ID: {budget.groupId}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="encryptionPassword">
          Encryption password{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="encryptionPassword"
          type="password"
          placeholder="Leave blank if budget is not encrypted"
          autoComplete="off"
          value={encryptionPassword}
          onChange={(e) => {
            setEncryptionPassword(e.target.value);
            if (connectStatus.kind === "error") setConnectStatus({ kind: "idle" });
          }}
          disabled={connectBusy || !!reconnectBusyId}
        />
        <p className="text-xs text-muted-foreground">
          Kept in memory only for this browser tab.
        </p>
      </div>

      {connectStatus.kind === "error" && (
        <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{connectStatus.message}</span>
        </div>
      )}

      {connectStatus.kind === "success" && activeValidatedMode === "browser-api" && (
        <div className="flex items-start gap-2.5 rounded-lg bg-green-50 px-3.5 py-3 text-sm text-green-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Direct connection opened. Core entity pages and Budget Management now use the browser transport.</span>
        </div>
      )}

      <RememberToggle
        vault={vault}
        checked={rememberOnServer}
        onCheckedChange={setRememberOnServer}
        disabled={connectBusy || !!reconnectBusyId}
      />

      <button
        type="button"
        disabled={connectBusy || !!reconnectBusyId || !selectedGroupId}
        onClick={handleConnect}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {connectBusy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting…
          </>
        ) : (
          "Connect"
        )}
      </button>
    </div>
  ) : null;

  // ── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div className={cn("w-full flex flex-col gap-8", hasSideContent ? "max-w-[68rem]" : "max-w-xl")}>
      <div className="flex justify-center">
        <Image src="/logo.png" alt="Actual Bench" width={160} height={40} priority />
      </div>

      {hasSideContent ? (
        /* ── Two-column layout ── */
        <div className="grid grid-cols-1 lg:grid-cols-[9fr_11fr] gap-6 items-start">
          {/* Left: everything you can open — this session + the saved vault */}
          <div className="flex flex-col gap-6">
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

          {/* Right: add a connection */}
          <section className="flex flex-col gap-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Add a connection
            </h2>
            {step1Panel}
            {step2Panel}
          </section>
        </div>
      ) : (
        /* ── Single-column layout (first-time user) ── */
        <section className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-lg font-semibold">Connect your Actual server</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Point Actual Bench at your budget server to review, sync, and manage it. Choose{" "}
              <span className="font-medium text-foreground">HTTP API</span> for a hosted API server, or{" "}
              <span className="font-medium text-foreground">Direct</span> to talk to Actual itself. Your
              credentials stay in this browser unless you choose to save them.
            </p>
          </div>

          {step1Panel}
          {step2Panel}

          {budgets === null && !validateBusy && (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <span>New here?</span>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Documentation
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                GitHub
              </a>
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!pendingBudgetSwitch}
        onOpenChange={(open) => { if (!open) dismissBudgetSwitch(); }}
        state={pendingBudgetSwitch}
      />
    </div>
  );
}
