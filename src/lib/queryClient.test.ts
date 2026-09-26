import { QueryClient } from "@tanstack/react-query";
import { clearBudgetQueries } from "./queryClient";

describe("clearBudgetQueries", () => {
  it("drops the budget's caches and keeps the app's own", () => {
    const client = new QueryClient();
    client.setQueryData(["accounts", "conn-1"], []);
    client.setQueryData(["budgetPreferences", "conn-1"], {});
    client.setQueryData(["auth-status"], { unlocked: true });
    client.setQueryData(["remembered-servers"], { servers: [] });
    client.setQueryData(["vault-state"], { status: "ready" });

    clearBudgetQueries(client);

    expect(client.getQueryData(["accounts", "conn-1"])).toBeUndefined();
    expect(client.getQueryData(["budgetPreferences", "conn-1"])).toBeUndefined();
    expect(client.getQueryData(["auth-status"])).toEqual({ unlocked: true });
    expect(client.getQueryData(["remembered-servers"])).toEqual({ servers: [] });
    expect(client.getQueryData(["vault-state"])).toEqual({ status: "ready" });
  });
});
