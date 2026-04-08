import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  listBudgets,
  testConnection,
  getApiVersion,
  getServerVersion,
  type BudgetFile,
} from "@/lib/api/client";
import {
  useConnectionStore,
  selectActiveInstance,
  type ConnectionInstance,
} from "@/store/connection";
import { useSavedServersStore } from "@/store/savedServers";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import {
  normalizeUrl,
  deriveLabel,
  parseApiError,
  type ValidateStatus,
  type ConnectStatus,
} from "@/components/connect/utils";

export function useConnectForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const addInstance = useConnectionStore((s) => s.addInstance);
  const removeInstance = useConnectionStore((s) => s.removeInstance);
  const updateInstance = useConnectionStore((s) => s.updateInstance);
  const setActiveInstance = useConnectionStore((s) => s.setActiveInstance);
  const activeInstance = useConnectionStore(selectActiveInstance);
  const instances = useConnectionStore((s) => s.instances);
  const discardAll = useStagedStore((s) => s.discardAll);
  const addServer = useSavedServersStore((s) => s.addServer);
  const savedServers = useSavedServersStore((s) => s.servers);

  // Server credentials
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [validateStatus, setValidateStatus] = useState<ValidateStatus>({ kind: "idle" });

  // Which saved server chip is selected (null = "New server" / manual entry)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  // Step 2 state
  const [budgets, setBudgets] = useState<BudgetFile[] | null>(null);
  const [validatedUrl, setValidatedUrl] = useState("");
  const [validatedKey, setValidatedKey] = useState("");
  const [validatedApiVersion, setValidatedApiVersion] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [encryptionPassword, setEncryptionPassword] = useState("");
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({ kind: "idle" });

  // Reconnect busy tracking for connection cards
  const [reconnectBusyId, setReconnectBusyId] = useState<string | null>(null);

  const validateBusy = validateStatus.kind === "busy";
  const connectBusy = connectStatus.kind === "busy";
  const anyBusy = validateBusy || connectBusy || reconnectBusyId !== null;
  const step1Complete = budgets !== null;

  // Show the manual URL+key form when there are no saved servers, or when
  // the "New server" chip is explicitly selected (selectedServerId === null).
  const showManualForm = savedServers.length === 0 || selectedServerId === null;

  // Set of budgetSyncIds already connected for the validated server
  const connectedSyncIds = useMemo(
    () => new Set(instances.filter((i) => i.baseUrl === validatedUrl).map((i) => i.budgetSyncId)),
    [instances, validatedUrl]
  );

  // ── State helpers ────────────────────────────────────────────────────────────

  function resetStep2() {
    setBudgets(null);
    setSelectedGroupId(null);
    setEncryptionPassword("");
    setConnectStatus({ kind: "idle" });
    setValidatedUrl("");
    setValidatedKey("");
    setValidatedApiVersion(null);
  }

  function handleCredentialChange() {
    resetStep2();
    setSelectedServerId(null);
  }

  // ── Saved server chip selection ──────────────────────────────────────────────

  function handleSelectServer(server: { id: string; baseUrl: string; apiKey: string } | null) {
    resetStep2();
    setValidateStatus({ kind: "idle" });
    if (!server) {
      setSelectedServerId(null);
      setBaseUrl("");
      setApiKey("");
      return;
    }
    setSelectedServerId(server.id);
    setBaseUrl(server.baseUrl);
    setApiKey(server.apiKey);
    // validate() handles its own errors internally; no outer catch needed.
    validate(server.baseUrl, server.apiKey).catch(console.error);
  }

  // ── Reconnect saved instance ─────────────────────────────────────────────────
  // Does NOT handle errors — callers decide the UX (toast vs inline).

  async function reconnect(instance: ConnectionInstance) {
    setReconnectBusyId(instance.id);
    try {
      await testConnection(instance);
      const [apiVersionResult, serverVersionResult] = await Promise.allSettled([
        getApiVersion(instance.baseUrl, instance.apiKey),
        getServerVersion(instance.baseUrl, instance.apiKey, instance.budgetSyncId),
      ]);
      updateInstance(instance.id, {
        apiKey: instance.apiKey,
        encryptionPassword: instance.encryptionPassword,
        apiVersion:
          apiVersionResult.status === "fulfilled"
            ? apiVersionResult.value
            : instance.apiVersion,
        serverVersion:
          serverVersionResult.status === "fulfilled"
            ? serverVersionResult.value
            : instance.serverVersion,
      });
      discardAll();
      queryClient.clear();
      setActiveInstance(instance.id);
      toast.success("Connected! Redirecting…");
      await new Promise((r) => setTimeout(r, 600));
      router.push("/rules");
    } finally {
      setReconnectBusyId(null);
    }
    // Errors propagate to the caller — no catch here.
  }

  // Called from ConnectionCard — shows a toast on failure.
  function handleReconnect(instance: ConnectionInstance) {
    reconnect(instance).catch((err) => {
      toast.error(parseApiError(err));
    });
  }

  // ── Validate: fetch budget list ─────────────────────────────────────────────

  async function validate(overrideUrl?: string, overrideKey?: string) {
    const url = normalizeUrl(overrideUrl ?? baseUrl);
    const key = (overrideKey ?? apiKey).trim();

    if (!url || !key) {
      setValidateStatus({ kind: "error", message: "Server URL and API Key are required." });
      return;
    }

    setValidateStatus({ kind: "busy" });
    setBudgets(null);
    setSelectedGroupId(null);
    setEncryptionPassword("");
    setConnectStatus({ kind: "idle" });

    try {
      const [budgetsResult, apiVersionResult] = await Promise.allSettled([
        listBudgets(url, key),
        getApiVersion(url, key),
      ]);

      if (budgetsResult.status === "rejected") throw budgetsResult.reason;

      const fetched = budgetsResult.value;
      const apiVersion =
        apiVersionResult.status === "fulfilled" ? apiVersionResult.value : null;

      if (fetched.length === 0) {
        setValidateStatus({ kind: "error", message: "No budgets found on this server." });
        return;
      }

      setValidatedUrl(url);
      setValidatedKey(key);
      setValidatedApiVersion(apiVersion);
      setBudgets(fetched);
      setSelectedGroupId(fetched[0].groupId!);
      setValidateStatus({ kind: "idle" });

      // Persist the server, then select its chip so the manual form collapses.
      addServer({ label: deriveLabel(url), baseUrl: url, apiKey: key });
      const persisted = useSavedServersStore.getState().servers.find((s) => s.baseUrl === url);
      if (persisted) setSelectedServerId(persisted.id);
    } catch (err) {
      setValidateStatus({ kind: "error", message: parseApiError(err) });
    }
  }

  // validate() owns its error state — outer catch is a safety net only.
  function handleValidate() {
    validate().catch(console.error);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !anyBusy) handleValidate();
  }

  // ── Connect to selected budget ──────────────────────────────────────────────

  async function connect() {
    if (!budgets || !selectedGroupId) return;

    const selected = budgets.find((b) => b.groupId === selectedGroupId);
    if (!selected) return;

    // If this budget is already saved, reconnect to the existing instance
    // instead of creating a duplicate.
    const existing = instances.find(
      (i) => i.baseUrl === validatedUrl && i.budgetSyncId === selected.groupId
    );
    if (existing) {
      // Use fresh credentials from the current validation in case the key was rotated.
      const freshInstance: ConnectionInstance = {
        ...existing,
        apiKey: validatedKey,
        // Explicitly set to undefined when blank so clearing the field removes
        // a stored encryption password rather than silently preserving it.
        encryptionPassword: encryptionPassword.trim() || undefined,
      };
      setConnectStatus({ kind: "busy" });
      try {
        await reconnect(freshInstance);
        setConnectStatus({ kind: "idle" });
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status: number }).status
            : -1;
        if (status === 401 || status === 403) {
          setApiKey("");
          setSelectedServerId(null);
          resetStep2();
          setValidateStatus({ kind: "error", message: parseApiError(err) });
          return;
        }
        setConnectStatus({ kind: "error", message: parseApiError(err) });
      }
      return;
    }

    const instance: ConnectionInstance = {
      id: generateId(),
      label: selected.name || deriveLabel(validatedUrl),
      baseUrl: validatedUrl,
      apiKey: validatedKey,
      budgetSyncId: selected.groupId!,
      ...(encryptionPassword.trim() ? { encryptionPassword: encryptionPassword.trim() } : {}),
    };

    setConnectStatus({ kind: "busy" });
    try {
      await testConnection(instance);
      const [apiVersionResult, serverVersionResult] = await Promise.allSettled([
        getApiVersion(validatedUrl, validatedKey),
        getServerVersion(validatedUrl, validatedKey, selected.groupId!),
      ]);
      const finalInstance: ConnectionInstance = {
        ...instance,
        apiVersion:
          apiVersionResult.status === "fulfilled"
            ? apiVersionResult.value
            : validatedApiVersion ?? undefined,
        serverVersion:
          serverVersionResult.status === "fulfilled"
            ? serverVersionResult.value
            : undefined,
      };
      discardAll();
      queryClient.clear();
      addInstance(finalInstance);
      setActiveInstance(finalInstance.id);
      setConnectStatus({ kind: "success" });
      toast.success("Connected! Redirecting…");
      await new Promise((r) => setTimeout(r, 800));
      router.push("/rules");
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : -1;
      if (status === 401 || status === 403) {
        // Invalid API key — reset to step 1 so the user can correct their credentials.
        setApiKey("");
        setSelectedServerId(null);
        resetStep2();
        setValidateStatus({ kind: "error", message: parseApiError(err) });
        return;
      }
      setConnectStatus({ kind: "error", message: parseApiError(err) });
    }
  }

  // connect() owns its error state — outer catch is a safety net only.
  function handleConnect() {
    connect().catch(console.error);
  }

  return {
    // Store state
    instances,
    activeInstance,
    savedServers,
    removeInstance,
    // Credentials
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    validateStatus,
    setValidateStatus,
    selectedServerId,
    // Step 2
    budgets,
    validatedUrl,
    validatedApiVersion,
    selectedGroupId,
    setSelectedGroupId,
    encryptionPassword,
    setEncryptionPassword,
    connectStatus,
    setConnectStatus,
    reconnectBusyId,
    // Derived
    validateBusy,
    connectBusy,
    anyBusy,
    step1Complete,
    showManualForm,
    connectedSyncIds,
    // Handlers
    resetStep2,
    setSelectedServerId,
    handleCredentialChange,
    handleSelectServer,
    handleReconnect,
    handleValidate,
    handleKeyDown,
    handleConnect,
  };
}
