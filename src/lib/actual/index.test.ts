import { getAccounts } from "../api/accounts";
import {
  ensureBrowserApiBudgetOpen,
  getBrowserApiRuntime,
  syncBrowserApiRuntime,
} from "./browser/runtime";
import { ensureTransportReady, getTransport, settleTransportWrites } from "./index";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { Account, Rule } from "@/types/entities";
import type { ActualBenchTransport } from "./transport";

jest.mock("../api/accounts", () => ({
  ...jest.requireActual("../api/accounts"),
  getAccounts: jest.fn(),
}));

jest.mock("./browser/runtime", () => ({
  ensureBrowserApiBudgetOpen: jest.fn(),
  getBrowserApiRuntime: jest.fn(),
  syncBrowserApiRuntime: jest.fn(),
}));

const mockGetAccounts = getAccounts as jest.MockedFunction<typeof getAccounts>;
const mockEnsureBrowserApiBudgetOpen =
  ensureBrowserApiBudgetOpen as jest.MockedFunction<typeof ensureBrowserApiBudgetOpen>;
const mockGetBrowserApiRuntime = getBrowserApiRuntime as jest.MockedFunction<
  typeof getBrowserApiRuntime
>;
const mockSyncBrowserApiRuntime = syncBrowserApiRuntime as jest.MockedFunction<
  typeof syncBrowserApiRuntime
>;

const httpConnection: HttpApiConnection = {
  id: "conn-1",
  label: "Family Fund",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "api-key",
  budgetSyncId: "budget-1",
};

const browserConnection: BrowserApiConnection = {
  id: "conn-2",
  label: "Family Fund",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "server-password",
  budgetSyncId: "budget-1",
};

function createMockQueryBuilder() {
  const builder = {
    options: jest.fn(),
    filter: jest.fn(),
    select: jest.fn(),
    calculate: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    unfilter: jest.fn(),
    raw: jest.fn(),
    withDead: jest.fn(),
    withoutValidatedRefs: jest.fn(),
  };
  for (const method of Object.values(builder)) method.mockReturnValue(builder);
  return builder;
}

describe("Actual transport factory", () => {
  beforeEach(() => {
    mockGetAccounts.mockReset();
    mockEnsureBrowserApiBudgetOpen.mockReset();
    mockGetBrowserApiRuntime.mockReset();
    mockSyncBrowserApiRuntime.mockReset();
  });

  it("dispatches HTTP API connections to the HTTP API transport", () => {
    expect(getTransport(httpConnection).mode).toBe("http-api");
  });

  it("dispatches Direct connections to the browser API transport", () => {
    expect(getTransport(browserConnection).mode).toBe("browser-api");
  });

  it("ensures Direct readiness by opening the browser budget", async () => {
    mockEnsureBrowserApiBudgetOpen.mockResolvedValueOnce(undefined);

    await expect(ensureTransportReady(browserConnection)).resolves.toBeUndefined();

    expect(mockEnsureBrowserApiBudgetOpen).toHaveBeenCalledWith(browserConnection);
  });

  it("does not open a browser budget for HTTP API readiness", async () => {
    await expect(ensureTransportReady(httpConnection)).resolves.toBeUndefined();

    expect(mockEnsureBrowserApiBudgetOpen).not.toHaveBeenCalled();
  });

  it("settles HTTP transport writes in parallel", async () => {
    const transport = { mode: "http-api" } as ActualBenchTransport;
    let active = 0;
    let maxActive = 0;

    const results = await settleTransportWrites(transport, [1, 2], async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, value === 1 ? 15 : 0));
      active -= 1;
      return value * 2;
    });

    expect(maxActive).toBe(2);
    expect(results).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
    ]);
  });

  it("settles Direct transport writes sequentially without short-circuiting failures", async () => {
    const transport = { mode: "browser-api" } as ActualBenchTransport;
    const starts: number[] = [];
    const activeAtStart: number[] = [];
    let active = 0;

    const results = await settleTransportWrites(transport, [1, 2, 3], async (value) => {
      starts.push(value);
      activeAtStart.push(active);
      active += 1;
      await Promise.resolve();
      active -= 1;
      if (value === 2) throw new Error("boom");
      return value * 2;
    });

    expect(starts).toEqual([1, 2, 3]);
    expect(activeAtStart).toEqual([0, 0, 0]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 2 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 6 });
  });

  it("HTTP API account reads delegate to the existing accounts API helper", async () => {
    const accounts: Account[] = [
      { id: "account-1", name: "Checking", offBudget: false, closed: false },
    ];
    mockGetAccounts.mockResolvedValueOnce(accounts);

    await expect(getTransport(httpConnection).getAccounts()).resolves.toEqual(accounts);
    expect(mockGetAccounts).toHaveBeenCalledTimes(1);
    expect(mockGetAccounts).toHaveBeenCalledWith(httpConnection);
  });

  it("Direct account reads use the browser runtime and normalize account shape", async () => {
    mockGetBrowserApiRuntime.mockResolvedValue({
      getAccounts: jest.fn().mockResolvedValue([
        { id: "account-1", name: "Checking", offbudget: true, closed: false },
        { id: "account-2", name: "Savings", offbudget: false, closed: true },
        { id: null, name: "Broken" },
      ]),
    } as never);

    await expect(getTransport(browserConnection).getAccounts()).resolves.toEqual([
      { id: "account-1", name: "Checking", offBudget: true, closed: false },
      { id: "account-2", name: "Savings", offBudget: false, closed: true },
    ]);
    expect(mockGetAccounts).not.toHaveBeenCalled();
    expect(mockGetBrowserApiRuntime).toHaveBeenCalledWith(browserConnection);
  });

  it("Direct account creates use the browser runtime and convert the initial balance", async () => {
    const createAccount = jest.fn().mockResolvedValue("account-1");
    const closeAccount = jest.fn().mockResolvedValue(undefined);
    mockGetBrowserApiRuntime.mockResolvedValue({
      createAccount,
      closeAccount,
    } as never);

    await expect(
      getTransport(browserConnection).createAccount({
        name: "New Checking",
        offBudget: true,
        closed: true,
        initialBalance: 12.34,
      })
    ).resolves.toEqual({
      id: "account-1",
      name: "New Checking",
      offBudget: true,
      closed: true,
      initialBalance: 12.34,
    });

    expect(createAccount).toHaveBeenCalledWith(
      { name: "New Checking", offbudget: true, closed: false },
      1234
    );
    expect(closeAccount).toHaveBeenCalledWith("account-1");
  });

  it("Direct rule creates convert default stage and amount values for the browser API", async () => {
    const createRule = jest.fn().mockResolvedValue({
      id: "rule-1",
      stage: null,
      conditionsOp: "and",
      conditions: [{ field: "amount", op: "is", value: 1234 }],
      actions: [],
    });
    mockGetBrowserApiRuntime.mockResolvedValue({ createRule } as never);

    const rule: Omit<Rule, "id"> = {
      stage: "default",
      conditionsOp: "and",
      conditions: [{ field: "amount", op: "is", value: 12.34 }],
      actions: [],
    };

    await expect(getTransport(browserConnection).createRule(rule)).resolves.toEqual({
      id: "rule-1",
      stage: "default",
      conditionsOp: "and",
      conditions: [{ field: "amount", op: "is", value: 12.34 }],
      actions: [],
    });

    expect(createRule).toHaveBeenCalledWith({
      stage: null,
      conditionsOp: "and",
      conditions: [{ field: "amount", op: "is", value: 1234 }],
      actions: [],
    });
  });

  it("Direct transport sync delegates to the browser runtime sync queue", async () => {
    mockSyncBrowserApiRuntime.mockResolvedValueOnce(undefined);

    await getTransport(browserConnection).sync();

    expect(mockSyncBrowserApiRuntime).toHaveBeenCalledWith(browserConnection);
  });

  it("Direct budget reads delegate to the browser budget API", async () => {
    const getBudgetMonths = jest.fn().mockResolvedValue(["2026-01", "2026-02"]);
    const month = {
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
      categoryGroups: [],
    };
    const getBudgetMonth = jest.fn().mockResolvedValue(month);
    mockGetBrowserApiRuntime.mockResolvedValue({
      getBudgetMonths,
      getBudgetMonth,
    } as never);

    const transport = getTransport(browserConnection);

    await expect(transport.getBudgetMonths()).resolves.toEqual(["2026-01", "2026-02"]);
    await expect(transport.getBudgetMonth("2026-01")).resolves.toBe(month);
    expect(getBudgetMonths).toHaveBeenCalledTimes(1);
    expect(getBudgetMonth).toHaveBeenCalledWith("2026-01");
  });

  it("Direct budget writes run inside the browser budget batch and round minor-unit amounts", async () => {
    const batchBudgetUpdates = jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    });
    const setBudgetAmount = jest.fn().mockResolvedValue(undefined);
    mockGetBrowserApiRuntime.mockResolvedValue({
      batchBudgetUpdates,
      setBudgetAmount,
    } as never);

    const transport = getTransport(browserConnection);
    await transport.batchBudgetUpdates(async () => {
      await transport.setBudgetAmount("2026-01", "cat-1", 123.6);
    });

    expect(batchBudgetUpdates).toHaveBeenCalledTimes(1);
    expect(setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-1", 124);
  });

  it("Direct category transfers bridge to final budget amounts", async () => {
    const setBudgetAmount = jest.fn().mockResolvedValue(undefined);
    const getBudgetMonth = jest.fn().mockResolvedValue({
      month: "2026-01",
      categoryGroups: [
        {
          id: "group-1",
          name: "Expenses",
          is_income: false,
          hidden: false,
          budgeted: 0,
          spent: 0,
          balance: 0,
          categories: [
            { id: "cat-from", name: "From", group_id: "group-1", is_income: false, budgeted: 1000 },
            { id: "cat-to", name: "To", group_id: "group-1", is_income: false, budgeted: 250 },
          ],
        },
      ],
    });
    mockGetBrowserApiRuntime.mockResolvedValue({
      getBudgetMonth,
      setBudgetAmount,
    } as never);

    await getTransport(browserConnection).transferBudget("2026-01", {
      fromCategoryId: "cat-from",
      toCategoryId: "cat-to",
      amount: 125,
    });

    expect(setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-from", 875);
    expect(setBudgetAmount).toHaveBeenCalledWith("2026-01", "cat-to", 375);
  });

  it("Direct runQuery adapts supported wrapped ActualQL JSON into browser q() calls", async () => {
    const builder = createMockQueryBuilder();
    const q = jest.fn().mockReturnValue(builder);
    const aqlQuery = jest.fn().mockResolvedValue({ data: [] });
    mockGetBrowserApiRuntime.mockResolvedValue({ q, aqlQuery } as never);

    const body = {
      ActualQLquery: {
        table: "transactions",
        options: { splits: "inline" },
        filter: { account: "account-1" },
        select: ["id", "date"],
        groupBy: ["account"],
        orderBy: [{ date: "desc" }],
        limit: 10,
      },
    };

    await expect(getTransport(browserConnection).runQuery(body)).resolves.toEqual({ data: [] });

    expect(q).toHaveBeenCalledWith("transactions");
    expect(builder.options).toHaveBeenCalledWith({ splits: "inline" });
    expect(builder.filter).toHaveBeenCalledWith({ account: "account-1" });
    expect(builder.select).toHaveBeenCalledWith(["id", "date"]);
    expect(builder.groupBy).toHaveBeenCalledWith("account");
    expect(builder.orderBy).toHaveBeenCalledWith({ date: "desc" });
    expect(builder.limit).toHaveBeenCalledWith(10);
    expect(builder.offset).not.toHaveBeenCalled();
    expect(aqlQuery).toHaveBeenCalledWith(builder);
  });

  it("Direct runQuery adapts bare query JSON arrays, flags, and unfilter", async () => {
    const builder = createMockQueryBuilder();
    const q = jest.fn().mockReturnValue(builder);
    const aqlQuery = jest.fn().mockResolvedValue({ data: [] });
    mockGetBrowserApiRuntime.mockResolvedValue({ q, aqlQuery } as never);

    await expect(
      getTransport(browserConnection).runQuery({
        table: "transactions",
        filter: [{ account: "account-1" }, { date: { $gte: "2026-01-01" } }],
        groupBy: ["account", "account.name"],
        orderBy: [{ date: "desc" }, "account.name"],
        select: ["account", "account.name", { total: { $sum: "$amount" } }],
        offset: 5,
        unfilter: "date",
        raw: true,
        withDead: true,
        withoutValidatedRefs: true,
      })
    ).resolves.toEqual({ data: [] });

    expect(q).toHaveBeenCalledWith("transactions");
    expect(builder.filter).toHaveBeenNthCalledWith(1, { account: "account-1" });
    expect(builder.filter).toHaveBeenNthCalledWith(2, { date: { $gte: "2026-01-01" } });
    expect(builder.groupBy).toHaveBeenNthCalledWith(1, "account");
    expect(builder.groupBy).toHaveBeenNthCalledWith(2, "account.name");
    expect(builder.orderBy).toHaveBeenNthCalledWith(1, { date: "desc" });
    expect(builder.orderBy).toHaveBeenNthCalledWith(2, "account.name");
    expect(builder.offset).toHaveBeenCalledWith(5);
    expect(builder.limit).not.toHaveBeenCalled();
    expect(builder.unfilter).toHaveBeenCalledWith(["date"]);
    expect(builder.raw).toHaveBeenCalledTimes(1);
    expect(builder.withDead).toHaveBeenCalledTimes(1);
    expect(builder.withoutValidatedRefs).toHaveBeenCalledTimes(1);
    expect(aqlQuery).toHaveBeenCalledWith(builder);
  });

  it("Direct runQuery falls back to deprecated browser runQuery when aqlQuery is unavailable", async () => {
    const builder = createMockQueryBuilder();
    const runQuery = jest.fn().mockResolvedValue({ data: 3 });
    mockGetBrowserApiRuntime.mockResolvedValue({
      q: jest.fn().mockReturnValue(builder),
      runQuery,
    } as never);

    await expect(
      getTransport(browserConnection).runQuery({ ActualQLquery: { table: "payees" } })
    ).resolves.toEqual({ data: 3 });

    expect(runQuery).toHaveBeenCalledWith(builder);
  });

  it("Direct runQuery rejects unsupported ActualQL fields before execution", async () => {
    const builder = createMockQueryBuilder();
    const aqlQuery = jest.fn();
    mockGetBrowserApiRuntime.mockResolvedValue({
      q: jest.fn().mockReturnValue(builder),
      aqlQuery,
    } as never);

    await expect(
      getTransport(browserConnection).runQuery({
        ActualQLquery: { table: "transactions", join: ["accounts"] },
      })
    ).rejects.toThrow("Direct browser API query adapter does not support ActualQL field: join");
    expect(aqlQuery).not.toHaveBeenCalled();
  });

  it("Direct runQuery validates limit and offset before execution", async () => {
    const builder = createMockQueryBuilder();
    const aqlQuery = jest.fn();
    mockGetBrowserApiRuntime.mockResolvedValue({
      q: jest.fn().mockReturnValue(builder),
      aqlQuery,
    } as never);

    await expect(
      getTransport(browserConnection).runQuery({
        ActualQLquery: { table: "transactions", limit: Number.MAX_SAFE_INTEGER + 1 },
      })
    ).rejects.toThrow("ActualQLquery.limit to be a non-negative safe integer");
    await expect(
      getTransport(browserConnection).runQuery({
        ActualQLquery: { table: "transactions", offset: -1 },
      })
    ).rejects.toThrow("ActualQLquery.offset to be a non-negative safe integer");
    expect(aqlQuery).not.toHaveBeenCalled();
  });

  it("Direct account balances are converted from cents without using fetch", async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    mockGetBrowserApiRuntime.mockResolvedValue({
      getAccounts: jest.fn().mockResolvedValue([
        { id: "account-1", name: "Checking", offbudget: false, closed: false },
        { id: "account-2", name: "Savings", offbudget: false, closed: false },
      ]),
      getAccountBalance: jest
        .fn()
        .mockResolvedValueOnce(12345)
        .mockResolvedValueOnce(-250),
    } as never);

    try {
      const balances = await getTransport(browserConnection).getAccountBalances();
      expect([...balances.entries()]).toEqual([
        ["account-1", 123.45],
        ["account-2", -2.5],
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    }
  });
});
