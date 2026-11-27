"use strict";

/**
 * electron-builder configuration. The app version comes from the repository's
 * package.json, so a release bumps one version and the installers follow it.
 *
 * Builds are unsigned for now: Windows SmartScreen warns about an unknown
 * publisher, and macOS needs the steps in the desktop-app docs to open it.
 * Adding signing later means setting CSC_LINK / CSC_KEY_PASSWORD (Windows)
 * and an Apple Developer ID with notarization (macOS); no change here is
 * needed beyond `mac.identity` and `mac.notarize`.
 */

const { version } = require("../package.json");
const store = require("./src/storeIdentity.cjs");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "io.github.x-rous.actual-bench",
  productName: "Actual Bench",
  copyright: "Copyright © 2026 Manaf Abu Rous",
  extraMetadata: { version },
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["src/**/*", "!src/**/*.test.cjs", "package.json"],
  // The Bench server and its Node runtime sit beside the app, unpacked, so
  // the bundled Node can run them.
  //
  // One entry for the whole of .stage, not one per folder: electron-builder
  // always drops a `node_modules` directly under an extra resource's `from`
  // (app-builder-lib util/filter.js), which would remove server/node_modules
  // (Next.js, React, better-sqlite3). One level down, it is kept.
  extraResources: [{ from: ".stage", to: ".", filter: ["server/**/*", "runtime/**/*"] }],
  asar: true,
  artifactName: "Actual-Bench-${version}-${os}-${arch}.${ext}",

  win: {
    // nsis: the installer attached to GitHub releases.
    // appx: the MSIX package uploaded to the Microsoft Store, which signs it.
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "appx", arch: ["x64"] },
    ],
    icon: "resources/icon.png",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Actual Bench",
    // Bench's data (database, vault key) stays when the app is uninstalled.
    deleteAppDataOnUninstall: false,
  },

  appx: {
    identityName: store.identityName,
    publisher: store.publisher,
    publisherDisplayName: store.publisherDisplayName,
    applicationId: "ActualBench",
    displayName: "Actual Bench",
    backgroundColor: "#18181b",
    languages: ["en-US"],
    artifactName: "Actual-Bench-${version}-store-${arch}.${ext}",
  },

  mac: {
    target: [{ target: "dmg" }, { target: "zip" }],
    category: "public.app-category.finance",
    // The bundled Node 24 runtime needs macOS 13.5 or later.
    minimumSystemVersion: "13.5",
    icon: "resources/icon.png",
    // Ad-hoc signature: Apple silicon refuses to run unsigned code at all.
    identity: "-",
    hardenedRuntime: false,
    gatekeeperAssess: false,
  },
  dmg: {
    title: "Actual Bench ${version}",
  },

  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }],
    category: "Office",
    icon: "resources/icon.png",
  },
};
