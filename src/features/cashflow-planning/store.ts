"use client";

import { create } from "zustand";
import type { PlanDocument, PlanRecord } from "@/lib/cashflow-planning/types";

/**
 * The plans open in this tab. Each plan is saved to the app database on its own shortly after every edit (see
 * `usePlanAutosave`), so this store is a working copy, not the record: `saved` is the document the database holds and
 * `revision` its revision there. Undo and redo are per plan and only change the working copy; the next save stores the result.
 * Nothing here is ever written to Actual, and none of it is part of the global staged Save.
 */

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export type PlanSession = {
  id: string;
  revision: number;
  /** The document as last saved. */
  saved: PlanDocument;
  doc: PlanDocument;
  past: PlanDocument[];
  future: PlanDocument[];
  status: SaveStatus;
  error?: string;
};

const HISTORY_LIMIT = 100;

type State = {
  /** The budget the sessions belong to; plans of another budget are never shown. */
  budgetSyncId: string | null;
  sessions: Record<string, PlanSession>;
  order: string[];
  activeId: string | null;
  hydrate: (budgetSyncId: string, records: PlanRecord[], preferredId?: string | null) => void;
  /** Adds a plan the database just created (or replaces one it just returned). */
  adopt: (record: PlanRecord, select?: boolean) => void;
  select: (id: string) => void;
  remove: (id: string) => void;
  edit: (id: string, change: (doc: PlanDocument) => PlanDocument) => void;
  undo: (id: string) => void;
  redo: (id: string) => void;
  saving: (id: string) => void;
  /** `sent` is the document the save carried: edits made while it was on its way stay pending. */
  savedAs: (id: string, record: PlanRecord, sent: PlanDocument) => void;
  failed: (id: string, status: "error" | "conflict", error: string) => void;
};

const session = (record: PlanRecord): PlanSession => ({ id: record.id, revision: record.revision, saved: record.document, doc: record.document, past: [], future: [], status: "saved" });

export const useCashflowStore = create<State>((set) => {
  const patch = (id: string, change: (s: PlanSession) => PlanSession) => set((state) => {
    const current = state.sessions[id];
    if (!current) return state;
    const next = change(current);
    return next === current ? state : { sessions: { ...state.sessions, [id]: next } };
  });
  return {
    budgetSyncId: null, sessions: {}, order: [], activeId: null,
    hydrate: (budgetSyncId, records, preferredId) => set((state) => {
      // Coming back to the same budget keeps the working copies (and their undo history) of this tab.
      if (state.budgetSyncId === budgetSyncId) return state;
      const sessions = Object.fromEntries(records.map((r) => [r.id, session(r)]));
      const order = records.map((r) => r.id);
      return { budgetSyncId, sessions, order, activeId: preferredId && sessions[preferredId] ? preferredId : order[0] ?? null };
    }),
    adopt: (record, select = true) => set((state) => ({
      sessions: { ...state.sessions, [record.id]: session(record) },
      order: state.order.includes(record.id) ? state.order : [...state.order, record.id],
      activeId: select ? record.id : state.activeId,
    })),
    select: (id) => set((state) => (state.sessions[id] ? { activeId: id } : state)),
    remove: (id) => set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[id];
      const order = state.order.filter((x) => x !== id);
      return { sessions, order, activeId: state.activeId === id ? order[0] ?? null : state.activeId };
    }),
    edit: (id, change) => patch(id, (s) => {
      const doc = change(s.doc);
      if (doc === s.doc) return s;
      return { ...s, doc, past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.doc], future: [], status: s.status === "conflict" ? "conflict" : "dirty" };
    }),
    undo: (id) => patch(id, (s) => (s.past.length === 0 ? s : { ...s, doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.doc, ...s.future], status: s.status === "conflict" ? "conflict" : "dirty" })),
    redo: (id) => patch(id, (s) => (s.future.length === 0 ? s : { ...s, doc: s.future[0], past: [...s.past, s.doc], future: s.future.slice(1), status: s.status === "conflict" ? "conflict" : "dirty" })),
    saving: (id) => patch(id, (s) => ({ ...s, status: "saving", error: undefined })),
    savedAs: (id, record, sent) => patch(id, (s) => ({ ...s, revision: record.revision, saved: sent, status: s.doc === sent ? "saved" : "dirty", error: undefined })),
    failed: (id, status, error) => patch(id, (s) => ({ ...s, status, error })),
  };
});

/** Whether any plan holds edits the database does not have yet. */
export function hasUnsavedPlans(): boolean {
  return Object.values(useCashflowStore.getState().sessions).some((s) => s.doc !== s.saved);
}
