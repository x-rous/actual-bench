import {
  migrateConnectionState,
  toPersistedConnectionState,
  type ConnectionInstance,
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
