import {
  isBrowserApiConnection,
  isHttpApiConnection,
  migrateConnectionState,
} from "./connection";

describe("connection store migration", () => {
  it("migrates legacy connections without a mode to HTTP API mode", () => {
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

    expect(migrated.activeInstanceId).toBe("conn-1");
    expect(migrated.instances).toHaveLength(1);
    const [instance] = migrated.instances;
    expect(isHttpApiConnection(instance)).toBe(true);
    if (!isHttpApiConnection(instance)) throw new Error("Expected HTTP API connection");
    expect(instance.mode).toBe("http-api");
    expect(instance.apiKey).toBe("api-key");
    expect(instance.encryptionPassword).toBe("budget-password");
    expect(instance.apiVersion).toBe("1.2.3");
    expect(instance.serverVersion).toBe("25.4.0");
  });

  it("preserves Direct connections and restores them as active within the session", () => {
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

    expect(migrated.activeInstanceId).toBe("direct-1");
    expect(migrated.instances).toHaveLength(1);
    const [instance] = migrated.instances;
    expect(isBrowserApiConnection(instance)).toBe(true);
    if (!isBrowserApiConnection(instance)) throw new Error("Expected Direct connection");
    expect(instance.mode).toBe("browser-api");
    expect(instance.serverPassword).toBe("server-password");
    expect(instance.encryptionPassword).toBe("budget-password");
  });
});
