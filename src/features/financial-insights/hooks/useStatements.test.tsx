import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStatements } from "./useStatements";
import type { ReadyData } from "./useFinancialInsights";
import { readStatementEntries } from "@/lib/financial-insights/statementReads";

jest.mock("@/store/connection", () => ({ selectActiveInstance: (value: unknown) => value, useConnectionStore: (select: (value: unknown) => unknown) => select({ id: "one", budgetSyncId: "budget" }) }));
jest.mock("@/lib/financial-insights/statementReads", () => ({ readStatementEntries: jest.fn() }));
jest.mock("@/lib/financial-insights/statements", () => ({ buildStatements: () => ({}) }));

it("removes only inactive older snapshots after the new evidence has loaded", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = ["financial-insights", "statements", "one", "budget", "2026-01-01", "a", "b"];
  const current = ["financial-insights", "statements", "one", "budget", "2026-02-01", "a", "b"];
  const other = ["financial-insights", "statements", "two", "budget", "2026-01-01", "a", "b"];
  const newer = ["financial-insights", "statements", "one", "budget", "2026-03-01", "a", "b"];
  client.setQueryData(old, ["old"]); client.setQueryData(other, ["other"]); client.setQueryData(newer, ["newer"]);
  let resolve!: (value: []) => void;
  jest.mocked(readStatementEntries).mockReturnValue(new Promise((done) => { resolve = done; }));
  const data = { readAt: "2026-02-01", refreshing: false, period: { startDate: "a", endDate: "b" }, summary: { moneyKept: { state: "ready" } }, registry: {} } as unknown as ReadyData;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  renderHook(() => useStatements(data), { wrapper });
  expect(client.getQueryData(old)).toEqual(["old"]);
  resolve([]);
  await waitFor(() => expect(client.getQueryData(old)).toBeUndefined());
  expect(client.getQueryData(current)).toEqual([]);
  expect(client.getQueryData(other)).toEqual(["other"]);
  expect(client.getQueryData(newer)).toEqual(["newer"]);
});
