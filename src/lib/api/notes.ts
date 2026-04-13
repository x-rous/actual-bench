import { apiRequest } from "./client";
import { runQuery } from "./query";
import type { ConnectionInstance } from "@/store/connection";

type NoteIndexRow = {
  id: string;
};

export type NotesIndex = {
  accountIdsWithNotes: string[];
  rawEntityIdsWithNotes: string[];
  budgetMonthsWithNotes: string[];
};

type NotePayload =
  | string
  | { note?: unknown; data?: unknown }
  | null
  | undefined;

function extractNote(payload: NotePayload): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";

  if ("note" in payload && typeof payload.note === "string") {
    return payload.note;
  }

  if ("data" in payload) {
    return extractNote(payload.data as NotePayload);
  }

  return "";
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function toAccountNoteId(accountId: string): string {
  return `account-${accountId}`;
}

export function toBudgetNoteId(month: string): string {
  return `budget-${month}`;
}

export function parseNotesIndexIds(ids: string[]): NotesIndex {
  const accountIds = new Set<string>();
  const rawEntityIds = new Set<string>();
  const budgetMonths = new Set<string>();

  for (const id of ids) {
    if (id.startsWith("account-")) {
      const entityId = id.slice("account-".length).trim();
      if (entityId) accountIds.add(entityId);
      continue;
    }

    if (id.startsWith("budget-")) {
      const month = id.slice("budget-".length).trim();
      if (month) budgetMonths.add(month);
      continue;
    }

    if (id.trim()) {
      rawEntityIds.add(id);
    }
  }

  return {
    accountIdsWithNotes: uniqueSorted(accountIds),
    rawEntityIdsWithNotes: uniqueSorted(rawEntityIds),
    budgetMonthsWithNotes: uniqueSorted(budgetMonths),
  };
}

export async function getNotesIndex(
  connection: ConnectionInstance
): Promise<NotesIndex> {
  const response = await runQuery<{ data: NoteIndexRow[] }>(connection, {
    ActualQLquery: {
      table: "notes",
      select: "id",
    },
  });

  return parseNotesIndexIds(response.data.map((row) => row.id));
}

export async function getAccountNote(
  connection: ConnectionInstance,
  accountId: string
): Promise<string> {
  const response = await apiRequest<NotePayload>(
    connection,
    `/notes/account/${accountId}`
  );
  return extractNote(response);
}

export async function getCategoryLikeNote(
  connection: ConnectionInstance,
  id: string
): Promise<string> {
  const response = await apiRequest<NotePayload>(
    connection,
    `/notes/category/${id}`
  );
  return extractNote(response);
}
