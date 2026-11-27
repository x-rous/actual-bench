"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { candidateStorePaths, findActualDesktopServer } = require("./actualDesktop.cjs");

function withStores(stores) {
  return {
    readFile: (file) => {
      if (!(file in stores)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return stores[file];
    },
    readdir: () => [],
  };
}

test("Windows: reads %APPDATA%\\Actual\\global-store.json", () => {
  const file = "C:\\Users\\a\\AppData\\Roaming\\Actual\\global-store.json";
  const result = findActualDesktopServer({
    platform: "win32",
    env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" },
    homedir: "C:\\Users\\a",
    ...withStores({ [file]: JSON.stringify({ syncServerConfig: { port: 5123 } }) }),
  });
  assert.deepEqual(result, { url: "http://localhost:5123", source: "local-server" });
});

test("Windows: also looks in Microsoft Store package folders", () => {
  const paths = candidateStorePaths({
    platform: "win32",
    env: { APPDATA: "C:\\R", LOCALAPPDATA: "C:\\L" },
    homedir: "C:\\Users\\a",
    readdir: () => ["Microsoft.Photos_8wekyb", "ActualBudget.Actual_abc123"],
  });
  assert.deepEqual(paths, [
    "C:\\R\\Actual\\global-store.json",
    "C:\\L\\Packages\\ActualBudget.Actual_abc123\\LocalCache\\Roaming\\Actual\\global-store.json",
  ]);
});

test("macOS: prefers the server Actual desktop is using", () => {
  const file = "/Users/a/Library/Application Support/Actual/global-store.json";
  const result = findActualDesktopServer({
    platform: "darwin",
    env: {},
    homedir: "/Users/a",
    ...withStores({
      [file]: JSON.stringify({
        "server-url": "https://actual.example.com/",
        "user-token": "secret-token",
        syncServerConfig: { port: 5007 },
      }),
    }),
  });
  assert.deepEqual(result, { url: "https://actual.example.com", source: "server-url" });
  assert.ok(!JSON.stringify(result).includes("secret-token"));
});

test("falls back to the default local server address", () => {
  const result = findActualDesktopServer({ platform: "linux", env: {}, homedir: "/home/a", ...withStores({}) });
  assert.deepEqual(result, { url: "http://localhost:5007", source: "default" });
});

test("falls back to the local port when the server URL has a query or fragment", () => {
  const file = "/home/a/.config/Actual/global-store.json";
  for (const serverUrl of ["https://actual.example.com/?x=1", "https://actual.example.com/#top"]) {
    const result = findActualDesktopServer({
      platform: "linux",
      env: {},
      homedir: "/home/a",
      ...withStores({ [file]: JSON.stringify({ "server-url": serverUrl, syncServerConfig: { port: 5123 } }) }),
    });
    assert.deepEqual(result, { url: "http://localhost:5123", source: "local-server" });
  }
});

test("ignores unreadable settings and unsafe values", () => {
  const file = "/home/a/.config/Actual/global-store.json";
  for (const contents of ["{not json", JSON.stringify({ "server-url": "javascript:alert(1)", syncServerConfig: { port: 70000 } })]) {
    const result = findActualDesktopServer({ platform: "linux", env: {}, homedir: "/home/a", ...withStores({ [file]: contents }) });
    assert.equal(result.source, "default");
  }
});
