import { apiRequest } from "./client";
import { runQuery } from "./query";
import type { ConnectionInstance } from "@/store/connection";

export type NoteRow = { id: string; note: string | null };

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

export function extractNote(payload: NotePayload): string {
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

export async function getAllNotes(
  connection: ConnectionInstance
): Promise<Map<string, string>> {
  const response = await runQuery<{ data: NoteRow[] }>(connection, {
    ActualQLquery: { table: "notes", select: "*" },
  });
  const map = new Map<string, string>();
  for (const row of response.data) {
    if (row.id && row.note) map.set(row.id, row.note);
  }
  return map;
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

// ─── Writers ────────────────────────────────────────────────────────────────────
//
// Notes are a generic `{ id, note }` key-value store in Actual Budget. The
// actual-http-api wrapper exposes PUT/DELETE per target; the body shape for PUT
// is `{ data: string }` and DELETE clears the note (sets it to null). The
// category route passes its `:categoryId` param RAW to the underlying store, so
// the composite cell id `{categoryId}-{month}` writes/clears a category×month
// cell note through the same endpoint (there is no dedicated cell route).

/** The notes-table id for a category × month budget cell, e.g. `${uuid}-2026-06`. */
export function toCategoryMonthNoteId(categoryId: string, month: string): string {
  return `${categoryId}-${month}`;
}

export async function setAccountNote(
  connection: ConnectionInstance,
  accountId: string,
  note: string
): Promise<void> {
  await apiRequest<void>(connection, `/notes/account/${accountId}`, {
    method: "PUT",
    body: { data: note },
  });
}

export async function deleteAccountNote(
  connection: ConnectionInstance,
  accountId: string
): Promise<void> {
  await apiRequest<void>(connection, `/notes/account/${accountId}`, {
    method: "DELETE",
  });
}

/** `id` may be a plain `categoryId`, a `groupId`, or a `{categoryId}-{month}` cell id. */
export async function setCategoryNote(
  connection: ConnectionInstance,
  id: string,
  note: string
): Promise<void> {
  await apiRequest<void>(connection, `/notes/category/${id}`, {
    method: "PUT",
    body: { data: note },
  });
}

export async function deleteCategoryNote(
  connection: ConnectionInstance,
  id: string
): Promise<void> {
  await apiRequest<void>(connection, `/notes/category/${id}`, {
    method: "DELETE",
  });
}

export async function setBudgetMonthNote(
  connection: ConnectionInstance,
  month: string,
  note: string
): Promise<void> {
  await apiRequest<void>(connection, `/notes/budgetmonth/${month}`, {
    method: "PUT",
    body: { data: note },
  });
}

export async function deleteBudgetMonthNote(
  connection: ConnectionInstance,
  month: string
): Promise<void> {
  await apiRequest<void>(connection, `/notes/budgetmonth/${month}`, {
    method: "DELETE",
  });
}
