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
  /** Optional budget encryption password, kept in memory only. */
  encryptionPassword?: string;
};

export type HttpApiConnection = ConnectionBase & {
  mode: "http-api";
  apiKey: string;
  /** actual-http-api wrapper version, held in memory for the active connection. */
  apiVersion?: string;
  /** Actual Budget server version, held in memory for the active connection. */
  serverVersion?: string;
};

export type BrowserApiConnection = ConnectionBase & {
  mode: "browser-api";
  serverPassword: string;
  /** Actual Budget server version, held in memory for the active connection. */
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

/**
 * Active connections require credentials for every transport call. Persisted
 * storage is now secret-free, so legacy persisted connections are intentionally
 * dropped and users reconnect through saved server presets.
 */
export function normalizeConnectionInstance(_record: unknown): ConnectionInstance | null {
  void _record;
  return null;
}

export function migrateConnectionState(_value: unknown): ConnectionState {
  void _value;
  return { instances: [], activeInstanceId: null };
}

export function toPersistedConnectionState(_state: ConnectionState): ConnectionState {
  void _state;
  return { instances: [], activeInstanceId: null };
}

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Active connection state lives in memory only so API keys, server passwords,
 * and budget encryption passwords are never written to browser storage. The
 * persist middleware remains in place to migrate old sessionStorage records out.
 */
export const useConnectionStore = create<ConnectionState & ConnectionActions>()(
  persist<ConnectionState & ConnectionActions, [], [], ConnectionState>(
    (set) => ({
      instances: [],
      activeInstanceId: null,

      addInstance: (instance) =>
        set((state) => {
          // One connection per budget: `budgetSyncId` is the budget's stable
          // identity across transports, so reconnecting a budget in another mode
          // (Direct ↔ HTTP) replaces its entry rather than adding a duplicate
          // that would show twice in the switcher with the same name.
          const withoutSameBudget = state.instances.filter(
            (i) => i.budgetSyncId !== instance.budgetSyncId
          );
          const activeSurvived = withoutSameBudget.some((i) => i.id === state.activeInstanceId);
          return {
            instances: [...withoutSameBudget, instance],
            // Keep the current active connection unless it was the one replaced.
            activeInstanceId: activeSurvived ? state.activeInstanceId : instance.id,
          };
        }),

      removeInstance: (id) =>
        set((state) => {
          const remaining = state.instances.filter((i) => i.id !== id);
          const nextActive =
            state.activeInstanceId === id
              ? (remaining[0]?.id ?? null)
              : state.activeInstanceId;
          return { instances: remaining, activeInstanceId: nextActive };
        }),

      setActiveInstance: (id) =>
        set((state) => ({
          activeInstanceId:
            id === null || state.instances.some((instance) => instance.id === id)
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
      version: 3,
      migrate: (persistedState) => migrateConnectionState(persistedState),
      partialize: toPersistedConnectionState,
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
