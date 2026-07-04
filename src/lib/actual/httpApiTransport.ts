import {
  createAccount,
  deleteAccount,
  getAccounts,
  getAccountBalances,
  updateAccount,
} from "../api/accounts";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "../api/categories";
import {
  createCategoryGroup,
  deleteCategoryGroup,
  getCategoryGroups,
  updateCategoryGroup,
} from "../api/categoryGroups";
import { getServerVersion } from "../api/client";
import {
  deleteAccountNote,
  deleteBudgetMonthNote,
  deleteCategoryNote,
  getAllNotes,
  getNotesIndex,
  getAccountNote,
  getCategoryLikeNote,
  setAccountNote,
  setBudgetMonthNote,
  setCategoryNote,
} from "../api/notes";
import {
  createPayee,
  deletePayee,
  getPayees,
  mergePayees,
  updatePayee,
} from "../api/payees";
import {
  createRule,
  deleteRule,
  getRules,
  updateRule,
} from "../api/rules";
import {
  createSchedule,
  deleteSchedule,
  getSchedules,
  updateSchedule,
} from "../api/schedules";
import {
  createTag,
  deleteTag,
  getTags,
  updateTag,
} from "../api/tags";
import type { HttpApiConnection } from "@/store/connection";
import { prepareRuleForTransport, prepareRulePatchForTransport } from "./ruleMutation";
import type { ActualBenchTransport } from "./transport";

export function createHttpApiTransport(
  connection: HttpApiConnection
): ActualBenchTransport {
  return {
    mode: "http-api",
    sync: () => Promise.resolve(),
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
    createAccount: (input) => createAccount(connection, input),
    updateAccount: (id, patch) => updateAccount(connection, id, patch),
    deleteAccount: (id) => deleteAccount(connection, id),

    getPayees: () => getPayees(connection),
    createPayee: (input) => createPayee(connection, input),
    updatePayee: (id, patch) => updatePayee(connection, id, patch),
    deletePayee: (id) => deletePayee(connection, id),
    mergePayees: (targetId, mergeIds) => mergePayees(connection, targetId, mergeIds),

    getCategoryGroups: () => getCategoryGroups(connection),
    createCategoryGroup: (input) => createCategoryGroup(connection, input),
    updateCategoryGroup: (id, patch) => updateCategoryGroup(connection, id, patch),
    deleteCategoryGroup: (id) => deleteCategoryGroup(connection, id),
    createCategory: (input) => createCategory(connection, input),
    updateCategory: (id, patch) => updateCategory(connection, id, patch),
    deleteCategory: (id) => deleteCategory(connection, id),

    getTags: () => getTags(connection),
    createTag: (input) => createTag(connection, input),
    updateTag: (id, patch) => updateTag(connection, id, patch),
    deleteTag: (id) => deleteTag(connection, id),

    getRules: () => getRules(connection),
    createRule: (input) => createRule(connection, prepareRuleForTransport(input)),
    updateRule: (id, patch) =>
      updateRule(connection, id, prepareRulePatchForTransport(patch)),
    deleteRule: (id) => deleteRule(connection, id),

    getSchedules: () => getSchedules(connection),
    createSchedule: (input) => createSchedule(connection, input),
    updateSchedule: (id, input) => updateSchedule(connection, id, input),
    deleteSchedule: (id) => deleteSchedule(connection, id),

    getNotesIndex: () => getNotesIndex(connection),
    getAccountNote: (accountId) => getAccountNote(connection, accountId),
    getAllNotes: () => getAllNotes(connection),
    getCategoryLikeNote: (id) => getCategoryLikeNote(connection, id),
    setAccountNote: (accountId, note) => setAccountNote(connection, accountId, note),
    deleteAccountNote: (accountId) => deleteAccountNote(connection, accountId),
    setCategoryNote: (id, note) => setCategoryNote(connection, id, note),
    deleteCategoryNote: (id) => deleteCategoryNote(connection, id),
    setBudgetMonthNote: (month, note) => setBudgetMonthNote(connection, month, note),
    deleteBudgetMonthNote: (month) => deleteBudgetMonthNote(connection, month),
  };
}
