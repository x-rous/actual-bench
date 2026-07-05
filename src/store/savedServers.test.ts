import {
  isBrowserApiSavedServer,
  isHttpApiSavedServer,
  migrateSavedServersState,
  toPersistedSavedServersState,
  type SavedServer,
} from "./savedServers";

describe("saved servers migration", () => {
  it("migrates legacy saved servers without restoring API keys", () => {
    const migrated = migrateSavedServersState({
      servers: [
        {
          id: "server-1",
          label: "api.example.com",
          baseUrl: "https://api.example.com",
          apiKey: "api-key",
        },
      ],
    });

    expect(migrated.servers).toHaveLength(1);
    const [server] = migrated.servers;
    expect(isHttpApiSavedServer(server)).toBe(true);
    if (!isHttpApiSavedServer(server)) throw new Error("Expected HTTP API saved server");
    expect(server).toEqual({
      id: "server-1",
      mode: "http-api",
      label: "api.example.com",
      baseUrl: "https://api.example.com",
    });
    expect(server).not.toHaveProperty("apiKey");
  });

  it("migrates Direct saved servers without restoring server passwords", () => {
    const migrated = migrateSavedServersState({
      state: {
        servers: [
          {
            id: "server-2",
            mode: "browser-api",
            label: "actual.example.com",
            baseUrl: "https://actual.example.com",
            serverPassword: "server-password",
          },
        ],
      },
    });

    expect(migrated.servers).toHaveLength(1);
    const [server] = migrated.servers;
    expect(isBrowserApiSavedServer(server)).toBe(true);
    if (!isBrowserApiSavedServer(server)) throw new Error("Expected Direct saved server");
    expect(server).toEqual({
      id: "server-2",
      mode: "browser-api",
      label: "actual.example.com",
      baseUrl: "https://actual.example.com",
    });
    expect(server).not.toHaveProperty("serverPassword");
  });

  it("persists only non-secret saved server metadata", () => {
    const savedServers = [
      {
        id: "server-1",
        mode: "http-api",
        label: "api.example.com",
        baseUrl: "https://api.example.com",
        apiKey: "api-key",
      },
      {
        id: "server-2",
        mode: "browser-api",
        label: "actual.example.com",
        baseUrl: "https://actual.example.com",
        serverPassword: "server-password",
      },
    ] as unknown as SavedServer[];

    expect(toPersistedSavedServersState({ servers: savedServers })).toEqual({
      servers: [
        {
          id: "server-1",
          mode: "http-api",
          label: "api.example.com",
          baseUrl: "https://api.example.com",
        },
        {
          id: "server-2",
          mode: "browser-api",
          label: "actual.example.com",
          baseUrl: "https://actual.example.com",
        },
      ],
    });
  });
});
