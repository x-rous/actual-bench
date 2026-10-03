import { act, renderHook } from "@testing-library/react";
import { useStagedStore } from "../../../store/staged";
import { useAccountGroupActions } from "./useAccountGroupActions";

const store = () => useStagedStore.getState();

function seed() {
  store().loadAccounts([
    { id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" },
    { id: "a2", name: "Savings", offBudget: false, closed: false, groupId: "g1" },
    { id: "a3", name: "Cash", offBudget: false, closed: false, groupId: null },
  ]);
  store().loadAccountGroups([{ id: "g1", name: "Everyday" }]);
}

beforeEach(() => {
  store().discardAll();
  seed();
});
afterEach(() => store().discardAll());

describe("useAccountGroupActions", () => {
  it("creates a group and assigns the given accounts in one undo step", () => {
    const { result } = renderHook(() => useAccountGroupActions());
    let created!: ReturnType<typeof result.current.createGroup>;
    act(() => {
      created = result.current.createGroup("Brokerage", ["a3"]);
    });
    if (!("id" in created)) throw new Error("expected a group");
    expect(store().accountGroups[created.id]).toMatchObject({ isNew: true, entity: { name: "Brokerage" } });
    expect(store().accounts["a3"]?.entity.groupId).toBe(created.id);

    act(() => store().undo());
    expect(store().accountGroups[created.id]).toBeUndefined();
    expect(store().accounts["a3"]?.entity.groupId).toBeNull();
  });

  it("refuses a duplicate or empty name without staging anything", () => {
    const { result } = renderHook(() => useAccountGroupActions());
    expect(result.current.createGroup("everyday")).toEqual({ error: expect.stringMatching(/already exists/) });
    expect(result.current.createGroup(" ")).toEqual({ error: "Name is required" });
    expect(Object.keys(store().accountGroups)).toEqual(["g1"]);
    expect(store().undoStack).toHaveLength(0);
  });

  it("renames a group, and a no-op rename stages nothing", () => {
    const { result } = renderHook(() => useAccountGroupActions());
    expect(result.current.renameGroup("g1", "Everyday")).toBeNull();
    expect(store().accountGroups["g1"]?.isUpdated).toBe(false);
    expect(result.current.renameGroup("g1", "Daily")).toBeNull();
    expect(store().accountGroups["g1"]).toMatchObject({ isUpdated: true, entity: { name: "Daily" } });
  });

  it("deleting a group shows its accounts as ungrouped and undoes as one step", () => {
    const { result } = renderHook(() => useAccountGroupActions());
    act(() => result.current.deleteGroup("g1"));
    expect(store().accountGroups["g1"]?.isDeleted).toBe(true);
    expect(store().accounts["a1"]?.entity.groupId).toBeNull();
    expect(store().accounts["a2"]?.entity.groupId).toBeNull();

    act(() => store().undo());
    expect(store().accountGroups["g1"]?.isDeleted).toBe(false);
    expect(store().accounts["a1"]?.entity.groupId).toBe("g1");
  });

  it("deleting a group that was never saved just removes it", () => {
    const { result } = renderHook(() => useAccountGroupActions());
    let created!: ReturnType<typeof result.current.createGroup>;
    act(() => {
      created = result.current.createGroup("Temp", ["a3"]);
    });
    if (!("id" in created)) throw new Error("expected a group");
    const createdId = created.id;
    act(() => result.current.deleteGroup(createdId));
    expect(store().accountGroups[createdId]).toBeUndefined();
    expect(store().accounts["a3"]?.entity.groupId).toBeNull();
  });

  it("assigns several accounts as one undo step and skips ones already in the group", () => {
    const { result } = renderHook(() => useAccountGroupActions());
    act(() => result.current.assignAccounts(["a1", "a3"], "g1"));
    expect(store().accounts["a1"]?.isUpdated).toBe(false); // already in g1
    expect(store().accounts["a3"]?.entity.groupId).toBe("g1");
    expect(store().undoStack).toHaveLength(1);

    act(() => result.current.assignAccounts(["a1", "a2"], null));
    expect(store().accounts["a1"]?.entity.groupId).toBeNull();
    expect(store().accounts["a2"]?.entity.groupId).toBeNull();
  });

  it("does nothing, and takes no undo step, when nothing would change", () => {
    const { result } = renderHook(() => useAccountGroupActions());
    act(() => result.current.assignAccounts(["a1"], "g1"));
    expect(store().undoStack).toHaveLength(0);
  });
});
