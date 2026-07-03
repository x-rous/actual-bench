import type { ConnectionMode } from "@/store/connection";
import type { Account } from "@/types/entities";

export interface ActualBenchTransport {
  readonly mode: ConnectionMode;
  getAccounts(): Promise<Account[]>;
}

export function unsupportedTransportOperation(
  mode: ConnectionMode,
  operation: string
): Error {
  return new Error(
    mode === "browser-api"
      ? "Direct browser API transport does not support " + operation + " yet."
      : "Transport operation " + operation + " is not supported."
  );
}
