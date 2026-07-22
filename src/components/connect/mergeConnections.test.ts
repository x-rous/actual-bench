import { serverFingerprint } from "@/lib/sync/connectionRef";
import type { ConnectionInstance } from "@/store/connection";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import { mergeConnections } from "./mergeConnections";

const HTTP_URL = "https://api.example.com";
const httpFp = serverFingerprint({ mode: "http-api", baseUrl: HTTP_URL });

function savedServer(): ServerCredentialMeta {
  return {
    serverFingerprint: httpFp,
    mode: "http-api",
    baseUrl: HTTP_URL,
    label: "Family API",
    createdAt: "t0",
    updatedAt: "t0",
  };
}

function savedBudget(budgetSyncId: string, name: string): RememberedBudget {
  return { serverFingerprint: httpFp, budgetSyncId, name, createdAt: "t0", lastOpenedAt: "t1" };
}

function instance(budgetSyncId: string, label: string): ConnectionInstance {
  return { id: `i-${budgetSyncId}`, mode: "http-api", label, baseUrl: HTTP_URL, budgetSyncId, apiKey: "k" };
}

describe("mergeConnections (RD-063)", () => {
  it("groups a saved server + budget into one server with a saved budget", () => {
    const merged = mergeConnections([], [savedServer()], [savedBudget("b1", "Main")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].savedServer).toBeDefined();
    expect(merged[0].budgets).toHaveLength(1);
    expect(merged[0].budgets[0]).toMatchObject({ budgetSyncId: "b1", name: "Main", saved: expect.any(Object) });
    expect(merged[0].budgets[0].instance).toBeUndefined();
  });

  it("dedupes a budget that is both open this session and saved", () => {
    const merged = mergeConnections([instance("b1", "Main")], [savedServer()], [savedBudget("b1", "Main")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].budgets).toHaveLength(1);
    const budget = merged[0].budgets[0];
    expect(budget.instance).toBeDefined();
    expect(budget.saved).toBeDefined();
  });

  it("adds a session-only server not present in the vault", () => {
    const merged = mergeConnections([instance("b9", "Scratch")], [], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].serverFingerprint).toBe(httpFp);
    expect(merged[0].savedServer).toBeUndefined();
    expect(merged[0].budgets[0]).toMatchObject({ budgetSyncId: "b9", name: "Scratch", instance: expect.any(Object) });
  });

  it("lists saved and session-only budgets together under their server", () => {
    const merged = mergeConnections([instance("b2", "Travel")], [savedServer()], [savedBudget("b1", "Main")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].budgets.map((b) => b.budgetSyncId).sort()).toEqual(["b1", "b2"]);
  });

  it("skips a saved budget whose server was forgotten", () => {
    const orphan: RememberedBudget = { ...savedBudget("b1", "Main"), serverFingerprint: "gone" };
    const merged = mergeConnections([], [savedServer()], [orphan]);
    expect(merged[0].budgets).toHaveLength(0);
  });

  it("prefers the saved name, falling back to the instance label then the sync id", () => {
    const merged = mergeConnections(
      [instance("b1", "Instance Label")],
      [savedServer()],
      [savedBudget("b1", "Saved Name")]
    );
    expect(merged[0].budgets[0].name).toBe("Saved Name");

    const sessionOnly = mergeConnections([instance("b3", "Only Label")], [], []);
    expect(sessionOnly[0].budgets[0].name).toBe("Only Label");
  });
});
