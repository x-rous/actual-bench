"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { testConnection } from "@/lib/api/client";
import {
  useConnectionStore,
  selectActiveInstance,
  type ConnectionInstance,
} from "@/store/connection";
import { useStagedStore } from "@/store/staged";

// ─── Types ────────────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  budgetSyncId: string;
  encryptionPassword: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "error"; message: string }
  | { kind: "success" };

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

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const addInstance = useConnectionStore((s) => s.addInstance);
  const setActiveInstance = useConnectionStore((s) => s.setActiveInstance);
  const activeInstance = useConnectionStore(selectActiveInstance);
  const discardAll = useStagedStore((s) => s.discardAll);

  const [form, setForm] = useState<FormState>({
    name: "",
    baseUrl: "",
    apiKey: "",
    budgetSyncId: "",
    encryptionPassword: "",
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const busy = status.kind === "testing";

  function update(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (status.kind === "error") setStatus({ kind: "idle" });
    };
  }

  async function connect() {
    const baseUrl = normalizeUrl(form.baseUrl);
    const apiKey = form.apiKey.trim();
    const budgetSyncId = form.budgetSyncId.trim();

    if (!baseUrl || !apiKey || !budgetSyncId) {
      setStatus({
        kind: "error",
        message: "Server URL, API Key and Budget Sync ID are required.",
      });
      return;
    }

    const instance: ConnectionInstance = {
      id: crypto.randomUUID(),
      label: form.name.trim() || deriveLabel(baseUrl),
      baseUrl,
      apiKey,
      budgetSyncId,
      ...(form.encryptionPassword.trim()
        ? { encryptionPassword: form.encryptionPassword.trim() }
        : {}),
    };

    setStatus({ kind: "testing" });

    try {
      await testConnection(instance);
      // Clear any staged data and query cache from the previous connection
      // before activating the new one so nothing bleeds across connections.
      discardAll();
      queryClient.clear();
      addInstance(instance);
      setActiveInstance(instance.id);
      setStatus({ kind: "success" });
      toast.success("Connected! Redirecting…");
      await new Promise((r) => setTimeout(r, 800));
      router.push("/rules");
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : -1;
      const raw =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
      const message =
        status === 0
          ? "Could not reach the server. Check that the Server URL is correct and the server is running."
          : status === 401 || status === 403
          ? "Invalid API Key. Check the ACTUAL_API_KEY set on your actual-http-api server."
          : status === 404
          ? "Budget not found. Check that the Budget Sync ID is correct."
          : status >= 500
          ? `Server error (HTTP ${status}). The actual-http-api server returned an unexpected error.`
          : raw || "Connection failed. Check the Server URL, API Key, and Budget Sync ID.";
      setStatus({ kind: "error", message });
      toast.error(message);
    }
  }

  function handleClick() {
    connect().catch((err) => {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setStatus({ kind: "error", message });
      toast.error(message);
    });
  }

  return (
    <div className="w-full max-w-md">
      {/* Already-connected hint */}
      {activeInstance && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Connected to{" "}
            <span className="font-medium text-foreground">
              {activeInstance.label}
            </span>
          </span>
          <button
            type="button"
            onClick={() => router.push("/rules")}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to app →
          </button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-background p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Connect to Actual</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Enter your{" "}
          <span className="font-medium text-foreground">actual-http-api</span>{" "}
          server details to get started.
        </p>

        <div className="flex flex-col gap-4">
          {/* Name (optional) */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">
              Name{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="My Budget Connection"
              autoComplete="off"
              value={form.name}
              onChange={update("name")}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              A display name for the connection (defaults to the URL hostname).
            </p>
          </div>

          {/* Server URL */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="baseUrl">Server URL</Label>
            <Input
              id="baseUrl"
              type="text"
              placeholder="https://budgetapi.example.com"
              autoComplete="off"
              spellCheck={false}
              value={form.baseUrl}
              onChange={update("baseUrl")}
              disabled={busy}
            />
          </div>

          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="••••••••••••••••"
              autoComplete="current-password"
              value={form.apiKey}
              onChange={update("apiKey")}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Set in your actual-http-api server config
            </p>
          </div>

          {/* Budget Sync ID */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="budgetSyncId">Budget Sync ID</Label>
            <Input
              id="budgetSyncId"
              type="text"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              value={form.budgetSyncId}
              onChange={update("budgetSyncId")}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              In Actual Budget: <strong>Settings</strong> → <strong>Show advanced settings</strong> → <strong>Sync ID</strong>. 
            </p>
          </div>

          {/* Encryption Password (optional) */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="encryptionPassword">
              Budget Encryption Password{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="encryptionPassword"
              type="password"
              placeholder="Leave blank if budget is not encrypted"
              autoComplete="off"
              value={form.encryptionPassword}
              onChange={update("encryptionPassword")}
              disabled={busy}
            />
          </div>

          {/* Inline status messages */}
          {status.kind === "error" && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{status.message}</span>
            </div>
          )}
          {status.kind === "success" && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Connected! Redirecting…</span>
            </div>
          )}

          {/* Submit — plain <button> to guarantee click fires regardless of UI library */}
          <button
            type="button"
            disabled={busy}
            onClick={handleClick}
            className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing connection…
              </>
            ) : (
              "Test & Connect"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
