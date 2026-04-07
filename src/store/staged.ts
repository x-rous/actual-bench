import { create } from "zustand";
import type { BaseEntity } from "@/types/entities";
import type {
  Account,
  Payee,
  CategoryGroup,
  Category,
  Rule,
  Schedule,
  Tag,
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
  tags: StagedMap<Tag>;
  /** Undo stack — each entry is a full snapshot of the staged maps */
  undoStack: StagedStoreSnapshot[];
  /** Redo stack */
  redoStack: StagedStoreSnapshot[];
  /**
   * Merge dependency map: newRuleId → originalRuleIds[]
   * Originals should only be deleted on the server AFTER the new rule is successfully created.
   * Intentionally excluded from undo snapshots — it is save-order metadata, not entity state.
   */
  mergeDependencies: Record<string, string[]>;
  /**
   * Pending payee merges: each entry holds a target that survives and the IDs
   * that will be merged into it. Executed as a single API call on Save.
   * Intentionally excluded from undo snapshots — pruned when undo restores payee state.
   */
  pendingPayeeMerges: Array<{ targetId: string; mergeIds: string[] }>;
};

type StagedStoreSnapshot = Omit<StagedStoreState, "undoStack" | "redoStack" | "mergeDependencies" | "pendingPayeeMerges">;

type StagedStoreActions = {
  /** Load the server snapshot for an entity type, replacing any existing staged data */
  loadAccounts: (accounts: Account[]) => void;
  loadPayees: (payees: Payee[]) => void;
  loadCategoryGroups: (groups: CategoryGroup[], categories: Category[]) => void;
  loadCategories: (categories: Category[]) => void;
  loadRules: (rules: Rule[]) => void;
  loadSchedules: (schedules: Schedule[]) => void;
  loadTags: (tags: Tag[]) => void;

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

  /**
   * Remove successfully-saved entries from the staged map so the next loadX()
   * call (triggered by invalidateQueries) creates fresh, clean entries from
   * server data. Only call this for non-create IDs (creates use stageDelete).
   */
  markSaved: <K extends EntityKey>(entityType: K, ids: string[]) => void;

  /** Discard ALL staged changes across all entity types */
  discardAll: () => void;

  /** Clear undo/redo history without touching entity data (called after a successful save) */
  clearHistory: () => void;

  /** Push current state onto the undo stack */
  pushUndo: () => void;

  undo: () => void;
  redo: () => void;

  /** Record that originalIds should only be deleted after newRuleId is successfully created */
  setMergeDependency: (newRuleId: string, originalIds: string[]) => void;

  /** Remove merge dependency entries for rules whose creates have been processed */
  clearMergeDependencies: (newRuleIds: string[]) => void;

  /**
   * Stage a payee merge: marks each mergeId as deleted (so they appear staged
   * in the table and DraftPanel) and queues the merge for execution on Save.
   */
  stagePayeeMerge: (targetId: string, mergeIds: string[]) => void;

  /** Remove all pending payee merges (called after a successful save) */
  clearPendingPayeeMerges: () => void;
};

type EntityKey = keyof StagedStoreSnapshot;
type EntityTypeMap = {
  accounts: Account;
  payees: Payee;
  categoryGroups: CategoryGroup;
  categories: Category;
  rules: Rule;
  schedules: Schedule;
  tags: Tag;
};

// ─── Store ────────────────────────────────────────────────────────────────────

const emptySnapshot = (): StagedStoreSnapshot => ({
  accounts: {},
  payees: {},
  categoryGroups: {},
  categories: {},
  rules: {},
  schedules: {},
  tags: {},
});

function snapshot(state: StagedStoreState): StagedStoreSnapshot {
  return {
    accounts: state.accounts,
    payees: state.payees,
    categoryGroups: state.categoryGroups,
    categories: state.categories,
    rules: state.rules,
    schedules: state.schedules,
    tags: state.tags,
  };
}

export const useStagedStore = create<StagedStoreState & StagedStoreActions>((set) => ({
  ...emptySnapshot(),
  undoStack: [],
  redoStack: [],
  mergeDependencies: {},
  pendingPayeeMerges: [],

  loadAccounts: (accounts) =>
    set((state) => {
      const serverIds = new Set(accounts.map((a) => a.id));
      const newMap: StagedMap<Account> = {};

      // Load server accounts, preserving staged edits and deletions so that
      // a background refetch never silently discards unsaved user changes.
      for (const a of accounts) {
        const existing = state.accounts[a.id];
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newMap[a.id] = existing;
          continue;
        }
        const entry = makeStaged(a);
        if (existing?.saveError) entry.saveError = existing.saveError;
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
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newMap[p.id] = existing;
          continue;
        }
        const entry = makeStaged(p);
        if (existing?.saveError) entry.saveError = existing.saveError;
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
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newGroupMap[g.id] = existing;
          continue;
        }
        const entry = makeStaged(g);
        if (existing?.saveError) entry.saveError = existing.saveError;
        newGroupMap[g.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.categoryGroups)) {
        if (!serverGroupIds.has(id) && entry.isNew) newGroupMap[id] = entry;
      }

      const serverCatIds = new Set(categories.map((c) => c.id));
      const newCatMap: StagedMap<Category> = {};
      for (const c of categories) {
        const existing = state.categories[c.id];
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newCatMap[c.id] = existing;
          continue;
        }
        const entry = makeStaged(c);
        if (existing?.saveError) entry.saveError = existing.saveError;
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
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newMap[c.id] = existing;
          continue;
        }
        const entry = makeStaged(c);
        if (existing?.saveError) entry.saveError = existing.saveError;
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
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newMap[r.id] = existing;
          continue;
        }
        const entry = makeStaged(r);
        if (existing?.saveError) entry.saveError = existing.saveError;
        newMap[r.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.rules)) {
        if (!serverIds.has(id) && entry.isNew) newMap[id] = entry;
      }
      return { rules: newMap };
    }),

  loadSchedules: (schedules) =>
    set((state) => {
      const serverIds = new Set(schedules.map((s) => s.id));
      const newMap: StagedMap<Schedule> = {};
      for (const s of schedules) {
        const existing = state.schedules[s.id];
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newMap[s.id] = existing;
          continue;
        }
        const entry = makeStaged(s);
        if (existing?.saveError) entry.saveError = existing.saveError;
        newMap[s.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.schedules)) {
        if (!serverIds.has(id) && entry.isNew) newMap[id] = entry;
      }
      return { schedules: newMap };
    }),

  loadTags: (tags) =>
    set((state) => {
      const serverIds = new Set(tags.map((t) => t.id));
      const newMap: StagedMap<Tag> = {};
      for (const t of tags) {
        const existing = state.tags[t.id];
        if (existing && (existing.isUpdated || existing.isDeleted)) {
          newMap[t.id] = existing;
          continue;
        }
        const entry = makeStaged(t);
        if (existing?.saveError) entry.saveError = existing.saveError;
        newMap[t.id] = entry;
      }
      for (const [id, entry] of Object.entries(state.tags)) {
        if (!serverIds.has(id) && entry.isNew) newMap[id] = entry;
      }
      return { tags: newMap };
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

  markSaved: (entityType, ids) =>
    set((state) => {
      const map = { ...(state[entityType] as StagedMap<BaseEntity>) };
      for (const id of ids) delete map[id];
      return { [entityType]: map };
    }),

  discardAll: () => set({ ...emptySnapshot(), undoStack: [], redoStack: [], mergeDependencies: {}, pendingPayeeMerges: [] }),

  clearHistory: () => set({ undoStack: [], redoStack: [] }),

  setMergeDependency: (newRuleId, originalIds) =>
    set((state) => ({
      mergeDependencies: { ...state.mergeDependencies, [newRuleId]: originalIds },
    })),

  clearMergeDependencies: (newRuleIds) =>
    set((state) => {
      const next = { ...state.mergeDependencies };
      for (const id of newRuleIds) delete next[id];
      return { mergeDependencies: next };
    }),

  stagePayeeMerge: (targetId, mergeIds) =>
    set((state) => {
      let payees = state.payees;
      for (const id of mergeIds) {
        payees = applyDelete(payees, id);
      }
      return {
        payees,
        pendingPayeeMerges: [...state.pendingPayeeMerges, { targetId, mergeIds }],
      };
    }),

  clearPendingPayeeMerges: () => set({ pendingPayeeMerges: [] }),

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

      // Prune orphaned merge dependencies — any newRuleId that no longer exists
      // in the reverted rules map was part of the undone operation and must be
      // cleared, otherwise the next save will try to honour a dependency for a
      // rule that no longer exists in staged state.
      const nextMergeDeps = { ...state.mergeDependencies };
      for (const newRuleId of Object.keys(nextMergeDeps)) {
        if (!prev.rules[newRuleId]) delete nextMergeDeps[newRuleId];
      }

      // Prune pending payee merges whose merged IDs are no longer deleted in the reverted snapshot
      const nextPendingMerges = state.pendingPayeeMerges.filter((m) =>
        m.mergeIds.every((id) => prev.payees[id]?.isDeleted)
      );

      return {
        ...prev,
        undoStack: stack,
        redoStack: [snapshot(state), ...state.redoStack],
        mergeDependencies: nextMergeDeps,
        pendingPayeeMerges: nextPendingMerges,
      };
    }),

  redo: () =>
    set((state) => {
      const [next, ...rest] = state.redoStack;
      if (!next) return {};

      // Prune merge dependencies that belong to rules no longer in the redo target
      const nextMergeDeps = { ...state.mergeDependencies };
      for (const newRuleId of Object.keys(nextMergeDeps)) {
        if (!next.rules[newRuleId]) delete nextMergeDeps[newRuleId];
      }

      // Prune pending payee merges whose merged IDs are no longer deleted in the redo target
      const nextPendingMerges = state.pendingPayeeMerges.filter((m) =>
        m.mergeIds.every((id) => next.payees[id]?.isDeleted)
      );

      return {
        ...next,
        undoStack: [...state.undoStack, snapshot(state)],
        redoStack: rest,
        mergeDependencies: nextMergeDeps,
        pendingPayeeMerges: nextPendingMerges,
      };
    }),
}));

// ─── Derived selectors ────────────────────────────────────────────────────────

export function selectHasChanges(state: StagedStoreState): boolean {
  if (state.pendingPayeeMerges.length > 0) return true;
  const keys: EntityKey[] = [
    "accounts",
    "payees",
    "categoryGroups",
    "categories",
    "rules",
    "schedules",
    "tags",
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
