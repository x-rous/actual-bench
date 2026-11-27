"use strict";

/**
 * Actual Bench desktop: starts the Bench server on this computer and shows it
 * in a window. Everything Bench stores (its database, the vault key, the
 * Direct runtime's budget copies) lives in this app's user-data folder.
 */

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { findActualDesktopServer } = require("./actualDesktop.cjs");
const { packageFamilyName } = require("./storeIdentity.cjs");
const {
  findFreePort,
  openServerLog,
  serverEnv,
  startServer,
  stopServer,
  waitForHealth,
} = require("./serverProcess.cjs");

const DOCS_URL = "https://x-rous.github.io/actual-bench/administration/desktop-app/";

/** The staged server and Node runtime: inside the app when packaged, `.stage/` in development. */
function resourcePaths() {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", ".stage");
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  return {
    serverDir: path.join(root, "server"),
    nodePath: path.join(root, "runtime", nodeName),
  };
}

const dataDir = () => path.join(app.getPath("userData"), "data");
const logDir = () => path.join(app.getPath("userData"), "logs");

/**
 * Where a folder in the user-data folder really is, for opening it in
 * Explorer. The Microsoft Store (MSIX) build runs in a package container that
 * redirects the app's `%APPDATA%` writes to
 * `%LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming`; the app itself
 * sees the usual path, but Explorer runs outside the container and does not.
 */
function realPath(folder) {
  if (!process.windowsStore || !process.env.APPDATA || !process.env.LOCALAPPDATA) return folder;
  const relativeToRoaming = path.relative(process.env.APPDATA, folder);
  if (relativeToRoaming.startsWith("..") || path.isAbsolute(relativeToRoaming)) return folder;
  const redirected = path.join(
    process.env.LOCALAPPDATA,
    "Packages",
    packageFamilyName,
    "LocalCache",
    "Roaming",
    relativeToRoaming
  );
  return fs.existsSync(redirected) ? redirected : folder;
}

let serverChild = null;
let appUrl = null;
let mainWindow = null;
let quitting = false;

function loadingPage() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Actual Bench</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: grid; place-items: center;
         font: 15px system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #18181b; color: #e4e4e7; }
  @media (prefers-color-scheme: light) { body { background: #fafafa; color: #27272a; } }
  .box { text-align: center; }
  .spin { width: 28px; height: 28px; margin: 0 auto 16px; border-radius: 50%;
          border: 3px solid currentColor; border-right-color: transparent;
          animation: s 0.9s linear infinite; opacity: 0.6; }
  @keyframes s { to { transform: rotate(360deg); } }
</style></head>
<body><div class="box" role="status"><div class="spin"></div>Starting Actual Bench…</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function isAppUrl(url) {
  if (!appUrl) return false;
  try {
    return new URL(url).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** Only web links leave the app, and they open in the user's browser. */
function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") void shell.openExternal(url);
  } catch {
    // Not a URL: ignore.
  }
}

const WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
};

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    title: "Actual Bench",
    backgroundColor: "#18181b",
    autoHideMenuBar: true,
    show: false,
    webPreferences: WEB_PREFERENCES,
  });

  window.once("ready-to-show", () => window.show());

  // Bench's own pages may open in another window; everything else goes to
  // the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: WEB_PREFERENCES } };
    }
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url.startsWith("data:")) return;
    event.preventDefault();
    openExternal(url);
  });

  window.on("close", (event) => {
    // On macOS the app (and Bench's server, so automations keep running)
    // stays open after its window closes, like other Mac apps.
    if (process.platform === "darwin" && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
}

function showMainWindow() {
  if (!mainWindow) {
    mainWindow = createWindow();
    void mainWindow.loadURL(appUrl ?? loadingPage());
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Documentation", click: () => openExternal(DOCS_URL) },
        { type: "separator" },
        { label: "Open Data Folder", click: () => void shell.openPath(realPath(dataDir())) },
        { label: "Open Logs Folder", click: () => void shell.openPath(realPath(logDir())) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function startBench() {
  const { serverDir, nodePath } = resourcePaths();
  if (!fs.existsSync(path.join(serverDir, "server.js")) || !fs.existsSync(nodePath)) {
    throw new Error(
      app.isPackaged
        ? "This copy of Actual Bench is incomplete. Please reinstall it."
        : "The server is not staged. Run `npm run stage` in desktop/ first."
    );
  }

  fs.mkdirSync(dataDir(), { recursive: true });
  const { stream } = openServerLog(logDir());
  const port = await findFreePort();
  const actualDesktop = findActualDesktopServer();

  serverChild = startServer({
    nodePath,
    serverDir,
    log: stream,
    env: serverEnv({
      baseEnv: process.env,
      port,
      dataDir: dataDir(),
      extra: {
        ACTUAL_BENCH_DESKTOP: "1",
        ACTUAL_BENCH_ACTUAL_DESKTOP_SERVER_URL: actualDesktop.url,
      },
    }),
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth({ baseUrl, child: serverChild });
  appUrl = `${baseUrl}/`;

  serverChild.on("exit", (code) => {
    if (quitting) return;
    dialog.showErrorBox(
      "Actual Bench stopped",
      `The Actual Bench server stopped unexpectedly (exit code ${code}). ` +
        `Unsaved changes are lost. Details are in the log:\n${path.join(realPath(logDir()), "server.log")}\n\n` +
        "Actual Bench will now close; open it again to continue."
    );
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("io.github.x-rous.actual-bench");
    buildMenu();
    showMainWindow();

    try {
      await startBench();
    } catch (error) {
      dialog.showErrorBox(
        "Actual Bench could not start",
        `${error instanceof Error ? error.message : String(error)}\n\nDetails are in the log:\n${path.join(realPath(logDir()), "server.log")}`
      );
      quitting = true;
      app.quit();
      return;
    }

    if (mainWindow) void mainWindow.loadURL(appUrl);
    else showMainWindow();
  });

  app.on("activate", () => showMainWindow());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (!serverChild || serverChild.exitCode !== null || serverChild.signalCode !== null) {
      quitting = true;
      return;
    }
    // Stop the server first, then quit for real.
    event.preventDefault();
    quitting = true;
    const child = serverChild;
    serverChild = null;
    void stopServer(child).finally(() => app.quit());
  });
}
