import type { DebtLedgerEntry, DebtPaymentRule, DebtWrite, LedgerChange, PaymentRuleInput } from "@/lib/app-db/debtTrackingRepository";
import { request } from "./debtsApi";

/** The loan tracking routes (Bench metadata only; nothing here reaches Actual). */

export type TrackingBundle = {
  entries: DebtLedgerEntry[];
  rules: DebtPaymentRule[];
  writes: DebtWrite[];
  openingStatement: { id: string; date: string; principalMinor: number } | null;
  anchors: { id: string; date: string; principalMinor: number; source: string }[];
};

const base = (debtId: string) => `/api/assets-debt/debts/${encodeURIComponent(debtId)}/tracking`;

export const getTrackingBundle = (debtId: string) => request<TrackingBundle>(base(debtId));

export const saveLedgerChanges = (debtId: string, changes: LedgerChange[]) =>
  request<{ entries: DebtLedgerEntry[] }>(`${base(debtId)}/ledger`, { method: "PATCH", body: JSON.stringify({ changes }) }).then((r) => r.entries);

export const savePaymentRule = (debtId: string, operation: { kind: "save"; rule: PaymentRuleInput } | { kind: "delete"; id: string }) =>
  request<{ rules: DebtPaymentRule[] }>(`${base(debtId)}/rules`, { method: "PUT", body: JSON.stringify(operation) }).then((r) => r.rules);

export const startWrite = (debtId: string, body: { batchId?: string | null; kind: DebtWrite["kind"]; installmentDueDate?: string | null; targetIds: string[]; before: unknown; after: unknown; marker?: string | null }) =>
  request<{ write: DebtWrite }>(`${base(debtId)}/writes`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.write);

export const finishWrite = (debtId: string, writeId: string, body: { status: "applied" | "failed" | "uncertain"; actualIds?: string[] | null; error?: unknown }) =>
  request<{ write: DebtWrite }>(`${base(debtId)}/writes/${encodeURIComponent(writeId)}`, { method: "PATCH", body: JSON.stringify(body) }).then((r) => r.write);
