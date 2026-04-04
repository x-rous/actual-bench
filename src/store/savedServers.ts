import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { generateId } from "@/lib/uuid";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SavedServer = {
  id: string;
  /** Derived from the URL host at save time (e.g. "budgetapi.example.com") */
  label: string;
  baseUrl: string;
  apiKey: string;
};

type SavedServersState = {
  servers: SavedServer[];
};

type SavedServersActions = {
  /**
   * Adds a server. Idempotent by baseUrl — if a server with the same baseUrl
   * already exists it is not added again.
   */
  addServer: (params: Omit<SavedServer, "id">) => void;
  /** Removes all saved servers. Called alongside clearAll() on the connection store. */
  clearServers: () => void;
};

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
          const exists = state.servers.some((s) => s.baseUrl === params.baseUrl);
          if (exists) return state;
          return { servers: [...state.servers, { ...params, id: generateId() }] };
        }),

      clearServers: () => set({ servers: [] }),
    }),
    {
      name: "actual-admin-saved-servers",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : (null as unknown as Storage)
      ),
    }
  )
);
