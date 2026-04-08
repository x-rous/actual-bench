import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionInstance = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  budgetSyncId: string;
  /** Optional: required by the jhonderson actual-http-api when the budget is encrypted */
  encryptionPassword?: string;
  /** actual-http-api wrapper version — fetched once on connect, stored in session */
  apiVersion?: string;
  /** Actual Budget server version — fetched once on connect, stored in session */
  serverVersion?: string;
};

type ConnectionState = {
  instances: ConnectionInstance[];
  activeInstanceId: string | null;
};

type ConnectionActions = {
  addInstance: (instance: ConnectionInstance) => void;
  removeInstance: (id: string) => void;
  setActiveInstance: (id: string | null) => void;
  updateInstance: (id: string, patch: Partial<Omit<ConnectionInstance, "id">>) => void;
  clearAll: () => void;
};

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
          activeInstanceId: state.activeInstanceId ?? instance.id,
        })),

      removeInstance: (id) =>
        set((state) => {
          const remaining = state.instances.filter((i) => i.id !== id);
          const nextActive =
            state.activeInstanceId === id
              ? (remaining[0]?.id ?? null)
              : state.activeInstanceId;
          return { instances: remaining, activeInstanceId: nextActive };
        }),

      setActiveInstance: (id) => set({ activeInstanceId: id }),

      updateInstance: (id, patch) =>
        set((state) => ({
          instances: state.instances.map((i) =>
            i.id === id ? { ...i, ...patch } : i
          ),
        })),

      clearAll: () => set({ instances: [], activeInstanceId: null }),
    }),
    {
      name: "actual-admin-connection",
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
