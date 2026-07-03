import {
  isBrowserApiSavedServer,
  isHttpApiSavedServer,
  migrateSavedServersState,
} from "./savedServers";

describe("saved servers migration", () => {
  it("migrates legacy saved servers without a mode to Classic http-api", () => {
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
    if (!isHttpApiSavedServer(server)) throw new Error("Expected Classic saved server");
    expect(server.mode).toBe("http-api");
    expect(server.apiKey).toBe("api-key");
  });

  it("preserves Direct saved server credentials from persisted state wrappers", () => {
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
    expect(server.mode).toBe("browser-api");
    expect(server.serverPassword).toBe("server-password");
  });
});
