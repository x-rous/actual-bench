import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BudgetBatchError, useBudgetSave } from "./useBudgetSave";
import { useBudgetEditsStore } from "../../../store/budgetEdits";
import type { ConnectionInstance } from "../../../store/connection";
import type {
  BudgetCellKey,
  BudgetSaveResult,
  StagedBudgetEdit,
  StagedHold,
} from "../types";

const mockGetTransport = jest.fn();

jest.mock("../../../lib/actual", () => ({
  getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
}));

let mockActiveConnection: ConnectionInstance = {
  id: "conn-1",
  label: "Direct",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "password",
  budgetSyncId: "budget-1",
};

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => mockActiveConnection),
  selectActiveInstance: jest.fn(),
}));

/**
 * Mirrors the app's real client (`src/lib/queryClient.ts`), which sets
 * `staleTime: Infinity` - without it `fetchQuery` in the save pre-flight
 * refetches and overwrites cached month state that production would keep.
 */
function makeAppLikeClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** `budgeted` for cat-1 is what the *server* holds, overridable per test. */
function makeRawMonth(catOneBudgeted = 100) {
  return {
    month: "2026-01",
    incomeAvailable: 0,
    lastMonthOverspent: 0,
    forNextMonth: 0,
    totalBudgeted: 0,
    toBudget: 0,
    fromLastMonth: 0,
    totalIncome: 0,
    totalSpent: 0,
    totalBalance: 0,
    categoryGroups: [
      {
        id: "group-1",
        name: "Expenses",
        is_income: false as const,
        hidden: false,
        budgeted: 0,
        spent: 0,
        balance: 0,
        categories: [
          {
            id: "cat-1",
            name: "Groceries",
            group_id: "group-1",
            is_income: false,
            hidden: false,
            budgeted: catOneBudgeted,
            spent: 0,
            balance: 100,
            carryover: false,
          },
          {
            id: "cat-2",
            name: "Dining",
            group_id: "group-1",
            is_income: false,
            hidden: false,
            budgeted: 50,
            spent: 0,
            balance: 50,
            carryover: false,
          },
        ],
      },
    ],
  };
}

function makeTransport(mode: "http-api" | "browser-api" = "browser-api") {
  return {
    mode,
    sync: jest.fn(() => Promise.resolve()),
    batchBudgetUpdates: jest.fn(async (operation: () => Promise<unknown>) => operation()),
    getBudgetMonths: jest.fn(() => Promise.resolve(["2026-01"])),
    getBudgetMonth: jest.fn(() => Promise.resolve(makeRawMonth())),
    setBudgetAmount: jest.fn(() => Promise.resolve()),
    holdBudgetForNextMonth: jest.fn(() => Promise.resolve()),
    resetBudgetHold: jest.fn(() => Promise.resolve()),
    transferBudget: jest.fn(() => Promise.resolve()),
  } as {
    mode: "http-api" | "browser-api";
    sync: jest.Mock;
    batchBudgetUpdates: jest.Mock;
    getBudgetMonths: jest.Mock;
    getBudgetMonth: jest.Mock;
    setBudgetAmount: jest.Mock;
    holdBudgetForNextMonth: jest.Mock;
    resetBudgetHold: jest.Mock;
    transferBudget: jest.Mock;
  };
}

describe("useBudgetSave", () => {
  beforeEach(() => {
    useBudgetEditsStore.getState().discardAll();
    mockGetTransport.mockReset();
    mockActiveConnection = {
      id: "conn-1",
      label: "Direct",
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      serverPassword: "password",
      budgetSyncId: "budget-1",
    };
  });

  afterEach(() => {
    useBudgetEditsStore.getState().discardAll();
  });

  it("saves Direct budget edits and holds through a transport budget batch without an extra sync", async () => {
    const transport = makeTransport();
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    };
    const hold: StagedHold = {
      month: "2026-01",
      previousAmount: 0,
      nextAmount: 25,
    };

    await act(async () => {
      await result.current.save(
        { ["2026-01:cat-1" as BudgetCellKey]: edit },
        { "2026-01": hold }
      );
    });

    expect(transport.getBudgetMonths).toHaveBeenCalledTimes(1);
    expect(transport.batchBudgetUpdates).toHaveBeenCalledTimes(1);
    expect(transport.holdBudgetForNextMonth).toHaveBeenCalledWith("2026-01", 25);
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
    expect(transport.sync).not.toHaveBeenCalled();
  });

  it("skips the write when the server already holds the value (F-146)", async () => {
    const transport = makeTransport();
    // The server really does hold 150 - the skip is only allowed against a
    // value confirmed by a fresh read, never against the cache alone.
    transport.getBudgetMonth.mockResolvedValue(makeRawMonth(150));
    mockGetTransport.mockReturnValue(transport);
    const client = makeAppLikeClient();

    // The server already has 150 for this cell - a bulk copy staged a value
    // that happens to match. Writing it costs a full round trip for nothing.
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], {
      summary: { month: "2026-01" },
      groupsById: {},
      groupOrder: [],
      categoriesById: { "cat-1": { id: "cat-1", budgeted: 150 } },
    });

    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "bulk-action",
    };
    useBudgetEditsStore.getState().stageEdit(edit);

    let results: Awaited<ReturnType<typeof result.current.save>> = [];
    await act(async () => {
      results = await result.current.save({ ["2026-01:cat-1" as BudgetCellKey]: edit }, {});
    });

    expect(transport.setBudgetAmount).not.toHaveBeenCalled();
    // Still reported as saved and cleared from the staged edits.
    expect(results).toEqual([
      { month: "2026-01", categoryId: "cat-1", status: "success" },
    ]);
    expect(useBudgetEditsStore.getState().edits["2026-01:cat-1"]).toBeUndefined();
  });

  it("still writes when the cached month state holds a different value", async () => {
    const transport = makeTransport();
    mockGetTransport.mockReturnValue(transport);
    const client = makeAppLikeClient();
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], {
      summary: { month: "2026-01" },
      groupsById: {},
      groupOrder: [],
      categoriesById: { "cat-1": { id: "cat-1", budgeted: 100 } },
    });

    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });
    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    };

    await act(async () => {
      await result.current.save({ ["2026-01:cat-1" as BudgetCellKey]: edit }, {});
    });

    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
  });

  it("writes when the cache claims a match but the server disagrees", async () => {
    // The regression this guards: `staleTime: Infinity` plus no refetch on
    // focus means another client's write is invisible to the cache. Trusting it
    // would clear the staged edit and leave the server on the old value.
    const transport = makeTransport();
    transport.getBudgetMonth.mockResolvedValue(makeRawMonth(70)); // server truth
    mockGetTransport.mockReturnValue(transport);
    const client = makeAppLikeClient();
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], {
      summary: { month: "2026-01" },
      groupsById: {},
      groupOrder: [],
      categoriesById: { "cat-1": { id: "cat-1", budgeted: 150 } }, // stale
    });

    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });
    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "bulk-action",
    };

    await act(async () => {
      await result.current.save({ ["2026-01:cat-1" as BudgetCellKey]: edit }, {});
    });

    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
  });

  it("makes no verification request when nothing looks skippable", async () => {
    const transport = makeTransport();
    mockGetTransport.mockReturnValue(transport);
    const client = makeAppLikeClient();
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], {
      summary: { month: "2026-01" },
      groupsById: {},
      groupOrder: [],
      categoriesById: { "cat-1": { id: "cat-1", budgeted: 100 } },
    });

    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });
    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    };

    await act(async () => {
      await result.current.save({ ["2026-01:cat-1" as BudgetCellKey]: edit }, {});
    });

    // Cache says 100, the edit writes 150 - nothing looks skippable, so no
    // month is read to verify anything. Hand-typed edits pay nothing for a
    // feature that only helps bulk copies.
    expect(transport.getBudgetMonth).not.toHaveBeenCalled();
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
  });

  it("writes when the cache does not confirm the staged value", async () => {
    const transport = makeTransport();
    mockGetTransport.mockReturnValue(transport);
    const client = makeAppLikeClient();

    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });
    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    };

    await act(async () => {
      await result.current.save({ ["2026-01:cat-1" as BudgetCellKey]: edit }, {});
    });

    // Nothing was seeded; the pre-flight probe repopulates the cache and its
    // value differs, so the write must still happen. Not knowing the server
    // value is not the same as knowing it matches.
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
  });

  it("saves complete transfer pairs through transferBudget", async () => {
    const transport = makeTransport();
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    const src: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 75,
      source: "transfer",
      transferGroupId: "transfer-1",
    };
    const dst: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-2",
      previousBudgeted: 50,
      nextBudgeted: 75,
      source: "transfer",
      transferGroupId: "transfer-1",
    };

    let saveResults: BudgetSaveResult[] = [];
    await act(async () => {
      saveResults = await result.current.save({
        ["2026-01:cat-1" as BudgetCellKey]: src,
        ["2026-01:cat-2" as BudgetCellKey]: dst,
      });
    });

    expect(transport.transferBudget).toHaveBeenCalledWith("2026-01", {
      fromCategoryId: "cat-1",
      toCategoryId: "cat-2",
      amount: 25,
    });
    expect(transport.setBudgetAmount).not.toHaveBeenCalled();
    expect(saveResults).toEqual([
      { month: "2026-01", categoryId: "cat-1", status: "success" },
      { month: "2026-01", categoryId: "cat-2", status: "success" },
    ]);
  });

  it("writes absolute values when the server changed a transfer leg since it was cached", async () => {
    const transport = makeTransport();
    // The server now holds 130 for cat-1, although the cache still says 100.
    transport.getBudgetMonth.mockResolvedValue(makeRawMonth(130));
    mockGetTransport.mockReturnValue(transport);
    const client = makeAppLikeClient();
    client.setQueryData(["budget-month-data", "conn-1", "2026-01"], {
      summary: { month: "2026-01" },
      groupsById: {},
      groupOrder: [],
      categoriesById: {
        "cat-1": { id: "cat-1", budgeted: 100 },
        "cat-2": { id: "cat-2", budgeted: 50 },
      },
    });
    const { result } = renderHook(() => useBudgetSave(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.save({
        ["2026-01:cat-1" as BudgetCellKey]: {
          month: "2026-01", categoryId: "cat-1", previousBudgeted: 100, nextBudgeted: 80,
          source: "transfer", transferGroupId: "transfer-1",
        },
        ["2026-01:cat-2" as BudgetCellKey]: {
          month: "2026-01", categoryId: "cat-2", previousBudgeted: 50, nextBudgeted: 70,
          source: "transfer", transferGroupId: "transfer-1",
        },
      });
    });

    expect(transport.transferBudget).not.toHaveBeenCalled();
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 80);
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-2", 70);
  });

  it("checks each edit's category against its own month", async () => {
    const transport = makeTransport();
    transport.getBudgetMonths.mockResolvedValue(["2026-01", "2026-02"]);
    // cat-3 exists from February only.
    transport.getBudgetMonth.mockImplementation(async (month: string) => {
      const raw = { ...makeRawMonth(), month };
      if (month === "2026-02") {
        raw.categoryGroups = [{
          ...raw.categoryGroups[0]!,
          categories: [...raw.categoryGroups[0]!.categories, {
            id: "cat-3", name: "New", group_id: "group-1", is_income: false, hidden: false,
            budgeted: 0, spent: 0, balance: 0, carryover: false,
          }],
        }];
      }
      return raw;
    });
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), { wrapper: makeWrapper(client) });

    let saveResults: BudgetSaveResult[] = [];
    await act(async () => {
      saveResults = await result.current.save({
        ["2026-01:cat-1" as BudgetCellKey]: {
          month: "2026-01", categoryId: "cat-1", previousBudgeted: 100, nextBudgeted: 150, source: "manual",
        },
        ["2026-02:cat-3" as BudgetCellKey]: {
          month: "2026-02", categoryId: "cat-3", previousBudgeted: 0, nextBudgeted: 40, source: "manual",
        },
      });
    });

    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-02", "cat-3", 40);
    expect(saveResults.every((r) => r.status === "success")).toBe(true);
  });

  it("writes absolute values when a transfer leg also carries a hand edit (C1)", async () => {
    const transport = makeTransport();
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    // Server: cat-1 = 100, cat-2 = 50. The user typed 200 into cat-1, then
    // transferred 50 from cat-1 to cat-2. The store keeps the server baseline.
    const src: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "transfer",
      transferGroupId: "transfer-1",
    };
    const dst: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-2",
      previousBudgeted: 50,
      nextBudgeted: 100,
      source: "transfer",
      transferGroupId: "transfer-1",
    };

    await act(async () => {
      await result.current.save({
        ["2026-01:cat-1" as BudgetCellKey]: src,
        ["2026-01:cat-2" as BudgetCellKey]: dst,
      });
    });

    expect(transport.transferBudget).not.toHaveBeenCalled();
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-2", 100);
  });

  it("sets holds outside the budget batch from the current hold and reports a capped hold (C2, H5)", async () => {
    const transport = makeTransport();
    let inBatch = false;
    const calls: string[] = [];
    transport.batchBudgetUpdates.mockImplementation(async (operation: () => Promise<unknown>) => {
      inBatch = true;
      try {
        return await operation();
      } finally {
        inBatch = false;
      }
    });
    transport.resetBudgetHold.mockImplementation(async () => {
      calls.push(`reset:${inBatch}`);
    });
    transport.holdBudgetForNextMonth.mockImplementation(async (_m: string, amount: number) => {
      calls.push(`hold:${amount}:${inBatch}`);
    });
    // The server already holds 100 (the staged previousAmount says 0). Raising
    // it to 300 must add only 200; Actual then caps the total at 250.
    transport.getBudgetMonth
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 100 })
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 250 });
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    let saveResults: BudgetSaveResult[] = [];
    await act(async () => {
      saveResults = await result.current.save(
        {},
        { "2026-01": { month: "2026-01", previousAmount: 0, nextAmount: 300 } }
      );
    });

    expect(calls).toEqual(["hold:200:false"]);
    expect(saveResults).toHaveLength(1);
    expect(saveResults[0]).toMatchObject({ month: "2026-01", status: "error" });
    expect(saveResults[0]!.message).toMatch(/held 2\.50 instead of 3\.00/);
    expect(result.current.isSaving).toBe(false);
  });

  it("lowers a hold by resetting first, outside the batch", async () => {
    const transport = makeTransport();
    let inBatch = false;
    const calls: string[] = [];
    transport.batchBudgetUpdates.mockImplementation(async (operation: () => Promise<unknown>) => {
      inBatch = true;
      try {
        return await operation();
      } finally {
        inBatch = false;
      }
    });
    transport.resetBudgetHold.mockImplementation(async () => {
      calls.push(`reset:${inBatch}`);
    });
    transport.holdBudgetForNextMonth.mockImplementation(async (_m: string, amount: number) => {
      calls.push(`hold:${amount}:${inBatch}`);
    });
    transport.getBudgetMonth
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 300 })
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 100 });
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    let saveResults: BudgetSaveResult[] = [];
    await act(async () => {
      saveResults = await result.current.save(
        {},
        { "2026-01": { month: "2026-01", previousAmount: 300, nextAmount: 100 } }
      );
    });

    expect(calls).toEqual(["reset:false", "hold:100:false"]);
    expect(saveResults).toEqual([{ month: "2026-01", categoryId: "", status: "success" }]);
    // A hold-only save has no cell edits, so no budget batch is opened.
    expect(transport.batchBudgetUpdates).not.toHaveBeenCalled();
  });

  it("keeps a short hold staged with its error so Retry Failed can retry it", async () => {
    const transport = makeTransport();
    transport.getBudgetMonth
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 0 })
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 250 });
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useBudgetSave(), { wrapper: makeWrapper(client) });
    useBudgetEditsStore.getState().stageHold({ month: "2026-01", previousAmount: 0, nextAmount: 300 });

    let firstResults: BudgetSaveResult[] = [];
    await act(async () => {
      firstResults = await result.current.save({}, useBudgetEditsStore.getState().holds);
    });

    // Retry Failed picks holds by an error row with an empty categoryId.
    expect(firstResults).toEqual([
      expect.objectContaining({ month: "2026-01", categoryId: "", status: "error" }),
    ]);
    // The draft's baseline is now what Actual really holds; the target stays.
    expect(useBudgetEditsStore.getState().holds["2026-01"]).toMatchObject({
      previousAmount: 250,
      nextAmount: 300,
      saveError: expect.stringMatching(/held 2\.50 instead of 3\.00/),
    });
    // Actual still changed the month, so it is refreshed.
    expect(invalidate).toHaveBeenCalled();

    // Retry once To Budget has room: only the missing 0.50 is sent, and the
    // draft is removed after the read-back confirms 3.00.
    transport.getBudgetMonth
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 250 })
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 300 });
    transport.holdBudgetForNextMonth.mockClear();
    await act(async () => {
      await result.current.save({}, useBudgetEditsStore.getState().holds);
    });

    expect(transport.holdBudgetForNextMonth).toHaveBeenCalledTimes(1);
    expect(transport.holdBudgetForNextMonth).toHaveBeenCalledWith("2026-01", 50);
    expect(useBudgetEditsStore.getState().holds["2026-01"]).toBeUndefined();
  });

  it("stages a clear for Free after a short hold, because Actual still holds the short amount", async () => {
    const transport = makeTransport();
    transport.getBudgetMonth
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 0 })
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 250 });
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), { wrapper: makeWrapper(client) });
    useBudgetEditsStore.getState().stageHold({ month: "2026-01", previousAmount: 0, nextAmount: 300 });

    await act(async () => {
      await result.current.save({}, useBudgetEditsStore.getState().holds);
    });
    useBudgetEditsStore.getState().stageHold({ month: "2026-01", previousAmount: 0, nextAmount: 0 });

    expect(useBudgetEditsStore.getState().holds["2026-01"]).toMatchObject({
      previousAmount: 250,
      nextAmount: 0,
    });
  });

  it("does not report a hold saved when it cannot be read back", async () => {
    const transport = makeTransport();
    transport.getBudgetMonth
      .mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 0 })
      .mockRejectedValueOnce(new Error("offline"));
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useBudgetSave(), { wrapper: makeWrapper(client) });
    useBudgetEditsStore.getState().stageHold({ month: "2026-01", previousAmount: 0, nextAmount: 300 });

    let saveResults: BudgetSaveResult[] = [];
    await act(async () => {
      saveResults = await result.current.save({}, useBudgetEditsStore.getState().holds);
    });

    expect(saveResults[0]).toMatchObject({ status: "error" });
    expect(useBudgetEditsStore.getState().holds["2026-01"]?.saveError).toMatch(/could not be checked/);
  });

  it("refreshes the month when a hold reset succeeds but the new hold fails", async () => {
    const transport = makeTransport();
    transport.getBudgetMonth.mockResolvedValueOnce({ ...makeRawMonth(), forNextMonth: 300 });
    transport.holdBudgetForNextMonth.mockRejectedValue(new Error("hold failed"));
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useBudgetSave(), { wrapper: makeWrapper(client) });
    useBudgetEditsStore.getState().stageHold({ month: "2026-01", previousAmount: 300, nextAmount: 100 });

    await act(async () => {
      await result.current.save({}, useBudgetEditsStore.getState().holds);
    });

    expect(transport.resetBudgetHold).toHaveBeenCalled();
    // The reset went through: the draft's baseline follows the live hold (0).
    expect(useBudgetEditsStore.getState().holds["2026-01"]).toMatchObject({
      previousAmount: 0,
      saveError: "hold failed",
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("clears saved holds and still rejects when the budget batch fails", async () => {
    const transport = makeTransport();
    let held = 0;
    transport.holdBudgetForNextMonth.mockImplementation(async (_m: string, amount: number) => {
      held += amount;
    });
    transport.getBudgetMonth.mockImplementation(async () => ({ ...makeRawMonth(), forNextMonth: held }));
    transport.batchBudgetUpdates.mockRejectedValue(new Error("batch failed"));
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), { wrapper: makeWrapper(client) });
    useBudgetEditsStore.getState().stageHold({ month: "2026-01", previousAmount: 0, nextAmount: 25 });
    useBudgetEditsStore.getState().stageEdit({
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    });
    const { edits, holds } = useBudgetEditsStore.getState();

    let error: unknown = null;
    await act(async () => {
      await result.current.save(edits, holds).catch((err: unknown) => {
        error = err;
      });
    });

    expect(error).toBeInstanceOf(BudgetBatchError);
    expect((error as unknown as BudgetBatchError).message).toBe("batch failed");
    // The hold ran before the batch; its result travels with the rejection.
    expect((error as unknown as BudgetBatchError).holdResults).toEqual([
      { month: "2026-01", categoryId: "", status: "success" },
    ]);
    expect(useBudgetEditsStore.getState().holds["2026-01"]).toBeUndefined();
    expect(useBudgetEditsStore.getState().edits["2026-01:cat-1" as BudgetCellKey]).toBeDefined();
    expect(result.current.isSaving).toBe(false);
  });

  it("keeps rejected staged edits in the store with a save error", async () => {
    const transport = makeTransport();
    transport.setBudgetAmount.mockRejectedValue(new Error("write failed"));
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    const key = "2026-01:cat-1" as BudgetCellKey;
    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    };
    useBudgetEditsStore.getState().stageEdit(edit);

    let saveResults: BudgetSaveResult[] = [];
    await act(async () => {
      saveResults = await result.current.save(useBudgetEditsStore.getState().edits);
    });

    expect(saveResults).toEqual([
      { month: "2026-01", categoryId: "cat-1", status: "error", message: "write failed" },
    ]);
    expect(useBudgetEditsStore.getState().edits[key]).toMatchObject({
      nextBudgeted: 150,
      saveError: "write failed",
    });
  });

  it("does not sync after an HTTP API budget save", async () => {
    mockActiveConnection = {
      id: "conn-http",
      label: "HTTP API",
      mode: "http-api",
      baseUrl: "https://api.example.com",
      apiKey: "key",
      budgetSyncId: "budget-1",
    };
    const transport = makeTransport("http-api");
    mockGetTransport.mockReturnValue(transport);
    const client = new QueryClient();
    const { result } = renderHook(() => useBudgetSave(), {
      wrapper: makeWrapper(client),
    });

    const edit: StagedBudgetEdit = {
      month: "2026-01",
      categoryId: "cat-1",
      previousBudgeted: 100,
      nextBudgeted: 150,
      source: "manual",
    };

    await act(async () => {
      await result.current.save({ ["2026-01:cat-1" as BudgetCellKey]: edit });
    });

    expect(transport.setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 150);
    expect(transport.sync).not.toHaveBeenCalled();
  });
});
