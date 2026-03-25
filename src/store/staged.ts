import { create } from "zustand";
import type { BaseEntity } from "@/types/entities";
import type {
  Account,
  Payee,
  CategoryGroup,
  Category,
  Rule,
  Schedule,
} from "@/types/entities";
import type { StagedEntity, StagedMap } from "@/types/staged";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStaged<T extends BaseEntity>(entity: T, isNew = false): StagedEntity<T> {
  return {
    entity,
    original: isNew ? null : structuredClone(entity),
    isNew,
    isUpdated: false,
    isDeleted: false,
    validationErrors: {},
  };
}

function applyUpdate<T extends BaseEntity>(
  map: StagedMap<T>,
  id: string,
  patch: Partial<T>
): StagedMap<T> {
  const existing = map[id];
  if (!existing) return map;
  return {
    ...map,
    [id]: {
      ...existing,
      entity: { ...existing.entity, ...patch },
      isUpdated: !existing.isNew,
    },
  };
}

function applyDelete<T extends BaseEntity>(
  map: StagedMap<T>,
  id: string
): StagedMap<T> {
  const existing = map[id];
  if (!existing) return map;
  if (existing.isNew) {
    // New rows that are deleted are simply removed — they never existed on the server
    const next = { ...map };
    delete next[id];
    return next;
  }
  return { ...map, [id]: { ...existing, isDeleted: true } };
}

function applyRestore<T extends BaseEntity>(
  map: StagedMap<T>,
  id: string
): StagedMap<T> {
  const existing = map[id];
  if (!existing) return map;
  return {
    ...map,
    [id]: {
      ...existing,
      entity: existing.original ?? existing.entity,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
      saveError: undefined,
    },
  };
}

// ─── State shape ──────────────────────────────────────────────────────────────

type StagedStoreState = {
  accounts: StagedMap<Account>;
  payees: StagedMap<Payee>;
  categoryGroups: StagedMap<CategoryGroup>;
  categories: StagedMap<Category>;
  rules: StagedMap<Rule>;
  schedules: StagedMap<Schedule>;
  /** Undo stack — each entry is a full snapshot of the staged maps */
  undoStack: StagedStoreSnapshot[];
  /** Redo stack */
  redoStack: StagedStoreSnapshot[];
};

type StagedStoreSnapshot = Omit<StagedStoreState, "undoStack" | "redoStack">;

type StagedStoreActions = {
  /** Load the server snapshot for an entity type, replacing any existing staged data */
  loadAccounts: (accounts: Account[]) => void;
  loadPayees: (payees: Payee[]) => void;
  loadCategoryGroups: (groups: CategoryGroup[], categories: Category[]) => void;
  loadCategories: (categories: Category[]) => void;
  loadRules: (rules: Rule[]) => void;
  loadSchedules: (schedules: Schedule[]) => void;

  /** Stage a new (not-yet-saved) entity */
  stageNew: <K extends EntityKey>(entityType: K, entity: EntityTypeMap[K]) => void;

  /** Stage an update to an existing entity */
  stageUpdate: <K extends EntityKey>(
    entityType: K,
    id: string,
    patch: Partial<EntityTypeMap[K]>
  ) => void;

  /** Mark an entity as pending deletion */
  stageDelete: <K extends EntityKey>(entityType: K, id: string) => void;

  /** Revert a single entity to its original server state */
  revertEntity: <K extends EntityKey>(entityType: K, id: string) => void;

  /** Record API save errors on specific entities (keyed by id) */
  setSaveErrors: <K extends EntityKey>(entityType: K, errors: Record<string, string>) => void;

  /** Clear the save error on a single entity (e.g. after user clicks Retry) */
  clearSaveError: <K extends EntityKey>(entityType: K, id: string) => void;

  /** Discard ALL staged changes across all entity types */
  discardAll: () => void;

  /** Push current state onto the undo stack */
  pushUndo: () => void;

  undo: () => void;
  redo: () => void;
};

type EntityKey = keyof StagedStoreSnapshot;
type EntityTypeMap = {
  accounts: Account;
  payees: Payee;
  categoryGroups: CategoryGroup;
  categories: Category;
  rules: Rule;
  schedules: Schedule;
};

// ─── Store ────────────────────────────────────────────────────────────────────

const emptySnapshot = (): StagedStoreSnapshot => ({
  accounts: {},
  payees: {},
  categoryGroups: {},
  categories: {},
  rules: {},
  schedules: {},
});

function snapshot(state: StagedStoreState): StagedStoreSnapshot {
  return {
    accounts: state.accounts,
    payees: state.payees,
    categoryGroups: state.categoryGroups,
    categories: state.categories,
    rules: state.rules,
    schedules: state.schedules,
  };
}

export const useStagedStore = create<StagedStoreState & StagedStoreActions>((set) => ({
  ...emptySnapshot(),
  undoStack: [],
  redoStack: [],

  loadAccounts: (accounts) =>
    set((state) => {
      const serverIds = new Set(accounts.map((a) => a.id));
      const newMap: StagedMap<Account> = {};

      // Load server accounts, preserving save errors and edits on failed rows
      for (const a of accounts) {
        const existing = state.accounts[a.id];
        const entry = makeStaged(a);
        if (existing?.saveError) {
          entry.saveError = existing.saveError;
          if (existing.isUpdated) {
            // Restore edited entity so the user can retry
            entry.entity = existing.entity;
            entry.isUpdated = true;
          }
        }
        newMap[a.id] = entry;
      }

      // Preserve new rows that the server doesn't know about yet (failed creates)
      for (const [id, entry] of Object.entries(state.accounts)) {
        if (!serverIds.has(id) && entry.isNew) {
          newMap[id] = entry;
        }
      }

      return { accounts: newMap };
    }),

  loadPayees: (payees) =>
    set((state) => {
      const serverIds = new Set(payees.map((p) => p.id));
      const newMap: StagedMap<Payee> = {};

      for (const p of payees) {
        const existing = state.payees[p.id];
        const entry = makeStaged(p);
        if (existing?.saveError) {
          entry.saveError = existing.saveError;
          if (existing.isUpdated) {
            entry.entity = existing.entity;
            entry.isUpdated = true;
          }
        }
        newMap[p.id] = entry;
      }

      for (const [id, entry] of Object.entries(state.payees)) {
        if (!serverIds.has(id) && entry.isNew) newMap[id] = entry;
      }

      return { payees: newMap };
    }),

  loadCategoryGroups: (groups, categories) =>
    set((state) => {
      const serverGroupIds = new Set(groups.map((g) => g.id));
      const newGroupMap: StagedMap<CategoryGroup> = {};
      for (const g of groups) {
        const existing = state.categoryGroups[g.id];
        const entry = makeStaged(g);
        if (existing?.saveError) {
          entry.saveError = existing.saveError;
          if (existing.isUpdated) { entry.entity = existing.entity; entry.isUpdated = true; }
        }
        newGroupMap[g.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.categoryGroups)) {
        if (!serverGroupIds.has(id) && entry.isNew) newGroupMap[id] = entry;
      }

      const serverCatIds = new Set(categories.map((c) => c.id));
      const newCatMap: StagedMap<Category> = {};
      for (const c of categories) {
        const existing = state.categories[c.id];
        const entry = makeStaged(c);
        if (existing?.saveError) {
          entry.saveError = existing.saveError;
          if (existing.isUpdated) { entry.entity = existing.entity; entry.isUpdated = true; }
        }
        newCatMap[c.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.categories)) {
        if (!serverCatIds.has(id) && entry.isNew) newCatMap[id] = entry;
      }

      return { categoryGroups: newGroupMap, categories: newCatMap };
    }),

  loadCategories: (categories) =>
    set((state) => {
      const serverIds = new Set(categories.map((c) => c.id));
      const newMap: StagedMap<Category> = {};
      for (const c of categories) {
        const existing = state.categories[c.id];
        const entry = makeStaged(c);
        if (existing?.saveError) {
          entry.saveError = existing.saveError;
          if (existing.isUpdated) { entry.entity = existing.entity; entry.isUpdated = true; }
        }
        newMap[c.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.categories)) {
        if (!serverIds.has(id) && entry.isNew) newMap[id] = entry;
      }
      return { categories: newMap };
    }),

  loadRules: (rules) =>
    set((state) => {
      const serverIds = new Set(rules.map((r) => r.id));
      const newMap: StagedMap<Rule> = {};
      for (const r of rules) {
        const existing = state.rules[r.id];
        const entry = makeStaged(r);
        if (existing?.saveError) {
          entry.saveError = existing.saveError;
          if (existing.isUpdated) { entry.entity = existing.entity; entry.isUpdated = true; }
        }
        newMap[r.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.rules)) {
        if (!serverIds.has(id) && entry.isNew) newMap[id] = entry;
      }
      return { rules: newMap };
    }),

  loadSchedules: (schedules) =>
    set({
      schedules: Object.fromEntries(
        schedules.map((s) => [s.id, makeStaged(s)])
      ),
    }),

  stageNew: (entityType, entity) =>
    set((state) => ({
      [entityType]: {
        ...state[entityType],
        [(entity as BaseEntity).id]: makeStaged(entity as BaseEntity & typeof entity, true),
      },
    })),

  stageUpdate: (entityType, id, patch) =>
    set((state) => ({
      [entityType]: applyUpdate(state[entityType] as StagedMap<BaseEntity>, id, patch as Partial<BaseEntity>),
    })),

  stageDelete: (entityType, id) =>
    set((state) => ({
      [entityType]: applyDelete(state[entityType] as StagedMap<BaseEntity>, id),
    })),

  revertEntity: (entityType, id) =>
    set((state) => ({
      [entityType]: applyRestore(state[entityType] as StagedMap<BaseEntity>, id),
    })),

  setSaveErrors: (entityType, errors) =>
    set((state) => {
      const map = { ...(state[entityType] as StagedMap<BaseEntity>) };
      for (const [id, message] of Object.entries(errors)) {
        if (map[id]) map[id] = { ...map[id], saveError: message };
      }
      return { [entityType]: map };
    }),

  clearSaveError: (entityType, id) =>
    set((state) => {
      const map = state[entityType] as StagedMap<BaseEntity>;
      if (!map[id]) return {};
      return { [entityType]: { ...map, [id]: { ...map[id], saveError: undefined } } };
    }),

  discardAll: () => set({ ...emptySnapshot(), undoStack: [], redoStack: [] }),

  pushUndo: () =>
    set((state) => ({
      undoStack: [...state.undoStack, snapshot(state)],
      redoStack: [],
    })),

  undo: () =>
    set((state) => {
      const stack = [...state.undoStack];
      const prev = stack.pop();
      if (!prev) return {};
      return {
        ...prev,
        undoStack: stack,
        redoStack: [snapshot(state), ...state.redoStack],
      };
    }),

  redo: () =>
    set((state) => {
      const [next, ...rest] = state.redoStack;
      if (!next) return {};
      return {
        ...next,
        undoStack: [...state.undoStack, snapshot(state)],
        redoStack: rest,
      };
    }),
}));

// ─── Derived selectors ────────────────────────────────────────────────────────

export function selectHasChanges(state: StagedStoreState): boolean {
  const keys: EntityKey[] = [
    "accounts",
    "payees",
    "categoryGroups",
    "categories",
    "rules",
    "schedules",
  ];
  return keys.some((key) =>
    Object.values(state[key]).some(
      (s) => (s as StagedEntity<BaseEntity>).isNew ||
              (s as StagedEntity<BaseEntity>).isUpdated ||
              (s as StagedEntity<BaseEntity>).isDeleted
    )
  );
}

export function selectCanUndo(state: StagedStoreState): boolean {
  return state.undoStack.length > 0;
}

export function selectCanRedo(state: StagedStoreState): boolean {
  return state.redoStack.length > 0;
}
