import type { BrowserApiConnection } from "@/store/connection";
import { browserHost } from "./browser/browserHost";
import { createActualRuntimeTransport } from "./runtimeTransport";
import type { ActualBenchTransport } from "./transport";

/** The Direct transport in a browser tab: the shared transport on the tab's runtime. */
export function createBrowserApiTransport(connection: BrowserApiConnection): ActualBenchTransport {
  return createActualRuntimeTransport(connection, browserHost);
}
