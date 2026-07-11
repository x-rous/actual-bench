import {
  migrateConnectionState,
  toPersistedConnectionState,
  useConnectionStore,
  type BrowserApiConnection,
  type ConnectionInstance,
  type HttpApiConnection,
} from "./connection";

describe("connection store persistence", () => {
  it("drops legacy HTTP API connections so stored credentials are not rehydrated", () => {
    const migrated = migrateConnectionState({
      instances: [
        {
          id: "conn-1",
          label: "Family Fund",
          baseUrl: "https://api.example.com",
          apiKey: "api-key",
          budgetSyncId: "budget-1",
          encryptionPassword: "budget-password",
          apiVersion: "1.2.3",
          serverVersion: "25.4.0",
        },
      ],
      activeInstanceId: "conn-1",
    });

    expect(migrated).toEqual({ instances: [], activeInstanceId: null });
  });

  it("drops legacy Direct connections so stored passwords are not rehydrated", () => {
    const migrated = migrateConnectionState({
      state: {
        instances: [
          {
            id: "direct-1",
            mode: "browser-api",
            label: "Family Fund",
            baseUrl: "https://actual.example.com",
            serverPassword: "server-password",
            budgetSyncId: "budget-1",
            encryptionPassword: "budget-password",
          },
        ],
        activeInstanceId: "direct-1",
      },
    });

    expect(migrated).toEqual({ instances: [], activeInstanceId: null });
  });

  it("persists no active connection secrets from in-memory state", () => {
    const instance: ConnectionInstance = {
      id: "conn-1",
      mode: "http-api",
      label: "Family Fund",
      baseUrl: "https://api.example.com",
      apiKey: "api-key",
      budgetSyncId: "budget-1",
      encryptionPassword: "budget-password",
      apiVersion: "1.2.3",
      serverVersion: "25.4.0",
    };

    expect(
      toPersistedConnectionState({ instances: [instance], activeInstanceId: instance.id })
    ).toEqual({ instances: [], activeInstanceId: null });
  });
});

describe("addInstance - one connection per budget", () => {
  const direct: BrowserApiConnection = {
    id: "direct-1", mode: "browser-api", label: "My Budget",
    baseUrl: "https://budget.example.com", serverPassword: "pw", budgetSyncId: "budget-1",
  };
  const httpSameBudget: HttpApiConnection = {
    id: "http-1", mode: "http-api", label: "My Budget",
    baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "budget-1",
  };
  const otherBudget: HttpApiConnection = {
    id: "http-2", mode: "http-api", label: "Other Budget",
    baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "budget-2",
  };

  beforeEach(() => useConnectionStore.getState().clearAll());

  it("replaces an existing connection to the same budget instead of duplicating it", () => {
    const { addInstance } = useConnectionStore.getState();
    addInstance(direct);
    addInstance(httpSameBudget); // same budget, other transport
    const { instances } = useConnectionStore.getState();
    expect(instances).toHaveLength(1);
    expect(instances[0].id).toBe("http-1");
    expect(instances[0].mode).toBe("http-api");
  });

  it("makes the replacement active when it replaced the active connection", () => {
    const { addInstance, setActiveInstance } = useConnectionStore.getState();
    addInstance(direct);
    setActiveInstance("direct-1");
    addInstance(httpSameBudget);
    expect(useConnectionStore.getState().activeInstanceId).toBe("http-1");
  });

  it("keeps distinct budgets as separate connections", () => {
    const { addInstance } = useConnectionStore.getState();
    addInstance(direct);
    addInstance(otherBudget);
    expect(useConnectionStore.getState().instances).toHaveLength(2);
  });
});
