import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { generateId } from "@/lib/uuid";
import type { ConnectionMode } from "@/store/connection";

// ─── Types ────────────────────────────────────────────────────────────────────

type SavedServerBase = {
  id: string;
  mode: ConnectionMode;
  /** Derived from the URL host at save time (e.g. "budgetapi.example.com") */
  label: string;
  baseUrl: string;
};

export type SavedHttpApiServer = SavedServerBase & {
  mode: "http-api";
  apiKey: string;
};

export type SavedBrowserApiServer = SavedServerBase & {
  mode: "browser-api";
  serverPassword: string;
};

export type SavedServer = SavedHttpApiServer | SavedBrowserApiServer;

type SavedServersState = {
  servers: SavedServer[];
};

type SavedServerInput = Omit<SavedHttpApiServer, "id"> | Omit<SavedBrowserApiServer, "id">;

type SavedServersActions = {
  /**
   * Adds a server. Idempotent by mode + baseUrl so HTTP API and Direct presets
   * for the same host can coexist without overwriting each other.
   */
  addServer: (params: SavedServerInput) => void;
  /** Removes the saved server entry matching the given id. No-op if not found. */
  removeServer: (id: string) => void;
  /** Removes all saved servers. Called alongside clearAll() on the connection store. */
  clearServers: () => void;
};

type PersistedSavedServerRecord = {
  id?: unknown;
  mode?: unknown;
  label?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  serverPassword?: unknown;
};

type PersistedSavedServersState = {
  servers?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getPersistedState(value: unknown): PersistedSavedServersState {
  if (typeof value !== "object" || value === null) return {};
  if (
    "state" in value &&
    typeof value.state === "object" &&
    value.state !== null
  ) {
    return value.state as PersistedSavedServersState;
  }
  return value as PersistedSavedServersState;
}

export function isHttpApiSavedServer(
  server: SavedServer | null | undefined
): server is SavedHttpApiServer {
  return server?.mode === "http-api";
}

export function isBrowserApiSavedServer(
  server: SavedServer | null | undefined
): server is SavedBrowserApiServer {
  return server?.mode === "browser-api";
}

export function normalizeSavedServer(record: unknown): SavedServer | null {
  if (typeof record !== "object" || record === null) return null;
  const persisted = record as PersistedSavedServerRecord;
  const id = asString(persisted.id);
  const label = asString(persisted.label);
  const baseUrl = asString(persisted.baseUrl);

  if (!id || !label || !baseUrl) return null;

  if (persisted.mode === "browser-api") {
    return {
      id,
      mode: "browser-api",
      label,
      baseUrl,
      serverPassword: asString(persisted.serverPassword) ?? "",
    };
  }

  return {
    id,
    mode: "http-api",
    label,
    baseUrl,
    apiKey: asString(persisted.apiKey) ?? "",
  };
}

export function migrateSavedServersState(value: unknown): SavedServersState {
  const persisted = getPersistedState(value);
  return {
    servers: Array.isArray(persisted.servers)
      ? persisted.servers
          .map(normalizeSavedServer)
          .filter((server): server is SavedServer => server !== null)
      : [],
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Saved servers are persisted to sessionStorage so credentials are cleared
 * when the browser tab is closed — consistent with connection.ts behaviour.
 */
export const useSavedServersStore = create<SavedServersState & SavedServersActions>()(
  persist(
    (set) => ({
      servers: [],

      addServer: (params) =>
        set((state) => {
          const existing = state.servers.find(
            (server) => server.mode === params.mode && server.baseUrl === params.baseUrl
          );
          if (existing) {
            return {
              servers: state.servers.map((server) =>
                server.id === existing.id ? ({ ...server, ...params } as SavedServer) : server
              ),
            };
          }
          return { servers: [...state.servers, { ...params, id: generateId() } as SavedServer] };
        }),

      removeServer: (id) =>
        set((state) => ({
          servers: state.servers.filter((server) => server.id !== id),
        })),

      clearServers: () => set({ servers: [] }),
    }),
    {
      name: "actual-admin-saved-servers",
      version: 2,
      migrate: (persistedState) => migrateSavedServersState(persistedState),
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : (null as unknown as Storage)
      ),
    }
  )
);
