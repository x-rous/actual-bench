import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  listBudgets,
  testConnection,
  getApiVersion,
  getServerVersion,
  type BudgetFile,
} from "@/lib/api/client";
import { ensureTransportReady, getTransport } from "@/lib/actual";
import {
  listBrowserApiBudgets,
  loadBrowserApiBudgetList,
} from "@/lib/actual/browser/labRuntime";
import {
  useConnectionStore,
  selectActiveInstance,
  isHttpApiConnection,
  isBrowserApiConnection,
  type ConnectionInstance,
  type ConnectionMode,
  type HttpApiConnection,
} from "@/store/connection";
import { useSavedServersStore, type SavedServer } from "@/store/savedServers";
import { useStagedStore } from "@/store/staged";
import {
  rememberServer,
  rememberBudgetEncryption,
  revealServerSecret,
} from "@/features/connect/vaultApi";
import type { ServerCredentialMeta } from "@/lib/app-db/types";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { removeSavedServerIfUnused } from "@/lib/savedServerCleanup";
import { generateId } from "@/lib/uuid";
import {
  normalizeUrl,
  deriveLabel,
  parseApiError,
  type ValidateStatus,
  type ConnectStatus,
} from "@/components/connect/utils";

function toBudgetFile(budget: Awaited<ReturnType<typeof listBrowserApiBudgets>>[number]): BudgetFile {
  const syncId = budget.groupId ?? budget.id ?? budget.cloudFileId ?? "";
  return {
    cloudFileId: budget.cloudFileId ?? syncId,
    name: (budget.name ?? syncId) || "Unnamed budget",
    state: budget.state,
    groupId: syncId,
    encryptKeyId: budget.encryptKeyId,
    hasKey: budget.hasKey,
    owner: budget.owner,
  };
}

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
  const removeServer = useSavedServersStore((s) => s.removeServer);
  const savedServers = useSavedServersStore((s) => s.servers);

  // Confirmation shown when reconnecting a budget that's already connected in a
  // different mode/URL (the reconnect replaces that entry). The ref lets the
  // confirm handler re-run connect() past the gate.
  const [pendingBudgetSwitch, setPendingBudgetSwitch] = useState<ConfirmState | null>(null);
  const confirmSwitchRef = useRef(false);

  // Server credentials
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("http-api");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [validateStatus, setValidateStatus] = useState<ValidateStatus>({ kind: "idle" });

  // Which saved server chip is selected (null = "New server" / manual entry)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  // Step 2 state
  const [budgets, setBudgets] = useState<BudgetFile[] | null>(null);
  const [validatedMode, setValidatedMode] = useState<ConnectionMode | null>(null);
  const [validatedUrl, setValidatedUrl] = useState("");
  const [validatedApiKey, setValidatedApiKey] = useState("");
  const [validatedServerPassword, setValidatedServerPassword] = useState("");
  const [validatedApiVersion, setValidatedApiVersion] = useState<string | null>(null);
  const [validatedServerVersion, setValidatedServerVersion] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [encryptionPassword, setEncryptionPassword] = useState("");
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({ kind: "idle" });

  // Reconnect busy tracking for connection cards
  const [reconnectBusyId, setReconnectBusyId] = useState<string | null>(null);

  // "Remember this connection on the server" (RD-061). Only enrolls when the
  // vault is unlocked — the UI gates the checkbox on that.
  const [rememberOnServer, setRememberOnServer] = useState(false);

  const validateBusy = validateStatus.kind === "busy";
  const connectBusy = connectStatus.kind === "busy";
  const anyBusy = validateBusy || connectBusy || reconnectBusyId !== null;
  const step1Complete = budgets !== null;

  const savedServersForMode = useMemo(
    () => savedServers.filter((server) => server.mode === connectionMode),
    [savedServers, connectionMode]
  );

  // Keep server URL and credential fields visible only until the budget
  // list is loaded. The Change button resets step 1 if the user needs edits.
  const showManualForm = !step1Complete;

  // Set of budgetSyncIds already connected for the validated server and mode.
  const connectedSyncIds = useMemo(
    () =>
      new Set(
        instances
          .filter(
            (instance) =>
              instance.mode === validatedMode && instance.baseUrl === validatedUrl
          )
          .map((instance) => instance.budgetSyncId)
      ),
    [instances, validatedMode, validatedUrl]
  );

  // ── State helpers ────────────────────────────────────────────────────────────

  function handleRemoveInstance(id: string) {
    const instance = useConnectionStore
      .getState()
      .instances.find((candidate) => candidate.id === id);
    if (instance) {
      removeSavedServerIfUnused({
        instance,
        instances: useConnectionStore.getState().instances,
        savedServers: useSavedServersStore.getState().servers,
        removeServer,
      });
    }
    removeInstance(id);
  }

  function resetStep2() {
    setBudgets(null);
    setSelectedGroupId(null);
    setEncryptionPassword("");
    setConnectStatus({ kind: "idle" });
    setValidatedMode(null);
    setValidatedUrl("");
    setValidatedApiKey("");
    setValidatedServerPassword("");
    setValidatedApiVersion(null);
    setValidatedServerVersion(null);
  }

  function handleCredentialChange() {
    resetStep2();
  }

  function handleModeChange(mode: ConnectionMode) {
    if (mode === connectionMode) return;
    setConnectionMode(mode);
    setBaseUrl("");
    setApiKey("");
    setServerPassword("");
    setValidateStatus({ kind: "idle" });
    setSelectedServerId(null);
    resetStep2();
  }

  // ── Saved server chip selection ──────────────────────────────────────────────

  function handleSelectServer(server: SavedServer | null) {
    resetStep2();
    setValidateStatus({ kind: "idle" });
    if (!server) {
      setSelectedServerId(null);
      setBaseUrl("");
      setApiKey("");
      setServerPassword("");
      return;
    }

    setConnectionMode(server.mode);
    setSelectedServerId(server.id);
    setBaseUrl(server.baseUrl);

    const reusableConnection = instances.find(
      (instance) => instance.mode === server.mode && instance.baseUrl === server.baseUrl
    );

    if (server.mode === "http-api") {
      const reusableApiKey = isHttpApiConnection(reusableConnection)
        ? reusableConnection.apiKey
        : "";
      setApiKey(reusableApiKey);
      setServerPassword("");
      if (reusableApiKey) {
        validate({
          mode: "http-api",
          baseUrl: server.baseUrl,
          apiKey: reusableApiKey,
        }).catch(console.error);
      }
      return;
    }

    const reusableServerPassword = isBrowserApiConnection(reusableConnection)
      ? reusableConnection.serverPassword
      : "";
    setApiKey("");
    setServerPassword(reusableServerPassword);
    if (reusableServerPassword) {
      validate({
        mode: "browser-api",
        baseUrl: server.baseUrl,
        serverPassword: reusableServerPassword,
      }).catch(console.error);
    }
  }

  // ── Reconnect saved instance ─────────────────────────────────────────────────
  // Does NOT handle errors — callers decide the UX (toast vs inline).

  async function reconnect(instance: ConnectionInstance) {
    if (isBrowserApiConnection(instance)) {
      setReconnectBusyId(instance.id);
      try {
        await ensureTransportReady(instance);
        const version = await getTransport(instance).getServerVersion().catch(() => null);
        if (version) updateInstance(instance.id, { serverVersion: version });
        discardAll();
        queryClient.clear();
        setActiveInstance(instance.id);
        toast.success("Direct connection opened. Redirecting…");
        await new Promise((r) => setTimeout(r, 600));
        router.push("/overview");
      } finally {
        setReconnectBusyId(null);
      }
      return;
    }

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
      router.push("/overview");
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

  // Reconnect a remembered (vault) connection: add it to the in-memory store,
  // then run the normal reconnect flow. The instance is rebuilt from the
  // revealed secret by the caller.
  function reconnectRemembered(instance: ConnectionInstance) {
    addInstance(instance);
    handleReconnect(instance);
  }

  // Best-effort enroll into the vault after a successful connect, when the user
  // ticked "Remember". Server-scoped (RD-063): the server credential opens any of
  // its budgets, and an encryption password (if any) is remembered per-budget.
  // Never blocks the connection — a failure just warns.
  async function maybeRemember(instance: ConnectionInstance) {
    if (!rememberOnServer) return;
    const secret = isBrowserApiConnection(instance)
      ? { serverPassword: instance.serverPassword }
      : { apiKey: (instance as HttpApiConnection).apiKey };
    try {
      await rememberServer({
        mode: instance.mode,
        baseUrl: instance.baseUrl,
        label: deriveLabel(instance.baseUrl),
        secret,
      });
      if (instance.encryptionPassword) {
        await rememberBudgetEncryption({
          serverFingerprint: serverFingerprint(instance),
          budgetSyncId: instance.budgetSyncId,
          label: instance.label,
          encryptionPassword: instance.encryptionPassword,
        });
      }
    } catch (err) {
      toast.error(`Connected, but couldn't remember this server: ${parseApiError(err)}`);
    }
  }

  // Start a connection from a remembered server (RD-063): reveal its secret,
  // prime the form, and load its budget list so the user can pick any budget.
  // Errors propagate to the caller (RememberedServers shows them inline).
  async function startFromRememberedServer(server: ServerCredentialMeta) {
    const revealed = await revealServerSecret(server.serverFingerprint);
    setConnectionMode(revealed.mode);
    setSelectedServerId(null);
    setBaseUrl(revealed.baseUrl);
    if (revealed.mode === "http-api") {
      setApiKey(revealed.secret.apiKey ?? "");
      setServerPassword("");
    } else {
      setServerPassword(revealed.secret.serverPassword ?? "");
      setApiKey("");
    }
    await validate({
      mode: revealed.mode,
      baseUrl: revealed.baseUrl,
      apiKey: revealed.secret.apiKey ?? undefined,
      serverPassword: revealed.secret.serverPassword ?? undefined,
    });
  }

  // The last encryption password we auto-filled from the vault. Lets us tell a
  // remembered password apart from one the user typed, so budget switches
  // refresh the former but never clobber the latter.
  const autoFilledEncRef = useRef("");

  // Reveal a budget's remembered encryption password for a server (mode + URL),
  // or "" when the vault is locked, the server isn't remembered, or the budget
  // has no stored password. Never throws.
  async function revealBudgetEncryption(mode: ConnectionMode, url: string, budgetSyncId: string): Promise<string> {
    try {
      const fp = serverFingerprint({ mode, baseUrl: url });
      const revealed = await revealServerSecret(fp, budgetSyncId);
      return revealed.secret.encryptionPassword ?? "";
    } catch {
      return "";
    }
  }

  // When a budget is picked, pre-fill its remembered encryption password so an
  // encrypted budget opens without a second prompt — but never clobber a
  // password the user typed themselves.
  async function prefillEncryptionPassword(budgetSyncId: string) {
    if (!validatedMode || !validatedUrl) return;
    if (encryptionPassword && encryptionPassword !== autoFilledEncRef.current) return;
    const pw = await revealBudgetEncryption(validatedMode, validatedUrl, budgetSyncId);
    autoFilledEncRef.current = pw;
    setEncryptionPassword(pw);
  }

  function handleSelectBudget(budgetSyncId: string) {
    setSelectedGroupId(budgetSyncId);
    if (connectStatus.kind === "error") setConnectStatus({ kind: "idle" });
    void prefillEncryptionPassword(budgetSyncId);
  }

  // ── Validate: fetch budget list ─────────────────────────────────────────────

  async function validate(overrides: {
    mode?: ConnectionMode;
    baseUrl?: string;
    apiKey?: string;
    serverPassword?: string;
  } = {}) {
    const mode = overrides.mode ?? connectionMode;
    const url = normalizeUrl(overrides.baseUrl ?? baseUrl);
    const key = (overrides.apiKey ?? apiKey).trim();
    const password = overrides.serverPassword ?? serverPassword;

    if (!url) {
      setValidateStatus({ kind: "error", message: "Server URL is required." });
      return;
    }

    if (mode === "http-api" && !key) {
      setValidateStatus({ kind: "error", message: "API Key is required." });
      return;
    }

    if (mode === "browser-api" && !password) {
      setValidateStatus({ kind: "error", message: "Actual Server password is required." });
      return;
    }

    setValidateStatus({ kind: "busy" });
    setBudgets(null);
    setSelectedGroupId(null);
    setEncryptionPassword("");
    setConnectStatus({ kind: "idle" });

    try {
      let fetched: BudgetFile[];
      let apiVersion: string | null = null;
      let serverVersion: string | null = null;

      if (mode === "http-api") {
        const [budgetsResult, apiVersionResult] = await Promise.allSettled([
          listBudgets(url, key),
          getApiVersion(url, key),
        ]);

        if (budgetsResult.status === "rejected") throw budgetsResult.reason;

        fetched = budgetsResult.value;
        apiVersion =
          apiVersionResult.status === "fulfilled" ? apiVersionResult.value : null;

        addServer({ mode: "http-api", label: deriveLabel(url), baseUrl: url });
      } else {
        const result = await loadBrowserApiBudgetList({
          serverUrl: url,
          serverPassword: password,
        });
        fetched = result.budgets.map(toBudgetFile);
        serverVersion = result.serverVersion;

        addServer({
          mode: "browser-api",
          label: deriveLabel(url),
          baseUrl: url,
        });
      }

      if (fetched.length === 0) {
        setValidateStatus({ kind: "error", message: "No budgets found on this server." });
        return;
      }

      setValidatedMode(mode);
      setValidatedUrl(url);
      setValidatedApiKey(mode === "http-api" ? key : "");
      setValidatedServerPassword(mode === "browser-api" ? password : "");
      setValidatedApiVersion(apiVersion);
      setValidatedServerVersion(serverVersion);
      setBudgets(fetched);
      setSelectedGroupId(fetched[0].groupId!);
      setValidateStatus({ kind: "idle" });

      // Pre-fill the initially-selected budget's remembered encryption password
      // (if any) so opening it needs no second prompt. Uses local mode/url since
      // the validated* state was just set this tick.
      const firstPw = await revealBudgetEncryption(mode, url, fetched[0].groupId!);
      autoFilledEncRef.current = firstPw;
      setEncryptionPassword(firstPw);

      // Persist the server, then select its chip so the manual form collapses.
      const persisted = useSavedServersStore
        .getState()
        .servers.find((server) => server.mode === mode && server.baseUrl === url);
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
    if (!budgets || !selectedGroupId || !validatedMode) return;

    const selected = budgets.find((b) => b.groupId === selectedGroupId);
    if (!selected) return;

    // If this budget is already connected via a different transport/URL,
    // reconnecting will replace that entry (one connection per budget). Confirm
    // the switch first - unless the user already confirmed it.
    const replacedExisting = instances.find(
      (i) => i.budgetSyncId === selected.groupId && !(i.mode === validatedMode && i.baseUrl === validatedUrl)
    );
    if (replacedExisting && !confirmSwitchRef.current) {
      const modeLabel = (m: ConnectionMode) => (m === "browser-api" ? "Direct" : "HTTP API");
      setPendingBudgetSwitch({
        title: "Switch this budget's connection?",
        message: `"${replacedExisting.label}" is already connected in ${modeLabel(replacedExisting.mode)} mode. Continuing switches it to ${modeLabel(validatedMode)} mode and discards any unsaved changes.`,
        destructiveLabel: "Switch mode",
        onConfirm: () => {
          confirmSwitchRef.current = true;
          setPendingBudgetSwitch(null);
          connect().catch(console.error);
        },
      });
      return;
    }
    confirmSwitchRef.current = false;

    if (validatedMode === "browser-api") {
      const existing = instances
        .filter(isBrowserApiConnection)
        .find(
          (instance) =>
            instance.baseUrl === validatedUrl && instance.budgetSyncId === selected.groupId
        );
      const directConnection: ConnectionInstance = {
        id: existing?.id ?? generateId(),
        mode: "browser-api",
        label: selected.name || deriveLabel(validatedUrl),
        baseUrl: validatedUrl,
        serverPassword: validatedServerPassword,
        budgetSyncId: selected.groupId!,
        ...(validatedServerVersion ? { serverVersion: validatedServerVersion } : {}),
        ...(encryptionPassword.trim() ? { encryptionPassword: encryptionPassword.trim() } : {}),
      };

      setConnectStatus({ kind: "busy" });
      try {
        await ensureTransportReady(directConnection);
        if (existing) {
          updateInstance(existing.id, directConnection);
        } else {
          addInstance(directConnection);
        }
        discardAll();
        queryClient.clear();
        setActiveInstance(directConnection.id);
        await maybeRemember(directConnection);
        setConnectStatus({ kind: "success" });
        toast.success("Direct connection opened. Redirecting…");
        await new Promise((r) => setTimeout(r, 800));
        router.push("/overview");
      } catch (err) {
        setConnectStatus({ kind: "error", message: parseApiError(err) });
      }
      return;
    }

    // If this HTTP API budget is already saved, reconnect to the existing instance
    // instead of creating a duplicate.
    const existing = instances
      .filter(isHttpApiConnection)
      .find(
        (instance) =>
          instance.baseUrl === validatedUrl && instance.budgetSyncId === selected.groupId
      );
    if (existing) {
      // Use fresh credentials from the current validation in case the key was rotated.
      const freshInstance: ConnectionInstance = {
        ...existing,
        apiKey: validatedApiKey,
        // Explicitly set to undefined when blank so clearing the field removes
        // a stored encryption password rather than silently preserving it.
        encryptionPassword: encryptionPassword.trim() || undefined,
      };
      setConnectStatus({ kind: "busy" });
      try {
        await maybeRemember(freshInstance);
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
      mode: "http-api",
      label: selected.name || deriveLabel(validatedUrl),
      baseUrl: validatedUrl,
      apiKey: validatedApiKey,
      budgetSyncId: selected.groupId!,
      ...(encryptionPassword.trim() ? { encryptionPassword: encryptionPassword.trim() } : {}),
    };

    setConnectStatus({ kind: "busy" });
    try {
      await testConnection(instance);
      const [apiVersionResult, serverVersionResult] = await Promise.allSettled([
        getApiVersion(validatedUrl, validatedApiKey),
        getServerVersion(validatedUrl, validatedApiKey, selected.groupId!),
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
      await maybeRemember(finalInstance);
      setConnectStatus({ kind: "success" });
      toast.success("Connected! Redirecting…");
      await new Promise((r) => setTimeout(r, 800));
      router.push("/overview");
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
    savedServersForMode,
    removeInstance: handleRemoveInstance,
    // Credentials
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
    // Step 2
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
    // Remembered connections (RD-061)
    rememberOnServer,
    setRememberOnServer,
    reconnectRemembered,
    // Remembered servers (RD-063)
    startFromRememberedServer,
    handleSelectBudget,
    // Cross-mode reconnect confirmation
    pendingBudgetSwitch,
    dismissBudgetSwitch: () => setPendingBudgetSwitch(null),
  };
}
