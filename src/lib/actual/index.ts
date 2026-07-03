import {
  isHttpApiConnection,
  type ConnectionInstance,
} from "@/store/connection";
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

export type { ActualBenchTransport } from "./transport";
