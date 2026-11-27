"use strict";

/**
 * Finds the sync server the Actual desktop app on this computer uses, so the
 * connect screen can offer it.
 *
 * Actual desktop keeps its settings in `global-store.json` in its user-data
 * folder. Two fields matter here:
 *
 *   * `server-url`: the server Actual desktop is set up with: its own local
 *     server (`http://localhost:<port>`) or an external one.
 *   * `syncServerConfig.port`: the port of its built-in local server, when the
 *     user started one ("Set up sync" → Start). The server always listens on
 *     127.0.0.1, default port 5007.
 *
 * The same file holds Actual's sign-in token (`user-token`). Only the two
 * fields above are read; nothing else from the file leaves this module.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Actual desktop's local server port when the user never changed it. */
const DEFAULT_ACTUAL_DESKTOP_PORT = 5007;

/**
 * Where Actual desktop's `global-store.json` may be, most likely first.
 * Electron names the user-data folder after the product name, "Actual".
 * The Microsoft Store build runs in a package container that redirects
 * `%APPDATA%` into `%LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming`.
 */
function candidateStorePaths({ platform, env, homedir, readdir = fs.readdirSync }) {
  const candidates = [];
  if (platform === "win32") {
    if (env.APPDATA) candidates.push(path.win32.join(env.APPDATA, "Actual", "global-store.json"));
    if (env.LOCALAPPDATA) {
      const packagesDir = path.win32.join(env.LOCALAPPDATA, "Packages");
      let packages = [];
      try {
        packages = readdir(packagesDir);
      } catch {
        packages = [];
      }
      for (const name of packages) {
        if (!/actual/i.test(name)) continue;
        candidates.push(
          path.win32.join(packagesDir, name, "LocalCache", "Roaming", "Actual", "global-store.json")
        );
      }
    }
  } else if (platform === "darwin") {
    candidates.push(path.posix.join(homedir, "Library", "Application Support", "Actual", "global-store.json"));
  } else {
    const configHome = env.XDG_CONFIG_HOME || path.posix.join(homedir, ".config");
    candidates.push(path.posix.join(configHome, "Actual", "global-store.json"));
  }
  return candidates;
}

/** A usable http(s) URL without a trailing slash, or null. */
function cleanServerUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.toString().replace(/\/+$/, "");
}

function validPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : null;
}

/**
 * The server Actual desktop is set up with, read from its settings.
 *
 * Returns `{ url, source }`:
 *   * `source: "server-url"`: the server Actual desktop is using now.
 *   * `source: "local-server"`: its built-in server's port, with no server
 *     chosen yet.
 *   * `source: "default"`: Actual desktop's settings were not found or not
 *     readable; the local server's default address.
 */
function findActualDesktopServer({
  platform = process.platform,
  env = process.env,
  homedir = require("node:os").homedir(),
  readFile = (file) => fs.readFileSync(file, "utf8"),
  readdir = fs.readdirSync,
} = {}) {
  for (const file of candidateStorePaths({ platform, env, homedir, readdir })) {
    let prefs;
    try {
      prefs = JSON.parse(readFile(file));
    } catch {
      continue;
    }
    if (!prefs || typeof prefs !== "object") continue;

    const serverUrl = cleanServerUrl(prefs["server-url"]);
    if (serverUrl) return { url: serverUrl, source: "server-url" };

    const port = validPort(prefs.syncServerConfig && prefs.syncServerConfig.port);
    if (port) return { url: `http://localhost:${port}`, source: "local-server" };
  }
  return { url: `http://localhost:${DEFAULT_ACTUAL_DESKTOP_PORT}`, source: "default" };
}

module.exports = {
  DEFAULT_ACTUAL_DESKTOP_PORT,
  candidateStorePaths,
  cleanServerUrl,
  findActualDesktopServer,
};
