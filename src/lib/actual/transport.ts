import type { CategoryGroupsResponse } from "../api/categoryGroups";
import type { NotesIndex } from "../api/notes";
import type { ConnectionMode } from "@/store/connection";
import type {
  Account,
  Category,
  CategoryGroup,
  Payee,
  Rule,
  Schedule,
  Tag,
} from "@/types/entities";

export type ScheduleWriteInput = Omit<
  Schedule,
  "id" | "ruleId" | "nextDate" | "completed"
>;

export interface ActualBenchTransport {
  readonly mode: ConnectionMode;
  sync(): Promise<void>;

  getServerVersion(): Promise<string | null>;

  getAccounts(): Promise<Account[]>;
  getAccountBalances(): Promise<Map<string, number>>;
  createAccount(input: Omit<Account, "id">): Promise<Account>;
  updateAccount(id: string, patch: Partial<Omit<Account, "id" | "initialBalance">>): Promise<void>;
  deleteAccount(id: string): Promise<void>;

  getPayees(): Promise<Payee[]>;
  createPayee(input: Pick<Payee, "name">): Promise<Payee>;
  updatePayee(id: string, patch: Partial<Pick<Payee, "name">>): Promise<void>;
  deletePayee(id: string): Promise<void>;
  mergePayees(targetId: string, mergeIds: string[]): Promise<void>;

  getCategoryGroups(): Promise<CategoryGroupsResponse>;
  createCategoryGroup(input: Pick<CategoryGroup, "name" | "isIncome" | "hidden">): Promise<string>;
  updateCategoryGroup(id: string, patch: Partial<Pick<CategoryGroup, "name" | "hidden">>): Promise<void>;
  deleteCategoryGroup(id: string): Promise<void>;
  createCategory(input: Pick<Category, "name" | "groupId" | "isIncome" | "hidden">): Promise<string>;
  updateCategory(id: string, patch: Partial<Pick<Category, "name" | "hidden">>): Promise<void>;
  deleteCategory(id: string): Promise<void>;

  getTags(): Promise<Tag[]>;
  createTag(input: Pick<Tag, "name"> & Partial<Pick<Tag, "color" | "description">>): Promise<Tag>;
  updateTag(id: string, patch: Partial<Pick<Tag, "name" | "color" | "description">>): Promise<void>;
  deleteTag(id: string): Promise<void>;

  getRules(): Promise<Rule[]>;
  createRule(input: Omit<Rule, "id">): Promise<Rule>;
  updateRule(id: string, patch: Partial<Omit<Rule, "id">>): Promise<void>;
  deleteRule(id: string): Promise<void>;

  getSchedules(): Promise<Schedule[]>;
  createSchedule(input: ScheduleWriteInput): Promise<Schedule>;
  updateSchedule(id: string, input: ScheduleWriteInput): Promise<void>;
  deleteSchedule(id: string): Promise<void>;

  getNotesIndex(): Promise<NotesIndex>;
  getAccountNote(accountId: string): Promise<string>;
  getAllNotes(): Promise<Map<string, string>>;
  getCategoryLikeNote(id: string): Promise<string>;
  setAccountNote(accountId: string, note: string): Promise<void>;
  deleteAccountNote(accountId: string): Promise<void>;
  setCategoryNote(id: string, note: string): Promise<void>;
  deleteCategoryNote(id: string): Promise<void>;
  setBudgetMonthNote(month: string, note: string): Promise<void>;
  deleteBudgetMonthNote(month: string): Promise<void>;
}

export async function syncTransportAfterChanges(
  transport: ActualBenchTransport,
  changed: boolean
): Promise<void> {
  if (changed && transport.mode === "browser-api") await transport.sync();
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
