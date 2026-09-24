"use client";

import type { ActualRuntimeHost } from "../runtime/types";
import { exportBrowserApiBudgetZip, getBrowserApiRuntime, syncBrowserApiRuntime } from "./runtime";

/**
 * The Direct transport's host in a browser tab: the tab's one
 * `@actual-app/api` runtime, as it has always been (RD-095 M3).
 */
export const browserHost: ActualRuntimeHost = {
  getRuntime: (connection) => getBrowserApiRuntime(connection),
  sync: (connection) => syncBrowserApiRuntime(connection),
  exportBudget: async (connection) => new Uint8Array(await exportBrowserApiBudgetZip(connection)),
};
