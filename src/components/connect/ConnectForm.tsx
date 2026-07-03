"use client";

import Image from "next/image";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, Server, Plus, Check, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useIsHydrated } from "@/hooks/useIsHydrated";
import { useConnectForm } from "./useConnectForm";
import { ConnectionCard } from "./ConnectionCard";
import { deriveLabel, getConnectionModeBadge } from "./utils";

export function ConnectForm() {
  const router = useRouter();
  const hydrated = useIsHydrated();
  const connectedInstance = useConnectionStore(selectActiveInstance);

  const {
    instances,
    activeInstance,
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
  } = useConnectForm();

  useEffect(() => {
    if (hydrated && connectedInstance) {
      router.replace("/overview");
    }
  }, [hydrated, connectedInstance, router]);

  if (hydrated && connectedInstance) {
    return null;
  }

  const activeValidatedMode = validatedMode ?? connectionMode;

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
          Classic API Server
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={connectionMode === "browser-api"}
          disabled={anyBusy}
          onClick={() => handleModeChange("browser-api")}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            connectionMode === "browser-api"
              ? "border-primary bg-primary/5 text-primary"
              : "border-border hover:bg-muted"
          )}
        >
          <KeyRound className="h-4 w-4" />
          <span>Direct Actual Server</span>
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Experimental
          </span>
        </button>
      </div>

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
              {connectionMode === "browser-api" ? "Actual Server URL" : "API Server URL"}
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
                The <code>ACTUAL_API_KEY</code> on your API server.
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
                Stored in session storage for this browser tab.
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
          {validatedApiVersion && <span className="text-green-600/70">· v{validatedApiVersion}</span>}
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
                setSelectedGroupId(budget.groupId ?? null);
                if (connectStatus.kind === "error") setConnectStatus({ kind: "idle" });
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
          <span>Direct connection saved. Classic connections still power app pages.</span>
        </div>
      )}

      <button
        type="button"
        disabled={connectBusy || !!reconnectBusyId || !selectedGroupId}
        onClick={handleConnect}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {connectBusy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {activeValidatedMode === "browser-api" ? "Saving…" : "Connecting…"}
          </>
        ) : activeValidatedMode === "browser-api" ? (
          "Save Direct Connection"
        ) : (
          "Connect"
        )}
      </button>
    </div>
  ) : null;

  // ── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div className={cn("w-full flex flex-col gap-8", instances.length > 0 ? "max-w-5xl" : "max-w-xl")}>
      <div className="flex justify-center">
        <Image src="/logo.png" alt="Actual Bench" width={160} height={40} priority />
      </div>

      {instances.length > 0 ? (
        /* ── Two-column layout ── */
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6 items-start">
          {/* Left: saved connections */}
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Your connections
            </h2>
            <div className="flex flex-col gap-2 overflow-y-auto max-h-96">
              {instances.map((instance) => (
                <ConnectionCard
                  key={instance.id}
                  instance={instance}
                  isActive={activeInstance?.id === instance.id}
                  onConnect={handleReconnect}
                  onRemove={removeInstance}
                  connectBusyId={reconnectBusyId}
                />
              ))}
            </div>
          </section>

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
        <section className="flex flex-col gap-4">
          {step1Panel}
          {step2Panel}
          {budgets === null && !validateBusy && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Server className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Enter your server details above and click{" "}
                <span className="font-medium text-foreground">Load Budgets</span> to get started.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
