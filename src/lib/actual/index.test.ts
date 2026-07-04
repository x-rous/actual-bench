import { getAccounts } from "../api/accounts";
import { getBrowserApiRuntime, syncBrowserApiRuntime } from "./browser/runtime";
import { getTransport } from "./index";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { Account, Rule } from "@/types/entities";

jest.mock("../api/accounts", () => ({
  ...jest.requireActual("../api/accounts"),
  getAccounts: jest.fn(),
}));

jest.mock("./browser/runtime", () => ({
  getBrowserApiRuntime: jest.fn(),
  syncBrowserApiRuntime: jest.fn(),
}));

const mockGetAccounts = getAccounts as jest.MockedFunction<typeof getAccounts>;
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

describe("Actual transport factory", () => {
  beforeEach(() => {
    mockGetAccounts.mockReset();
    mockGetBrowserApiRuntime.mockReset();
    mockSyncBrowserApiRuntime.mockReset();
  });

  it("dispatches Classic connections to the HTTP API transport", () => {
    expect(getTransport(httpConnection).mode).toBe("http-api");
  });

  it("dispatches Direct connections to the browser API transport", () => {
    expect(getTransport(browserConnection).mode).toBe("browser-api");
  });

  it("Classic account reads delegate to the existing accounts API helper", async () => {
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
