import { apiRequest } from "../api/client";
import { getBrowserApiRuntime } from "./browser/runtime";
import { createBrowserApiTransport } from "./browserApiTransport";
import { createHttpApiTransport } from "./httpApiTransport";
import { createFakeActualBudget } from "./testing/fakeActualBudget";
import type { SyncSourceTransaction } from "./transport";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";

jest.mock("./browser/runtime", () => ({
  getBrowserApiRuntime: jest.fn(),
  syncBrowserApiRuntime: jest.fn(),
}));
jest.mock("../api/client", () => ({ apiRequest: jest.fn() }));

const mockGetBrowserApiRuntime = getBrowserApiRuntime as jest.MockedFunction<typeof getBrowserApiRuntime>;
const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const directConnection: BrowserApiConnection = {
  id: "offset-history-direct",
  label: "Offset history Direct",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "pw",
  budgetSyncId: "budget-offset-direct",
};

const httpConnection: HttpApiConnection = {
  id: "offset-history-http",
  label: "Offset history HTTP",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "key",
  budgetSyncId: "budget-offset-http",
};

type BalancePoint = {
  date: string;
  totalBalanceMinor: number;
  clearedBalanceMinor: number;
};

/**
 * Feasibility oracle only. P1.5 will own the production service and its
 * snapshot/future-assumption cutoff; this proves the shared read contract has
 * enough exact minor-unit data to derive daily closing balances without using
 * HTTP-only `/balancehistory` or making any write.
 */
function dailyClosingBalances(rows: readonly SyncSourceTransaction[]): BalancePoint[] {
  const deltas = new Map<string, { total: number; cleared: number }>();
  for (const row of rows) {
    const day = deltas.get(row.date) ?? { total: 0, cleared: 0 };
    day.total += row.amount;
    if (row.cleared || row.reconciled) day.cleared += row.amount;
    deltas.set(row.date, day);
  }

  let totalBalanceMinor = 0;
  let clearedBalanceMinor = 0;
  return [...deltas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, delta]) => {
      totalBalanceMinor += delta.total;
      clearedBalanceMinor += delta.cleared;
      return { date, totalBalanceMinor, clearedBalanceMinor };
    });
}

describe("RD-084 Actual-linked offset history feasibility", () => {
  beforeEach(() => {
    mockGetBrowserApiRuntime.mockReset();
    mockApiRequest.mockReset();
  });

  it("derives identical exact daily balances from read-only Direct and HTTP histories", async () => {
    const accounts = [{ id: "offset", name: "Offset" }];
    const initialRows = [
      { id: "opening", account: "offset", date: "2024-01-01", amount: 100_000, cleared: true, reconciled: false },
      { id: "pending", account: "offset", date: "2024-01-02", amount: -10_000, cleared: false, reconciled: false },
      { id: "deposit", account: "offset", date: "2024-01-02", amount: 5_000, cleared: true, reconciled: false },
      { id: "split", account: "offset", date: "2024-01-03", amount: -2_000, cleared: false, reconciled: true, is_parent: true },
      { id: "split-a", account: "offset", date: "2024-01-03", amount: -1_200, parent_id: "split", is_child: true },
      { id: "split-b", account: "offset", date: "2024-01-03", amount: -800, parent_id: "split", is_child: true },
    ];

    const directBudget = createFakeActualBudget({ accounts, initialRows });
    mockGetBrowserApiRuntime.mockResolvedValue(directBudget.directRuntime() as never);
    const directRows = await createBrowserApiTransport(directConnection)
      .listTransactionsForSync({ accountId: "offset" });

    const httpBudget = createFakeActualBudget({ accounts, initialRows });
    mockApiRequest.mockImplementation(httpBudget.httpApiRequest as never);
    const httpRows = await createHttpApiTransport(httpConnection)
      .listTransactionsForSync({ accountId: "offset" });

    const expected: BalancePoint[] = [
      { date: "2024-01-01", totalBalanceMinor: 100_000, clearedBalanceMinor: 100_000 },
      { date: "2024-01-02", totalBalanceMinor: 95_000, clearedBalanceMinor: 105_000 },
      { date: "2024-01-03", totalBalanceMinor: 93_000, clearedBalanceMinor: 103_000 },
    ];
    expect(dailyClosingBalances(directRows)).toEqual(expected);
    expect(dailyClosingBalances(httpRows)).toEqual(expected);
    expect(directRows.find((row) => row.id === "split")?.splitLines).toHaveLength(2);
    expect(httpRows.find((row) => row.id === "split")?.splitLines).toHaveLength(2);
    expect(directBudget.insertOptions()).toEqual([]);
    expect(httpBudget.insertOptions()).toEqual([]);
  });
});
