import { getAccounts } from "../api/accounts";
import type { HttpApiConnection } from "@/store/connection";
import type { ActualBenchTransport } from "./transport";

export function createHttpApiTransport(
  connection: HttpApiConnection
): ActualBenchTransport {
  return {
    mode: "http-api",
    getAccounts: () => getAccounts(connection),
  };
}
