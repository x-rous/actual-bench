import { getAccounts, getAccountBalances } from "../api/accounts";
import { getCategoryGroups } from "../api/categoryGroups";
import { getServerVersion } from "../api/client";
import { getAllNotes, getNotesIndex, getAccountNote, getCategoryLikeNote } from "../api/notes";
import { getPayees } from "../api/payees";
import { getRules } from "../api/rules";
import { getSchedules } from "../api/schedules";
import { getTags } from "../api/tags";
import type { HttpApiConnection } from "@/store/connection";
import type { ActualBenchTransport } from "./transport";

export function createHttpApiTransport(
  connection: HttpApiConnection
): ActualBenchTransport {
  return {
    mode: "http-api",
    getServerVersion: async () => {
      try {
        return await getServerVersion(
          connection.baseUrl,
          connection.apiKey,
          connection.budgetSyncId
        );
      } catch {
        return null;
      }
    },
    getAccounts: () => getAccounts(connection),
    getAccountBalances: () => getAccountBalances(connection),
    getPayees: () => getPayees(connection),
    getCategoryGroups: () => getCategoryGroups(connection),
    getTags: () => getTags(connection),
    getRules: () => getRules(connection),
    getSchedules: () => getSchedules(connection),
    getNotesIndex: () => getNotesIndex(connection),
    getAccountNote: (accountId) => getAccountNote(connection, accountId),
    getAllNotes: () => getAllNotes(connection),
    getCategoryLikeNote: (id) => getCategoryLikeNote(connection, id),
  };
}
