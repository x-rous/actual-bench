/**
 * Typed API functions for the Schedules entity.
 * Normalizes API snake_case types → internal camelCase types.
 * Read-only server fields (rule, next_date, completed) are never sent in inputs.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type {
  ApiSchedule,
  ApiScheduleInput,
  ApiListResponse,
  ApiSingleResponse,
} from "@/types/api";
import type { Schedule } from "@/types/entities";

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeSchedule(raw: ApiSchedule): Schedule {
  return {
    id: raw.id!,
    name: raw.name ?? undefined,
    ruleId: raw.rule ?? undefined,
    nextDate: raw.next_date ?? undefined,
    completed: raw.completed ?? false,
    postsTransaction: raw.posts_transaction ?? false,
    payeeId: raw.payee ?? null,
    accountId: raw.account ?? null,
    amount: raw.amount,
    amountOp: raw.amountOp,
    date: raw.date,
  };
}

type ScheduleWritable = Omit<Schedule, "id" | "ruleId" | "nextDate" | "completed">;

function denormalizeSchedule(s: ScheduleWritable): ApiScheduleInput {
  if (s.date == null) throw new Error("Schedule date is required but was missing");
  const input: ApiScheduleInput = { date: s.date };
  if (s.name !== undefined) input.name = s.name;
  input.posts_transaction = s.postsTransaction ?? false;
  input.payee = s.payeeId ?? null;
  input.account = s.accountId ?? null;
  if (s.amount !== undefined) input.amount = s.amount;
  if (s.amountOp !== undefined) input.amountOp = s.amountOp;
  return input;
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getSchedules(
  connection: ConnectionInstance
): Promise<Schedule[]> {
  const response = await apiRequest<ApiListResponse<ApiSchedule>>(
    connection,
    "/schedules"
  );
  return response.data.map(normalizeSchedule);
}

export async function createSchedule(
  connection: ConnectionInstance,
  input: ScheduleWritable
): Promise<Schedule> {
  const response = await apiRequest<ApiSingleResponse<ApiSchedule>>(
    connection,
    "/schedules",
    { method: "POST", body: { schedule: denormalizeSchedule(input) } }
  );
  return normalizeSchedule(response.data);
}

export async function updateSchedule(
  connection: ConnectionInstance,
  id: string,
  input: ScheduleWritable
): Promise<void> {
  await apiRequest<void>(connection, `/schedules/${id}`, {
    method: "PATCH",
    body: { schedule: denormalizeSchedule(input) },
  });
}

export async function deleteSchedule(
  connection: ConnectionInstance,
  id: string
): Promise<void> {
  await apiRequest<void>(connection, `/schedules/${id}`, { method: "DELETE" });
}
