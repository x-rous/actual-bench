import {
  selectCanRedo,
  selectCanUndo,
  selectHasChanges,
  useStagedStore,
} from "./staged";
import type { Account } from "@/types/entities";

// Reset the store to a known empty state before each test to prevent leakage.
beforeEach(() => {
  useStagedStore.setState({
    accounts: {},
    payees: {},
    categoryGroups: {},
    categories: {},
    rules: {},
    schedules: {},
    tags: {},
    pendingPayeeMerges: [],
    undoStack: [],
    redoStack: [],
    mergeDependencies: {},
  });
});

const account = (id: string, name: string, overrides: Partial<Account> = {}): Account => ({
  id,
  name,
  offBudget: false,
  closed: false,
  ...overrides,
});

// ─── stageNew ─────────────────────────────────────────────────────────────────

describe("stageNew", () => {
  it("adds the entity with isNew=true", () => {
    const { stageNew } = useStagedStore.getState();
    stageNew("accounts", account("a1", "Checking"));

    const { accounts } = useStagedStore.getState();
    expect(accounts["a1"]).toBeDefined();
    expect(accounts["a1"].isNew).toBe(true);
    expect(accounts["a1"].isUpdated).toBe(false);
    expect(accounts["a1"].isDeleted).toBe(false);
    expect(accounts["a1"].entity.name).toBe("Checking");
  });

  it("sets original to null for new entities", () => {
    const { stageNew } = useStagedStore.getState();
    stageNew("accounts", account("a1", "Checking"));

    expect(useStagedStore.getState().accounts["a1"].original).toBeNull();
  });
});

// ─── stageUpdate ──────────────────────────────────────────────────────────────

describe("stageUpdate", () => {
  it("updates the entity and marks it as isUpdated", () => {
    const { stageUpdate, loadAccounts } = useStagedStore.getState();

    // Load a server account first so it is not isNew
    loadAccounts([account("a1", "Checking")]);
    stageUpdate("accounts", "a1", { name: "Main Checking" });

    const { accounts } = useStagedStore.getState();
    expect(accounts["a1"].entity.name).toBe("Main Checking");
    expect(accounts["a1"].isUpdated).toBe(true);
    expect(accounts["a1"].isNew).toBe(false);
  });

  it("does NOT set isUpdated on a new (unstaged) entity", () => {
    const { stageNew, stageUpdate } = useStagedStore.getState();
    stageNew("accounts", account("a1", "Checking"));
    stageUpdate("accounts", "a1", { name: "Updated" });

    const { accounts } = useStagedStore.getState();
    // isNew entities stay isNew, not isUpdated
    expect(accounts["a1"].isNew).toBe(true);
    expect(accounts["a1"].isUpdated).toBe(false);
    expect(accounts["a1"].entity.name).toBe("Updated");
  });

  it("is a no-op for non-existent entity IDs", () => {
    const { stageUpdate } = useStagedStore.getState();
    stageUpdate("accounts", "nonexistent", { name: "Ghost" });

    expect(Object.keys(useStagedStore.getState().accounts)).toHaveLength(0);
  });
});

// ─── stageDelete ──────────────────────────────────────────────────────────────

describe("stageDelete", () => {
  it("marks a server entity as isDeleted", () => {
    const { loadAccounts, stageDelete } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking")]);
    stageDelete("accounts", "a1");

    expect(useStagedStore.getState().accounts["a1"].isDeleted).toBe(true);
  });

  it("completely removes a new entity (never committed to server)", () => {
    const { stageNew, stageDelete } = useStagedStore.getState();
    stageNew("accounts", account("a1", "Checking"));
    stageDelete("accounts", "a1");

    expect(useStagedStore.getState().accounts["a1"]).toBeUndefined();
  });
});

// ─── revertEntity ─────────────────────────────────────────────────────────────

describe("revertEntity", () => {
  it("restores entity to its original value and clears isUpdated", () => {
    const { loadAccounts, stageUpdate, revertEntity } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking")]);
    stageUpdate("accounts", "a1", { name: "EDITED" });
    revertEntity("accounts", "a1");

    const entry = useStagedStore.getState().accounts["a1"];
    expect(entry.entity.name).toBe("Checking");
    expect(entry.isUpdated).toBe(false);
    expect(entry.isDeleted).toBe(false);
  });

  it("clears saveError on revert", () => {
    const { loadAccounts, setSaveErrors, revertEntity } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking")]);
    setSaveErrors("accounts", { a1: "Something went wrong" });
    revertEntity("accounts", "a1");

    expect(useStagedStore.getState().accounts["a1"].saveError).toBeUndefined();
  });
});

// ─── loadAccounts (preserve-isNew behaviour) ──────────────────────────────────

describe("loadAccounts", () => {
  it("replaces server entities with fresh data", () => {
    const { loadAccounts } = useStagedStore.getState();
    loadAccounts([account("a1", "Old Name")]);
    loadAccounts([account("a1", "New Name")]);

    expect(useStagedStore.getState().accounts["a1"].entity.name).toBe("New Name");
  });

  it("preserves isNew entities not present in server response", () => {
    const { stageNew, loadAccounts } = useStagedStore.getState();
    stageNew("accounts", account("new-id", "Unsaved"));
    loadAccounts([account("a1", "Server Account")]);

    const { accounts } = useStagedStore.getState();
    expect(accounts["new-id"]).toBeDefined();
    expect(accounts["new-id"].isNew).toBe(true);
    expect(accounts["a1"]).toBeDefined();
  });

  it("does NOT preserve deleted-or-updated server entities removed from the server response", () => {
    // An entity that existed on the server but is now absent from the response
    // should not be preserved — the server has removed it.
    const { loadAccounts } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking"), account("a2", "Savings")]);
    loadAccounts([account("a1", "Checking")]); // a2 no longer returned

    expect(useStagedStore.getState().accounts["a2"]).toBeUndefined();
  });
});

// ─── pushUndo / undo / redo ───────────────────────────────────────────────────

describe("pushUndo / undo / redo", () => {
  it("undo restores previous state", () => {
    const { stageNew, pushUndo, undo, loadAccounts } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking")]);

    pushUndo();
    stageNew("accounts", account("a2", "Savings"));

    expect(Object.keys(useStagedStore.getState().accounts)).toHaveLength(2);

    undo();
    expect(Object.keys(useStagedStore.getState().accounts)).toHaveLength(1);
    expect(useStagedStore.getState().accounts["a2"]).toBeUndefined();
  });

  it("redo re-applies the undone state", () => {
    const { stageNew, pushUndo, undo, redo, loadAccounts } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking")]);

    pushUndo();
    stageNew("accounts", account("a2", "Savings"));

    undo();
    redo();

    expect(useStagedStore.getState().accounts["a2"]).toBeDefined();
  });

  it("pushUndo clears the redo stack", () => {
    const { stageNew, pushUndo, undo, loadAccounts } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking")]);

    pushUndo();
    stageNew("accounts", account("a2", "Savings"));
    undo();

    // Now redo stack has one entry. A new pushUndo should clear it.
    pushUndo();
    expect(useStagedStore.getState().redoStack).toHaveLength(0);
  });

  it("undo is a no-op when the stack is empty", () => {
    const { undo, loadAccounts } = useStagedStore.getState();
    loadAccounts([account("a1", "Checking")]);
    undo(); // should not throw

    expect(useStagedStore.getState().accounts["a1"]).toBeDefined();
  });

  it("redo is a no-op when the redo stack is empty", () => {
    const { redo } = useStagedStore.getState();
    redo(); // should not throw
  });
});

// ─── undo: orphaned merge dependency cleanup ──────────────────────────────────

describe("undo — merge dependency cleanup", () => {
  it("removes mergeDependency entries whose newRuleId no longer exists after undo", () => {
    const { stageNew, pushUndo, undo, setMergeDependency } = useStagedStore.getState();

    pushUndo(); // checkpoint before the rule is added
    stageNew("rules", {
      id: "new-rule",
      stage: "default",
      conditionsOp: "and",
      conditions: [],
      actions: [],
    });
    setMergeDependency("new-rule", ["old-rule-1"]);

    expect(useStagedStore.getState().mergeDependencies["new-rule"]).toBeDefined();

    undo(); // new-rule is removed from state

    expect(useStagedStore.getState().mergeDependencies["new-rule"]).toBeUndefined();
  });

  it("preserves mergeDependency entries that still exist after undo", () => {
    const { stageNew, pushUndo, undo, setMergeDependency, loadAccounts } = useStagedStore.getState();

    // Load something first so there's a non-empty state to undo to
    loadAccounts([account("a1", "Checking")]);
    stageNew("rules", {
      id: "rule-A",
      stage: "default",
      conditionsOp: "and",
      conditions: [],
      actions: [],
    });
    setMergeDependency("rule-A", ["old-1"]);

    pushUndo();
    loadAccounts([account("a1", "Checking"), account("a2", "Savings")]);

    undo(); // reverts the second loadAccounts, but rule-A was already there before the checkpoint

    // rule-A still exists in the reverted state (it was added before pushUndo)
    expect(useStagedStore.getState().mergeDependencies["rule-A"]).toBeDefined();
  });
});

// ─── discardAll ───────────────────────────────────────────────────────────────

describe("discardAll", () => {
  it("clears all entity maps and stacks", () => {
    const { stageNew, pushUndo, discardAll } = useStagedStore.getState();
    stageNew("accounts", account("a1", "Checking"));
    pushUndo();

    discardAll();

    const state = useStagedStore.getState();
    expect(Object.keys(state.accounts)).toHaveLength(0);
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
    expect(state.mergeDependencies).toEqual({});
  });
});

// ─── Save lifecycle ───────────────────────────────────────────────────────────

/**
 * `markClean` and `markSaved` decide what the UI is entitled to tell the user
 * about their work. Neither had a test: a bug here means Bench reports a save
 * that never reached the budget, or keeps showing a change that already did.
 */
describe("markClean", () => {
  const st = () => useStagedStore.getState();

  it("adopts the staged values as the new baseline, so the row stops reading as dirty", () => {
    st().stageNew("accounts", account("a1", "Checking"));
    st().stageUpdate("accounts", "a1", { name: "Current" });

    st().markClean("accounts", ["a1"]);

    const entry = st().accounts.a1;
    expect(entry.isNew).toBe(false);
    expect(entry.isUpdated).toBe(false);
    expect(entry.isDeleted).toBe(false);
    // The baseline is the saved value, not the value it had before the edit —
    // otherwise Revert would undo a change that is already on the server.
    expect(entry.original).toEqual(entry.entity);
    expect(entry.original).not.toBe(entry.entity);
  });

  it("clears a previous save error and any validation errors", () => {
    st().stageNew("accounts", account("a1", "Checking"));
    st().setSaveErrors("accounts", { a1: "server said no" });
    expect(st().accounts.a1.saveError).toBe("server said no");

    st().markClean("accounts", ["a1"]);
    expect(st().accounts.a1.saveError).toBeUndefined();
    expect(st().accounts.a1.validationErrors).toEqual({});
  });

  it("ignores ids that are not staged instead of creating empty entries", () => {
    st().markClean("accounts", ["never-existed"]);
    expect(st().accounts["never-existed"]).toBeUndefined();
  });

  it("leaves the entities it was not asked about untouched", () => {
    st().stageNew("accounts", account("a1", "Checking"));
    st().stageNew("accounts", account("a2", "Savings"));

    st().markClean("accounts", ["a1"]);

    expect(st().accounts.a1.isNew).toBe(false);
    expect(st().accounts.a2.isNew).toBe(true);
  });
});

describe("markSaved", () => {
  const st = () => useStagedStore.getState();

  it("drops the entity from the staged map entirely", () => {
    // Used where the caller reloads from the server straight afterwards: the
    // staged copy would otherwise shadow the authoritative one.
    st().stageNew("accounts", account("a1", "Checking"));
    st().stageNew("accounts", account("a2", "Savings"));

    st().markSaved("accounts", ["a1"]);

    expect(st().accounts.a1).toBeUndefined();
    expect(st().accounts.a2).toBeDefined();
  });

  it("is a no-op for ids that are not staged", () => {
    st().stageNew("accounts", account("a1", "Checking"));
    st().markSaved("accounts", ["ghost"]);
    expect(Object.keys(st().accounts)).toEqual(["a1"]);
  });
});

describe("save errors", () => {
  const st = () => useStagedStore.getState();

  it("records a per-entity error without clearing the staged change", () => {
    // The change has to survive the failure: dropping it would silently discard
    // the user's work on the one path where they most need it back.
    st().stageNew("accounts", account("a1", "Checking"));
    st().setSaveErrors("accounts", { a1: "duplicate name" });

    expect(st().accounts.a1.saveError).toBe("duplicate name");
    expect(st().accounts.a1.isNew).toBe(true);
  });

  it("clears one entity's error without touching the others", () => {
    st().stageNew("accounts", account("a1", "Checking"));
    st().stageNew("accounts", account("a2", "Savings"));
    st().setSaveErrors("accounts", { a1: "boom", a2: "bang" });

    st().clearSaveError("accounts", "a1");

    expect(st().accounts.a1.saveError).toBeUndefined();
    expect(st().accounts.a2.saveError).toBe("bang");
  });
});

// ─── Loaders ──────────────────────────────────────────────────────────────────

/**
 * Every loader has to answer the same question: a fresh read arrived from the
 * server — what happens to the work the user has not saved yet? Only
 * `loadAccounts` was tested. The rule is the same for all of them, so it is
 * asserted for all of them.
 */
describe("loaders preserve unsaved work", () => {
  const st = () => useStagedStore.getState();

  const named = (id: string, name: string) => ({ id, name });

  type Entry = {
    entity: { id: string; name: string };
    isNew: boolean;
    isUpdated: boolean;
    isDeleted: boolean;
  };
  /** The staged map for a key, typed enough to assert on without `any`. */
  const mapFor = (key: string): Record<string, Entry | undefined> =>
    (st() as unknown as Record<string, Record<string, Entry>>)[key];

  const cases = [
    ["payees", () => st().loadPayees([named("s1", "Server")] as never)],
    ["categories", () => st().loadCategories([named("s1", "Server")] as never)],
    ["rules", () => st().loadRules([named("s1", "Server")] as never)],
    ["schedules", () => st().loadSchedules([named("s1", "Server")] as never)],
    ["tags", () => st().loadTags([named("s1", "Server")] as never)],
  ] as const;

  it.each(cases)("%s: keeps a locally created entity the server has never seen", (key, load) => {
    st().stageNew(key as never, named("n1", "Mine") as never);
    load();

    // The new one survives a reload; losing it would discard unsaved work on
    // every background refetch.
    expect(mapFor(key).n1?.isNew).toBe(true);
    expect(mapFor(key).s1).toBeDefined();
  });

  it.each(cases)("%s: keeps a local edit rather than overwriting it with server data", (key, load) => {
    st().stageNew(key as never, named("s1", "Server") as never);
    st().markClean(key as never, ["s1"]);
    st().stageUpdate(key as never, "s1", { name: "Edited" } as never);

    load();

    expect(mapFor(key).s1?.entity.name).toBe("Edited");
    expect(mapFor(key).s1?.isUpdated).toBe(true);
  });

  it.each(cases)("%s: replaces an untouched entity with the server's version", (key, load) => {
    st().stageNew(key as never, named("s1", "Stale") as never);
    st().markClean(key as never, ["s1"]);

    load();

    expect(mapFor(key).s1?.entity.name).toBe("Server");
    expect(mapFor(key).s1?.isNew).toBe(false);
  });

  it.each(cases)("%s: drops an untouched entity the server no longer has", (key, load) => {
    st().stageNew(key as never, named("gone", "Deleted elsewhere") as never);
    st().markClean(key as never, ["gone"]);

    load();

    expect(mapFor(key).gone).toBeUndefined();
  });
});

describe("loadCategoryGroups", () => {
  const st = () => useStagedStore.getState();

  it("replaces groups and categories together, preserving unsaved work in both", () => {
    // Groups and categories arrive from one read and must be replaced in one
    // update, or a category can briefly point at a group that is not there.
    st().stageNew("categoryGroups", { id: "g-new", name: "My group" } as never);
    st().stageNew("categories", { id: "c-new", name: "My category" } as never);

    st().loadCategoryGroups(
      [{ id: "g1", name: "Server group" } as never],
      [{ id: "c1", name: "Server category" } as never]
    );

    expect(st().categoryGroups["g-new"].isNew).toBe(true);
    expect(st().categoryGroups.g1.entity.name).toBe("Server group");
    expect(st().categories["c-new"].isNew).toBe(true);
    expect(st().categories.c1.entity.name).toBe("Server category");
  });

  it("keeps a staged deletion on both maps, so a pending delete is not resurrected", () => {
    st().stageNew("categoryGroups", { id: "g1", name: "Group" } as never);
    st().stageNew("categories", { id: "c1", name: "Category" } as never);
    st().markClean("categoryGroups", ["g1"]);
    st().markClean("categories", ["c1"]);
    st().stageDelete("categoryGroups", "g1");
    st().stageDelete("categories", "c1");

    st().loadCategoryGroups(
      [{ id: "g1", name: "Group" } as never],
      [{ id: "c1", name: "Category" } as never]
    );

    expect(st().categoryGroups.g1.isDeleted).toBe(true);
    expect(st().categories.c1.isDeleted).toBe(true);
  });
});

// ─── Payee merges ─────────────────────────────────────────────────────────────

describe("stagePayeeMerge", () => {
  const st = () => useStagedStore.getState();

  it("marks the merged-away payees deleted and records the merge to perform", () => {
    for (const id of ["target", "dupe-1", "dupe-2"]) {
      st().stageNew("payees", { id, name: id } as never);
      st().markClean("payees", [id]);
    }

    st().stagePayeeMerge("target", ["dupe-1", "dupe-2"]);

    expect(st().payees["dupe-1"].isDeleted).toBe(true);
    expect(st().payees["dupe-2"].isDeleted).toBe(true);
    // The survivor is untouched — merging into it is not a change to it.
    expect(st().payees.target.isDeleted).toBe(false);
    expect(st().pendingPayeeMerges).toEqual([{ targetId: "target", mergeIds: ["dupe-1", "dupe-2"] }]);
  });

  it("accumulates independent merges rather than replacing the pending one", () => {
    st().stagePayeeMerge("t1", ["a"]);
    st().stagePayeeMerge("t2", ["b"]);
    expect(st().pendingPayeeMerges).toHaveLength(2);
  });

  it("clears only the merges that actually succeeded", () => {
    // A partial failure must leave the failed merge pending, or the user is
    // told the whole batch went through.
    st().stagePayeeMerge("t1", ["a"]);
    st().stagePayeeMerge("t2", ["b"]);

    st().clearPendingPayeeMerges(["t1"]);

    expect(st().pendingPayeeMerges).toEqual([{ targetId: "t2", mergeIds: ["b"] }]);
  });
});

// ─── Selectors ────────────────────────────────────────────────────────────────

describe("selectHasChanges", () => {
  const st = () => useStagedStore.getState();

  it("is false for a freshly loaded, untouched store", () => {
    st().loadAccounts([account("a1", "Checking")]);
    expect(selectHasChanges(useStagedStore.getState())).toBe(false);
  });

  it.each(["accounts", "payees", "categoryGroups", "categories", "rules", "schedules", "tags"] as const)(
    "notices an unsaved change in %s",
    (key) => {
      st().stageNew(key, { id: "x", name: "New" } as never);
      expect(selectHasChanges(useStagedStore.getState())).toBe(true);
    }
  );

  it("counts a pending payee merge as a change even with no dirty entity", () => {
    // The merge lives beside the entity maps; reading only those would show a
    // Save button that does nothing, or hide one that has work to do.
    st().stagePayeeMerge("target", []);
    expect(selectHasChanges(useStagedStore.getState())).toBe(true);
  });

  it("is false again once everything is marked clean", () => {
    st().stageNew("accounts", account("a1", "Checking"));
    expect(selectHasChanges(useStagedStore.getState())).toBe(true);
    st().markClean("accounts", ["a1"]);
    expect(selectHasChanges(useStagedStore.getState())).toBe(false);
  });
});

describe("selectCanUndo / selectCanRedo", () => {
  const st = () => useStagedStore.getState();

  it("reports nothing to undo or redo on a fresh store", () => {
    expect(selectCanUndo(useStagedStore.getState())).toBe(false);
    expect(selectCanRedo(useStagedStore.getState())).toBe(false);
  });

  it("offers undo after a snapshot, and redo only after that undo is taken", () => {
    st().pushUndo();
    st().stageNew("accounts", account("a1", "Checking"));
    expect(selectCanUndo(useStagedStore.getState())).toBe(true);
    expect(selectCanRedo(useStagedStore.getState())).toBe(false);

    st().undo();
    expect(selectCanUndo(useStagedStore.getState())).toBe(false);
    expect(selectCanRedo(useStagedStore.getState())).toBe(true);
  });

  it("offers neither after discarding everything", () => {
    st().pushUndo();
    st().stageNew("accounts", account("a1", "Checking"));
    st().discardAll();
    expect(selectCanUndo(useStagedStore.getState())).toBe(false);
    expect(selectCanRedo(useStagedStore.getState())).toBe(false);
  });
});
