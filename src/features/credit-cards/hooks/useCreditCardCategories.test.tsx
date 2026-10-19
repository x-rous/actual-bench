import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreditCardCategories } from "./useCreditCardDirectory";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("@/lib/actual", () => ({ getTransport: jest.fn() }));

it.each(["http-api", "browser-api"] as const)("reads the complete category directory through %s with budget-scoped cache keys", async (mode) => {
  const connection = { id: "connection", budgetSyncId: "budget", mode } as ConnectionInstance;
  const data = { groups: [], categories: [{ id: "unused", name: "Interest with no transactions", groupId: "group", hidden: false, isIncome: false }] };
  const read = jest.fn().mockResolvedValue(data);
  jest.mocked(getTransport).mockReturnValue({ getCategoryGroups: read } as unknown as ReturnType<typeof getTransport>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(({ enabled }) => useCreditCardCategories(connection, enabled), { wrapper, initialProps: { enabled: false } });
  expect(read).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.data).toEqual(data));
  expect(read).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(["categoryGroups", "connection", "budget"])).toEqual(data);
  expect(client.getQueryData(["categoryGroups", "connection", "other-budget"])).toBeUndefined();
  client.clear();
});
