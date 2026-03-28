"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, CheckCircle2, Trash2, Server } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listBudgets, testConnection, type BudgetFile } from "@/lib/api/client";
import {
  useConnectionStore,
  selectActiveInstance,
  type ConnectionInstance,
} from "@/store/connection";
import { useStagedStore } from "@/store/staged";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function deriveLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ValidateStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

type ConnectStatus =
  | { kind: "idle" }
  | { kind: "busy"; instanceId?: string }
  | { kind: "error"; message: string }
  | { kind: "success" };

// ─── Saved connection card ─────────────────────────────────────────────────────

function SavedConnectionCard({
  instance,
  isActive,
  onConnect,
  onRemove,
  connectBusyId,
}: {
  instance: ConnectionInstance;
  isActive: boolean;
  onConnect: (instance: ConnectionInstance) => void;
  onRemove: (id: string) => void;
  connectBusyId: string | null;
}) {
  const busy = connectBusyId === instance.id;
  const anyBusy = connectBusyId !== null;

  return (
    <div
      className={`flex items-center gap-4 rounded-lg border px-5 py-4 ${
        isActive ? "border-primary bg-primary/5" : "border-border bg-background"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{instance.label}</span>
          {isActive && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              active
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground truncate">{instance.baseUrl}</div>
        <div className="mt-0.5 text-xs text-muted-foreground font-mono">
          API key: {"•".repeat(12)}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => onConnect(instance)}
          className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Connecting…
            </>
          ) : (
            "Connect"
          )}
        </button>
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => onRemove(instance.id)}
          title="Remove"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const addInstance = useConnectionStore((s) => s.addInstance);
  const removeInstance = useConnectionStore((s) => s.removeInstance);
  const setActiveInstance = useConnectionStore((s) => s.setActiveInstance);
  const activeInstance = useConnectionStore(selectActiveInstance);
  const instances = useConnectionStore((s) => s.instances);
  const discardAll = useStagedStore((s) => s.discardAll);

  // Left panel fields
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [validateStatus, setValidateStatus] = useState<ValidateStatus>({ kind: "idle" });

  // Right panel state
  const [budgets, setBudgets] = useState<BudgetFile[] | null>(null);
  const [validatedUrl, setValidatedUrl] = useState("");
  const [validatedKey, setValidatedKey] = useState("");

  // Right panel fields
  const [selectedCloudFileId, setSelectedCloudFileId] = useState<string | null>(null);
  const [encryptionPassword, setEncryptionPassword] = useState("");
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({ kind: "idle" });

  // Saved connection reconnect busy tracking
  const [reconnectBusyId, setReconnectBusyId] = useState<string | null>(null);

  const validateBusy = validateStatus.kind === "busy";
  const connectBusy = connectStatus.kind === "busy";
  const anyBusy = validateBusy || connectBusy || reconnectBusyId !== null;

  // Reset right panel when credentials change
  function handleCredentialChange() {
    if (budgets !== null) {
      setBudgets(null);
      setSelectedCloudFileId(null);
      setEncryptionPassword("");
      setConnectStatus({ kind: "idle" });
    }
  }

  // ── Reconnect saved instance ─────────────────────────────────────────────────

  async function reconnect(instance: ConnectionInstance) {
    setReconnectBusyId(instance.id);
    try {
      await testConnection(instance);
      discardAll();
      queryClient.clear();
      setActiveInstance(instance.id);
      toast.success("Connected! Redirecting…");
      await new Promise((r) => setTimeout(r, 600));
      router.push("/rules");
    } catch (err) {
      const s =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : -1;
      const raw =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
      const message =
        s === 401 || s === 403
          ? "Invalid API Key."
          : s === 404
          ? "Budget not found on the server."
          : s >= 500
          ? `Server error (HTTP ${s}).`
          : raw || "Connection failed.";
      toast.error(message);
    } finally {
      setReconnectBusyId(null);
    }
  }

  function handleReconnect(instance: ConnectionInstance) {
    reconnect(instance).catch(() => {
      setReconnectBusyId(null);
    });
  }

  function handleRemove(id: string) {
    removeInstance(id);
  }

  // ── Validate: fetch budget list ─────────────────────────────────────────────

  async function validate() {
    const url = normalizeUrl(baseUrl);
    const key = apiKey.trim();

    if (!url || !key) {
      setValidateStatus({ kind: "error", message: "Server URL and API Key are required." });
      return;
    }

    setValidateStatus({ kind: "busy" });
    setBudgets(null);
    setSelectedCloudFileId(null);
    setEncryptionPassword("");
    setConnectStatus({ kind: "idle" });

    try {
      const fetched = await listBudgets(url, key);

      if (fetched.length === 0) {
        setValidateStatus({ kind: "error", message: "No remote budgets found on this server." });
        return;
      }

      setValidatedUrl(url);
      setValidatedKey(key);
      setBudgets(fetched);
      setSelectedCloudFileId(fetched[0].cloudFileId);
      setValidateStatus({ kind: "idle" });
    } catch (err) {
      const s =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : -1;
      const raw =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
      const message =
        s === 0
          ? "Could not reach the server. Check the URL and that the server is running."
          : s === 401 || s === 403
          ? "Invalid API Key."
          : raw || "Failed to fetch budgets.";
      setValidateStatus({ kind: "error", message });
    }
  }

  function handleValidate() {
    validate().catch((err) => {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setValidateStatus({ kind: "error", message });
    });
  }

  // ── Connect to selected budget ──────────────────────────────────────────────

  async function connect() {
    if (!budgets || !selectedCloudFileId) return;

    const selected = budgets.find((b) => b.cloudFileId === selectedCloudFileId);
    if (!selected) return;

    const instance: ConnectionInstance = {
      id: crypto.randomUUID(),
      label: selected.name || deriveLabel(validatedUrl),
      baseUrl: validatedUrl,
      apiKey: validatedKey,
      budgetSyncId: selected.groupId!,
      ...(encryptionPassword.trim() ? { encryptionPassword: encryptionPassword.trim() } : {}),
    };

    setConnectStatus({ kind: "busy" });

    try {
      await testConnection(instance);
      discardAll();
      queryClient.clear();
      addInstance(instance);
      setActiveInstance(instance.id);
      setConnectStatus({ kind: "success" });
      toast.success("Connected! Redirecting…");
      await new Promise((r) => setTimeout(r, 800));
      router.push("/rules");
    } catch (err) {
      const s =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : -1;
      const raw =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
      const message =
        s === 401 || s === 403
          ? "Invalid API Key."
          : s === 404
          ? "Budget not found on the server."
          : s >= 500
          ? `Server error (HTTP ${s}). The actual-http-api server returned an unexpected error.`
          : raw || "Connection failed.";
      setConnectStatus({ kind: "error", message });
      toast.error(message);
    }
  }

  function handleConnect() {
    connect().catch((err) => {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setConnectStatus({ kind: "error", message });
      toast.error(message);
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-4xl flex flex-col gap-8">
      <div className="flex justify-center">
        <Image src="/logo.png" alt="Actual Bench" width={160} height={40} priority />
      </div>

      {/* Saved connections */}
      {instances.length > 0 && (
        <div>
          <h2 className="mb-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Saved connections
          </h2>
          <div className="flex flex-col gap-3">
            {instances.map((instance) => (
              <SavedConnectionCard
                key={instance.id}
                instance={instance}
                isActive={activeInstance?.id === instance.id}
                onConnect={handleReconnect}
                onRemove={handleRemove}
                connectBusyId={reconnectBusyId}
              />
            ))}
          </div>
        </div>
      )}

      {/* New connection form */}
      <div>
        {instances.length > 0 && (
          <h2 className="mb-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Add new connection
          </h2>
        )}
        <div className="flex rounded-xl border border-border bg-background shadow-sm overflow-hidden min-h-[500px]">
          {/* ── Left panel: credentials ── */}
          <div className="w-96 shrink-0 flex flex-col border-r border-border p-8">
            <h1 className="mb-2 text-xl font-semibold">Connect to Actual</h1>
            <p className="mb-7 text-sm text-muted-foreground leading-relaxed">
              Enter your{" "}
              <span className="font-medium text-foreground">actual-http-api</span>{" "}
              server details.
            </p>

            <div className="flex flex-col gap-5 flex-1">
              <div className="flex flex-col gap-2">
                <Label htmlFor="baseUrl">Server URL</Label>
                <Input
                  id="baseUrl"
                  type="text"
                  placeholder="https://budgetapi.example.com"
                  autoComplete="off"
                  spellCheck={false}
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    if (validateStatus.kind === "error") setValidateStatus({ kind: "idle" });
                    handleCredentialChange();
                  }}
                  disabled={anyBusy}
                />
              </div>

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
                  disabled={anyBusy}
                />
                <p className="text-xs text-muted-foreground">
                  The <code>ACTUAL_API_KEY</code> on your server.
                </p>
              </div>

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
                className="mt-auto flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validateBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Fetching budgets…
                  </>
                ) : (
                  "Validate"
                )}
              </button>
            </div>
          </div>

          {/* ── Right panel: budget selection ── */}
          <div className="flex-1 flex flex-col p-8">
            {budgets === null ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Server className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">No server connected</p>
                  <p className="text-sm text-muted-foreground">
                    Enter your server details and click{" "}
                    <span className="font-medium text-foreground">Validate</span> to load available
                    budgets.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <h2 className="mb-2 text-base font-semibold">Select a budget</h2>
                <p className="mb-5 text-sm text-muted-foreground">
                  Choose which budget to connect to.
                </p>

                {/* Budget cards */}
                <div className="flex flex-col gap-3 mb-6 overflow-y-auto max-h-[220px] pr-1">
                  {budgets.map((budget) => {
                    const selected = selectedCloudFileId === budget.cloudFileId;
                    return (
                      <button
                        key={budget.cloudFileId}
                        type="button"
                        disabled={connectBusy}
                        onClick={() => {
                          setSelectedCloudFileId(budget.cloudFileId);
                          if (connectStatus.kind === "error") setConnectStatus({ kind: "idle" });
                        }}
                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground/40 hover:bg-muted/40"
                        }`}
                      >
                        <span
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                            selected ? "border-primary" : "border-muted-foreground/40"
                          }`}
                        >
                          {selected && (
                            <span className="h-2 w-2 rounded-full bg-primary block" />
                          )}
                        </span>
                        <span className="flex flex-col gap-1 min-w-0">
                          <span className="text-sm font-medium leading-tight">
                            {budget.name || budget.cloudFileId}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono truncate">
                            {budget.cloudFileId}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Encryption password */}
                <div className="flex flex-col gap-2 mb-5">
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
                    disabled={connectBusy}
                  />
                </div>

                {connectStatus.kind === "error" && (
                  <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-sm text-destructive mb-5">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{connectStatus.message}</span>
                  </div>
                )}
                {connectStatus.kind === "success" && (
                  <div className="flex items-center gap-2.5 rounded-lg bg-green-50 px-3.5 py-3 text-sm text-green-700 mb-5">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Connected! Redirecting…</span>
                  </div>
                )}

                <button
                  type="button"
                  disabled={connectBusy || !selectedCloudFileId}
                  onClick={handleConnect}
                  className="mt-auto flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
