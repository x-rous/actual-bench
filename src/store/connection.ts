import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionMode = "http-api" | "browser-api";

type ConnectionBase = {
  id: string;
  label: string;
  mode: ConnectionMode;
  baseUrl: string;
  budgetSyncId: string;
  /** Optional: required by the jhonderson actual-http-api when the budget is encrypted */
  encryptionPassword?: string;
};

export type HttpApiConnection = ConnectionBase & {
  mode: "http-api";
  apiKey: string;
  /** actual-http-api wrapper version — fetched once on connect, stored in session */
  apiVersion?: string;
  /** Actual Budget server version — fetched once on connect, stored in session */
  serverVersion?: string;
};

export type BrowserApiConnection = ConnectionBase & {
  mode: "browser-api";
  serverPassword: string;
  /** Actual Budget server version — fetched once available, stored in session */
  serverVersion?: string;
};

export type ConnectionInstance = HttpApiConnection | BrowserApiConnection;

type ConnectionState = {
  instances: ConnectionInstance[];
  activeInstanceId: string | null;
};

type ConnectionActions = {
  addInstance: (instance: ConnectionInstance) => void;
  removeInstance: (id: string) => void;
  setActiveInstance: (id: string | null) => void;
  updateInstance: (id: string, patch: Partial<ConnectionInstance>) => void;
  clearAll: () => void;
};

type PersistedConnectionRecord = {
  id?: unknown;
  label?: unknown;
  mode?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  serverPassword?: unknown;
  budgetSyncId?: unknown;
  encryptionPassword?: unknown;
  apiVersion?: unknown;
  serverVersion?: unknown;
};

type PersistedConnectionState = {
  instances?: unknown;
  activeInstanceId?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getPersistedState(value: unknown): PersistedConnectionState {
  if (typeof value !== "object" || value === null) return {};
  if (
    "state" in value &&
    typeof value.state === "object" &&
    value.state !== null
  ) {
    return value.state as PersistedConnectionState;
  }
  return value as PersistedConnectionState;
}

export function isHttpApiConnection(
  connection: ConnectionInstance | null | undefined
): connection is HttpApiConnection {
  return connection?.mode === "http-api";
}

export function isBrowserApiConnection(
  connection: ConnectionInstance | null | undefined
): connection is BrowserApiConnection {
  return connection?.mode === "browser-api";
}

export function normalizeConnectionInstance(
  record: unknown
): ConnectionInstance | null {
  if (typeof record !== "object" || record === null) return null;
  const persisted = record as PersistedConnectionRecord;
  const id = asString(persisted.id);
  const label = asString(persisted.label);
  const baseUrl = asString(persisted.baseUrl);
  const budgetSyncId = asString(persisted.budgetSyncId);

  if (!id || !label || !baseUrl || !budgetSyncId) return null;

  const common = {
    id,
    label,
    baseUrl,
    budgetSyncId,
    ...(asString(persisted.encryptionPassword)
      ? { encryptionPassword: asString(persisted.encryptionPassword) }
      : {}),
    ...(asString(persisted.serverVersion)
      ? { serverVersion: asString(persisted.serverVersion) }
      : {}),
  };

  if (persisted.mode === "browser-api") {
    return {
      ...common,
      mode: "browser-api",
      serverPassword: asString(persisted.serverPassword) ?? "",
    };
  }

  return {
    ...common,
    mode: "http-api",
    apiKey: asString(persisted.apiKey) ?? "",
    ...(asString(persisted.apiVersion)
      ? { apiVersion: asString(persisted.apiVersion) }
      : {}),
  };
}

export function migrateConnectionState(value: unknown): ConnectionState {
  const persisted = getPersistedState(value);
  const instances = Array.isArray(persisted.instances)
    ? persisted.instances
        .map(normalizeConnectionInstance)
        .filter((instance): instance is ConnectionInstance => instance !== null)
    : [];
  const activeInstanceId = asString(persisted.activeInstanceId);

  return {
    instances,
    activeInstanceId:
      activeInstanceId &&
      instances.some(
        (instance) => instance.id === activeInstanceId && isHttpApiConnection(instance)
      )
        ? activeInstanceId
        : null,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Connection state is persisted to sessionStorage so it survives:
 *  - Next.js App Router client-side navigation
 *  - Turbopack HMR module re-initialization in dev mode
 *
 * sessionStorage (not localStorage) is intentional: credentials are cleared
 * when the browser tab is closed.
 */
export const useConnectionStore = create<ConnectionState & ConnectionActions>()(
  persist(
    (set) => ({
      instances: [],
      activeInstanceId: null,

      addInstance: (instance) =>
        set((state) => ({
          instances: [...state.instances, instance],
          activeInstanceId:
            state.activeInstanceId ?? (isHttpApiConnection(instance) ? instance.id : null),
        })),

      removeInstance: (id) =>
        set((state) => {
          const remaining = state.instances.filter((i) => i.id !== id);
          const nextActive =
            state.activeInstanceId === id
              ? (remaining.find(isHttpApiConnection)?.id ?? null)
              : state.activeInstanceId;
          return { instances: remaining, activeInstanceId: nextActive };
        }),

      setActiveInstance: (id) =>
        set((state) => ({
          activeInstanceId:
            id === null ||
            state.instances.some(
              (instance) => instance.id === id && isHttpApiConnection(instance)
            )
              ? id
              : state.activeInstanceId,
        })),

      updateInstance: (id, patch) =>
        set((state) => ({
          instances: state.instances.map((i) =>
            i.id === id ? ({ ...i, ...patch } as ConnectionInstance) : i
          ),
        })),

      clearAll: () => set({ instances: [], activeInstanceId: null }),
    }),
    {
      name: "actual-admin-connection",
      version: 2,
      migrate: (persistedState) => migrateConnectionState(persistedState),
      // Guard for SSR — sessionStorage is only available in the browser.
      // Returning null here causes Zustand to skip persistence on the server
      // without throwing, preventing hydration mismatches.
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : null as unknown as Storage
      ),
    }
  )
);

// ─── Derived selectors ────────────────────────────────────────────────────────

export function selectActiveInstance(
  state: ConnectionState
): ConnectionInstance | null {
  if (!state.activeInstanceId) return null;
  return state.instances.find((i) => i.id === state.activeInstanceId) ?? null;
}
