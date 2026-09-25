import { useState, useMemo, useRef } from "react";
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
} from "@/lib/actual/browser/budgetList";
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
  rememberBudget,
  rememberBudgetEncryption,
  revealServerSecret,
} from "@/features/connect/vaultApi";
import { connectSavedBudget } from "@/features/connect/savedBudgets";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { removeSavedServerIfUnused } from "@/lib/savedServerCleanup";
import { generateId } from "@/lib/uuid";
import {
  normalizeUrl,
  deriveLabel,
  getConnectionModeBadge,
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

/** A budget already reachable via a saved (vault) connection, for switch detection. */
export type SavedBudgetRef = {
  budgetSyncId: string;
  mode: ConnectionMode;
  baseUrl: string;
  label: string;
};

/**
 * How the Connect page holds a server's password or API key once it has one:
 * saved in the vault, taken from a connection open this session, or typed and
 * already used to load the budget list. The secret itself is never put back
 * into a form field - a field's value can be read with the browser's
 * inspector - so the form shows only which of these it is.
 */
export type HeldCredential = { source: "saved" | "session" | "entered"; mode: ConnectionMode; baseUrl: string };

/** A server the form offers as a chip: a remembered address, and whether the vault holds its secret. */
export type ServerChoice = SavedServer & { remembered?: ServerCredentialMeta };

type ServerSecret = { apiKey?: string; serverPassword?: string };

export function useConnectForm({
  savedBudgets = [],
  rememberedServers = [],
  vaultLocked = false,
  rememberByDefault = false,
}: {
  savedBudgets?: SavedBudgetRef[];
  /** Servers whose password or key is saved in the vault. */
  rememberedServers?: ServerCredentialMeta[];
  /**
   * A vault passphrase is set and this session is locked. Saved connections
   * then cannot be used to connect - only a new server, typed in.
   */
  vaultLocked?: boolean;
  /**
   * Saving would work right away (the vault is unlocked, as it always is once
   * signed in), so "Remember this budget" starts ticked until the user says
   * otherwise.
   */
  rememberByDefault?: boolean;
} = {}) {
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
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("browser-api");
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
  const [validatedApiVersion, setValidatedApiVersion] = useState<string | null>(null);
  const [validatedServerVersion, setValidatedServerVersion] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [encryptionPassword, setEncryptionPassword] = useState("");

  // The server's secret, held in memory and never rendered (see HeldCredential).
  // The ref holds the value; the state says only where it came from.
  const heldSecretRef = useRef<ServerSecret | null>(null);
  const [heldCredential, setHeldCredential] = useState<HeldCredential | null>(null);
  // A budget's saved encryption password, held the same way: the field stays
  // empty and the form says one will be used.
  const heldEncryptionRef = useRef("");
  const [encryptionSaved, setEncryptionSaved] = useState(false);
  // Bumped whenever the held secret is let go of (Lock, a new server, "Use a
  // different password"): a budget list or reveal still on its way from before
  // then must not bring the secret back.
  const credentialGenerationRef = useRef(0);
  // The same for a budget's encryption password: only the latest reveal counts,
  // so a late answer for one budget never lands on another.
  const encryptionRequestRef = useRef(0);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({ kind: "idle" });

  // Reconnect busy tracking for connection cards
  const [reconnectBusyId, setReconnectBusyId] = useState<string | null>(null);

  // "Remember this connection on the server" (RD-061). Only enrolls when the
  // vault is unlocked — the UI gates the checkbox on that. Until the user
  // touches it, it follows `rememberByDefault`, which is only known once the
  // vault's status has loaded.
  const [rememberChoice, setRememberOnServer] = useState<boolean | null>(null);
  const rememberOnServer = rememberChoice ?? rememberByDefault;

  const validateBusy = validateStatus.kind === "busy";
  const connectBusy = connectStatus.kind === "busy";
  const anyBusy = validateBusy || connectBusy || reconnectBusyId !== null;
  const step1Complete = budgets !== null;

  // One list of servers for this mode: the addresses remembered in this
  // browser and the servers saved in the vault, each once, marked when the
  // vault holds its secret.
  const savedServersForMode = useMemo((): ServerChoice[] => {
    const byServer = new Map<string, ServerChoice>();
    for (const server of savedServers.filter((entry) => entry.mode === connectionMode)) {
      byServer.set(serverFingerprint(server), server);
    }
    for (const remembered of rememberedServers.filter((entry) => entry.mode === connectionMode)) {
      const fp = serverFingerprint(remembered);
      const known = byServer.get(fp);
      byServer.set(
        fp,
        known
          ? { ...known, remembered }
          : {
              id: `vault:${remembered.serverFingerprint}`,
              mode: remembered.mode,
              label: remembered.label || deriveLabel(remembered.baseUrl),
              baseUrl: remembered.baseUrl,
              remembered,
            } as ServerChoice
      );
    }
    return [...byServer.values()];
  }, [savedServers, rememberedServers, connectionMode]);

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
    setValidatedApiVersion(null);
    setValidatedServerVersion(null);
    encryptionRequestRef.current += 1;
    heldEncryptionRef.current = "";
    setEncryptionSaved(false);
  }

  function holdCredential(held: HeldCredential, secret: ServerSecret) {
    heldSecretRef.current = secret;
    setHeldCredential(held);
    // What was typed has been taken; the fields go back to empty.
    setApiKey("");
    setServerPassword("");
  }

  /** Forget the held secret: "Use a different password", a new URL or mode, Cancel. */
  function dropCredential() {
    credentialGenerationRef.current += 1;
    heldSecretRef.current = null;
    setHeldCredential(null);
  }

  /** The held secret, for a server call. Never for display. */
  function heldSecret(): ServerSecret {
    return heldSecretRef.current ?? {};
  }

  function handleCredentialChange() {
    dropCredential();
    resetStep2();
  }

  /**
   * The vault was locked: nothing saved may be used to connect now, so the
   * form lets go of any password or key it holds and starts again, empty.
   */
  function forgetOnLock() {
    dropCredential();
    resetStep2();
    setSelectedServerId(null);
    setBaseUrl("");
    setApiKey("");
    setServerPassword("");
    setValidateStatus({ kind: "idle" });
  }

  /** "Use a different password": back to an empty field for this server. */
  function chooseDifferentCredential() {
    dropCredential();
    resetStep2();
  }

  /** "Use a different one" for a budget's saved encryption password. */
  function chooseDifferentEncryptionPassword() {
    encryptionRequestRef.current += 1;
    heldEncryptionRef.current = "";
    setEncryptionSaved(false);
  }

  function handleModeChange(mode: ConnectionMode) {
    if (mode === connectionMode) return;
    setConnectionMode(mode);
    setBaseUrl("");
    setApiKey("");
    setServerPassword("");
    setValidateStatus({ kind: "idle" });
    setSelectedServerId(null);
    dropCredential();
    resetStep2();
  }

  // ── Saved server chip selection ──────────────────────────────────────────────

  // A chip fills in the address. Its secret is used without being shown: the
  // one from a connection open this session, or the one saved in the vault.
  // Otherwise the password or key is typed as usual. While the vault is
  // locked the chips are saved connections that cannot be used - the page
  // disables them - so a chip never connects then, whatever it holds.
  function handleSelectServer(server: ServerChoice | null) {
    if (server && vaultLocked) return;
    resetStep2();
    dropCredential();
    setValidateStatus({ kind: "idle" });
    setApiKey("");
    setServerPassword("");
    if (!server) {
      setSelectedServerId(null);
      setBaseUrl("");
      return;
    }

    setConnectionMode(server.mode);
    setSelectedServerId(server.id);
    setBaseUrl(server.baseUrl);

    const open = instances.find((instance) => serverFingerprint(instance) === serverFingerprint(server));
    const openSecret: ServerSecret | null = isHttpApiConnection(open)
      ? { apiKey: open.apiKey }
      : isBrowserApiConnection(open)
        ? { serverPassword: open.serverPassword }
        : null;
    if (openSecret) {
      validate({ mode: server.mode, baseUrl: server.baseUrl, ...openSecret, source: "session" }).catch(console.error);
      return;
    }

    if (server.remembered) {
      const remembered = server.remembered;
      const generation = credentialGenerationRef.current;
      void (async () => {
        try {
          const revealed = await revealServerSecret(remembered.serverFingerprint);
          // Locked, or another server chosen, while it was revealed.
          if (generation !== credentialGenerationRef.current) return;
          await validate({
            generation,
            mode: revealed.mode,
            baseUrl: revealed.baseUrl,
            apiKey: revealed.secret.apiKey ?? undefined,
            serverPassword: revealed.secret.serverPassword ?? undefined,
            source: "saved",
          });
        } catch (err) {
          if (generation !== credentialGenerationRef.current) return;
          setValidateStatus({ kind: "error", message: parseApiError(err) });
        }
      })();
    }
  }

  // The server versions shown in the toolbar, read once a connection is known
  // to work. Best effort: a version that cannot be read is left out.
  async function readVersions(instance: ConnectionInstance): Promise<ConnectionInstance> {
    if (isBrowserApiConnection(instance)) {
      const version = await getTransport(instance).getServerVersion().catch(() => null);
      return version ? { ...instance, serverVersion: version } : instance;
    }
    const [apiVersion, serverVersion] = await Promise.allSettled([
      getApiVersion(instance.baseUrl, instance.apiKey),
      getServerVersion(instance.baseUrl, instance.apiKey, instance.budgetSyncId),
    ]);
    return {
      ...instance,
      ...(apiVersion.status === "fulfilled" ? { apiVersion: apiVersion.value } : {}),
      ...(serverVersion.status === "fulfilled" ? { serverVersion: serverVersion.value } : {}),
    };
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
        toast.success("Direct connection opened.");
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
      toast.success("Connected!");
    } finally {
      setReconnectBusyId(null);
    }
    // Errors propagate to the caller — no catch here.
  }

  // Called from the Connections list — shows a toast on failure.
  function handleReconnect(instance: ConnectionInstance) {
    reconnect(instance).catch((err) => {
      toast.error(parseApiError(err));
    });
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
    const fingerprint = serverFingerprint(instance);
    try {
      await rememberServer({
        mode: instance.mode,
        baseUrl: instance.baseUrl,
        label: deriveLabel(instance.baseUrl),
        secret,
      });
      // Record the budget so it offers one-click reconnect next time.
      await rememberBudget({
        serverFingerprint: fingerprint,
        budgetSyncId: instance.budgetSyncId,
        name: instance.label,
      });
      if (instance.encryptionPassword) {
        await rememberBudgetEncryption({
          serverFingerprint: fingerprint,
          budgetSyncId: instance.budgetSyncId,
          label: instance.label,
          encryptionPassword: instance.encryptionPassword,
        });
      }
    } catch (err) {
      toast.error(`Connected, but couldn't remember this server: ${parseApiError(err)}`);
    }
  }

  // One-click reconnect into a remembered budget (RD-063): reveal the server
  // secret + that budget's encryption password, rebuild the connection, and go
  // straight to the budget - no budget picker. The same path as the toolbar's
  // saved budgets: checked before it joins the session, so a server that is
  // down leaves nothing behind and replaces nothing. Errors propagate to the
  // caller (the Connections list shows them inline).
  async function openRememberedBudget(server: ServerCredentialMeta, budget: RememberedBudget) {
    const opened = await connectSavedBudget(
      {
        serverFingerprint: server.serverFingerprint,
        budgetSyncId: budget.budgetSyncId,
        name: budget.name,
        mode: server.mode,
        baseUrl: server.baseUrl,
        serverLabel: server.label,
      },
      {
        activate: true,
        prepare: async (instance) => {
          const withVersions = await readVersions(instance);
          discardAll();
          queryClient.clear();
          return withVersions;
        },
      }
    );
    toast.success(isBrowserApiConnection(opened) ? "Direct connection opened." : "Connected!");
  }

  // Start a connection from a remembered server (RD-063): reveal its secret,
  // prime the form, and load its budget list so the user can pick any budget.
  // Errors propagate to the caller (the Connections list shows them inline).
  async function startFromRememberedServer(server: ServerCredentialMeta) {
    dropCredential();
    const generation = credentialGenerationRef.current;
    const revealed = await revealServerSecret(server.serverFingerprint);
    // Locked, or another server chosen, while it was revealed.
    if (generation !== credentialGenerationRef.current) return;
    setConnectionMode(revealed.mode);
    setSelectedServerId(null);
    setBaseUrl(revealed.baseUrl);
    // The secret goes to the server call only - never into the form's fields.
    await validate({
      generation,
      mode: revealed.mode,
      baseUrl: revealed.baseUrl,
      apiKey: revealed.secret.apiKey ?? undefined,
      serverPassword: revealed.secret.serverPassword ?? undefined,
      source: "saved",
    });
  }

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

  // Use a budget's remembered encryption password, so an encrypted budget
  // opens without a second prompt. Held, never put in the field - and a
  // password the user typed always wins.
  async function holdSavedEncryption(mode: ConnectionMode, url: string, budgetSyncId: string) {
    const request = ++encryptionRequestRef.current;
    heldEncryptionRef.current = "";
    setEncryptionSaved(false);
    const saved = await revealBudgetEncryption(mode, url, budgetSyncId);
    // Another budget chosen, or the password cleared, while it was revealed.
    if (request !== encryptionRequestRef.current) return;
    heldEncryptionRef.current = saved;
    setEncryptionSaved(!!saved);
  }

  /** The encryption password to open the chosen budget with: typed, else saved. */
  function chosenEncryptionPassword(): string {
    return encryptionPassword.trim() || heldEncryptionRef.current;
  }

  function handleSelectBudget(budgetSyncId: string) {
    setSelectedGroupId(budgetSyncId);
    if (connectStatus.kind === "error") setConnectStatus({ kind: "idle" });
    if (validatedMode && validatedUrl) void holdSavedEncryption(validatedMode, validatedUrl, budgetSyncId);
  }

  // ── Validate: fetch budget list ─────────────────────────────────────────────

  async function validate(overrides: {
    mode?: ConnectionMode;
    baseUrl?: string;
    apiKey?: string;
    serverPassword?: string;
    /** Where an override secret came from, for the "saved" line the form shows. */
    source?: HeldCredential["source"];
    /** The credential generation the caller started under, before its own awaits. */
    generation?: number;
  } = {}) {
    const mode = overrides.mode ?? connectionMode;
    const url = normalizeUrl(overrides.baseUrl ?? baseUrl);
    // An override (saved or session), else what was typed, else the held one.
    const held = heldSecret();
    const key = (overrides.apiKey ?? (apiKey.trim() || held.apiKey || "")).trim();
    const password = overrides.serverPassword ?? (serverPassword || held.serverPassword || "");
    const typed = mode === "http-api" ? !!apiKey.trim() : !!serverPassword;
    const source: HeldCredential["source"] =
      overrides.source ?? (typed ? "entered" : (heldCredential?.source ?? "entered"));

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

    const generation = overrides.generation ?? credentialGenerationRef.current;
    // True once the vault was locked, or the credential let go of, since this
    // started: the answer is dropped rather than bringing the secret back.
    const stale = () => generation !== credentialGenerationRef.current;
    setValidateStatus({ kind: "busy" });
    setBudgets(null);
    setSelectedGroupId(null);
    setEncryptionPassword("");
    heldEncryptionRef.current = "";
    setEncryptionSaved(false);
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

      if (stale()) {
        setValidateStatus({ kind: "idle" });
        return;
      }
      if (fetched.length === 0) {
        setValidateStatus({ kind: "error", message: "No budgets found on this server." });
        return;
      }

      setValidatedMode(mode);
      setValidatedUrl(url);
      holdCredential({ source, mode, baseUrl: url }, mode === "http-api" ? { apiKey: key } : { serverPassword: password });
      setValidatedApiVersion(apiVersion);
      setValidatedServerVersion(serverVersion);
      setBudgets(fetched);
      setSelectedGroupId(fetched[0].groupId!);
      setValidateStatus({ kind: "idle" });

      // Use the initially-selected budget's remembered encryption password (if
      // any) so opening it needs no second prompt. Local mode/url, since the
      // validated* state was just set this tick.
      await holdSavedEncryption(mode, url, fetched[0].groupId!);

      // Persist the server, then select its chip so the manual form collapses.
      const persisted = useSavedServersStore
        .getState()
        .servers.find((server) => server.mode === mode && server.baseUrl === url);
      if (persisted) setSelectedServerId(persisted.id);
    } catch (err) {
      if (stale()) {
        setValidateStatus({ kind: "idle" });
        return;
      }
      // A secret that did not work is not kept, and not left in a field.
      dropCredential();
      setApiKey("");
      setServerPassword("");
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

    // If this budget is already reachable via a different transport/URL —
    // either open this session or saved in the vault — reconnecting switches it
    // (one connection per budget). Confirm first, unless already confirmed.
    const replacedExisting =
      instances.find(
        (i) => i.budgetSyncId === selected.groupId && !(i.mode === validatedMode && i.baseUrl === validatedUrl)
      ) ??
      savedBudgets.find(
        (s) => s.budgetSyncId === selected.groupId && !(s.mode === validatedMode && s.baseUrl === validatedUrl)
      );
    if (replacedExisting && !confirmSwitchRef.current) {
      setPendingBudgetSwitch({
        title: "Switch this budget's connection?",
        message: `"${replacedExisting.label}" is already set up in ${getConnectionModeBadge(replacedExisting.mode)} mode. Continuing switches it to ${getConnectionModeBadge(validatedMode)} mode and discards any unsaved changes.`,
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
        serverPassword: heldSecret().serverPassword ?? "",
        budgetSyncId: selected.groupId!,
        ...(validatedServerVersion ? { serverVersion: validatedServerVersion } : {}),
        ...(chosenEncryptionPassword() ? { encryptionPassword: chosenEncryptionPassword() } : {}),
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
        toast.success("Direct connection opened.");
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
        apiKey: heldSecret().apiKey ?? "",
        // Explicitly set to undefined when blank so clearing the field removes
        // a stored encryption password rather than silently preserving it.
        encryptionPassword: chosenEncryptionPassword() || undefined,
      };
      setConnectStatus({ kind: "busy" });
      try {
        // Checked first, so a wrong key is never remembered.
        await reconnect(freshInstance);
        await maybeRemember(freshInstance);
        setConnectStatus({ kind: "idle" });
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status: number }).status
            : -1;
        if (status === 401 || status === 403) {
          setApiKey("");
          setSelectedServerId(null);
          dropCredential();
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
      apiKey: heldSecret().apiKey ?? "",
      budgetSyncId: selected.groupId!,
      ...(chosenEncryptionPassword() ? { encryptionPassword: chosenEncryptionPassword() } : {}),
    };

    setConnectStatus({ kind: "busy" });
    try {
      await testConnection(instance);
      const [apiVersionResult, serverVersionResult] = await Promise.allSettled([
        getApiVersion(validatedUrl, instance.apiKey),
        getServerVersion(validatedUrl, instance.apiKey, selected.groupId!),
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
      toast.success("Connected!");
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : -1;
      if (status === 401 || status === 403) {
        // Invalid API key — reset to step 1 so the user can correct their credentials.
        setApiKey("");
        setSelectedServerId(null);
        dropCredential();
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
    // Held secrets (never rendered): where they came from, and how to drop them
    heldCredential,
    chooseDifferentCredential,
    dropCredential,
    forgetOnLock,
    encryptionSaved,
    chooseDifferentEncryptionPassword,
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
    // Remembered servers (RD-063)
    startFromRememberedServer,
    openRememberedBudget,
    handleSelectBudget,
    // Cross-mode reconnect confirmation
    pendingBudgetSwitch,
    dismissBudgetSwitch: () => setPendingBudgetSwitch(null),
  };
}
