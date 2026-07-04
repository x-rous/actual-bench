import type { CategoryGroupsResponse } from "../api/categoryGroups";
import type { NotesIndex } from "../api/notes";
import type { ConnectionMode } from "@/store/connection";
import type { Account, Payee, Rule, Schedule, Tag } from "@/types/entities";

export interface ActualBenchTransport {
  readonly mode: ConnectionMode;
  getServerVersion(): Promise<string | null>;
  getAccounts(): Promise<Account[]>;
  getAccountBalances(): Promise<Map<string, number>>;
  getPayees(): Promise<Payee[]>;
  getCategoryGroups(): Promise<CategoryGroupsResponse>;
  getTags(): Promise<Tag[]>;
  getRules(): Promise<Rule[]>;
  getSchedules(): Promise<Schedule[]>;
  getNotesIndex(): Promise<NotesIndex>;
  getAccountNote(accountId: string): Promise<string>;
  getAllNotes(): Promise<Map<string, string>>;
  getCategoryLikeNote(id: string): Promise<string>;
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
