import { getAccounts } from "../api/accounts";
import { getTransport } from "./index";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { Account } from "@/types/entities";

jest.mock("../api/accounts", () => ({
  getAccounts: jest.fn(),
}));

const mockGetAccounts = getAccounts as jest.MockedFunction<typeof getAccounts>;

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

  it("Direct account reads fail clearly until implemented", async () => {
    await expect(getTransport(browserConnection).getAccounts()).rejects.toThrow(
      "Direct browser API transport does not support getAccounts yet."
    );
    expect(mockGetAccounts).not.toHaveBeenCalled();
  });
});
