import { getAccounts } from "../api/accounts";
import { getBrowserApiRuntime } from "./browser/runtime";
import { getTransport } from "./index";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { Account } from "@/types/entities";

jest.mock("../api/accounts", () => ({
  ...jest.requireActual("../api/accounts"),
  getAccounts: jest.fn(),
}));

jest.mock("./browser/runtime", () => ({
  getBrowserApiRuntime: jest.fn(),
}));

const mockGetAccounts = getAccounts as jest.MockedFunction<typeof getAccounts>;
const mockGetBrowserApiRuntime = getBrowserApiRuntime as jest.MockedFunction<
  typeof getBrowserApiRuntime
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
