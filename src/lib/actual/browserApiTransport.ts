import type { BrowserApiConnection } from "@/store/connection";
import type { ActualBenchTransport } from "./transport";
import { unsupportedTransportOperation } from "./transport";

export function createBrowserApiTransport(
  connection: BrowserApiConnection
): ActualBenchTransport {
  return {
    mode: connection.mode,
    getAccounts: () =>
      Promise.reject(unsupportedTransportOperation(connection.mode, "getAccounts")),
  };
}
