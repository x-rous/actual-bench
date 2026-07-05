import {
  isHttpApiConnection,
  type ConnectionInstance,
} from "@/store/connection";
import { ensureBrowserApiBudgetOpen } from "./browser/runtime";
import { createBrowserApiTransport } from "./browserApiTransport";
import { createHttpApiTransport } from "./httpApiTransport";
import type { ActualBenchTransport } from "./transport";

export function getTransport(
  connection: ConnectionInstance
): ActualBenchTransport {
  return isHttpApiConnection(connection)
    ? createHttpApiTransport(connection)
    : createBrowserApiTransport(connection);
}

export async function ensureTransportReady(
  connection: ConnectionInstance
): Promise<void> {
  if (isHttpApiConnection(connection)) return;
  await ensureBrowserApiBudgetOpen(connection);
}

export { settleTransportWrites, syncTransportAfterChanges } from "./transport";
export type { ActualBenchTransport } from "./transport";
