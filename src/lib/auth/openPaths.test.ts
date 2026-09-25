import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { OPEN_API_PATHS, isOpenPath, safeNextPath } from "./openPaths";

const API_ROOT = join(process.cwd(), "src", "app", "api");

/** Every API route, as the path it answers on (dynamic segments kept as `[id]`). */
function apiRoutes(dir = API_ROOT): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return apiRoutes(full);
    if (entry !== "route.ts") return [];
    return [`/api/${relative(API_ROOT, dir).split(sep).join("/")}`];
  });
}

describe("open paths", () => {
  it("leaves only the listed API routes open; every other route needs sign-in", () => {
    const routes = apiRoutes();
    expect(routes.length).toBeGreaterThan(50);
    const open = routes.filter((route) => isOpenPath(route)).sort();
    expect(open).toEqual([...OPEN_API_PATHS].sort());
  });

  it("lists no open API path that no longer exists", () => {
    const routes = new Set(apiRoutes());
    for (const path of OPEN_API_PATHS) expect(routes).toContain(path);
  });

  it("opens the sign-in page and its assets, and nothing below the open routes", () => {
    expect(isOpenPath("/login")).toBe(true);
    expect(isOpenPath("/_next/static/chunks/app.js")).toBe(true);
    expect(isOpenPath("/.well-known/security.txt")).toBe(true);
    expect(isOpenPath("/connect")).toBe(false);
    expect(isOpenPath("/")).toBe(false);
    expect(isOpenPath("/api/connection-vault/servers")).toBe(false);
    expect(isOpenPath("/api/connection-vault/reset")).toBe(false);
    expect(isOpenPath("/api/health/../automations")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps a path on this site", () => {
    expect(safeNextPath("/budget-management?month=2026-09")).toBe("/budget-management?month=2026-09");
  });

  it("refuses anywhere else, and the sign-in page itself", () => {
    for (const next of [
      null,
      undefined,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r\n/evil.example",
      "login",
      "/login",
      "/login?next=/x",
    ]) {
      expect(safeNextPath(next)).toBe("/connect");
    }
  });
});
