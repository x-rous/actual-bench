import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import type { SafeSyncResult } from "@/lib/sync/safeSyncOrchestrator";
import type { LiveDryRunResult } from "@/lib/sync/previewOrchestrator";
import type { SyncFlow } from "@/lib/app-db/types";
import type { ConnectionInstance } from "@/store/connection";
import { flowToFormState } from "./flowForm";

/**
 * Flow groups: a name kept in the flow's options, and a run of the whole group in
 * dependency order. Running a group never widens what a flow may do: a manual flow
 * is only previewed, and an automated one applies safe items only.
 */

export function flowGroupName(flow: SyncFlow): string {
  const name = (flow.options.data as Record<string, unknown> | undefined)?.groupName;
  return typeof name === "string" ? name.trim() : "";
}

const TYPE_ORDER: Record<string, number> = { payee_sync: 0, category_sync: 1, transaction_sync: 2 };

/** Payees and categories first, so the transactions that follow can match them. */
export function orderFlowsForRun(flows: readonly SyncFlow[]): SyncFlow[] {
  return [...flows].sort(
    (a, b) => (TYPE_ORDER[a.flowType] ?? 3) - (TYPE_ORDER[b.flowType] ?? 3) || a.name.localeCompare(b.name)
  );
}

/** Named groups first, alphabetically, then ungrouped flows; order inside a group is kept. */
export function groupFlows(flows: readonly SyncFlow[]): { name: string; flows: SyncFlow[] }[] {
  const groups = new Map<string, SyncFlow[]>();
  for (const flow of flows) {
    const name = flowGroupName(flow);
    groups.set(name, [...(groups.get(name) ?? []), flow]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([name, entries]) => ({ name, flows: entries }));
}

export type GroupRunOutcome = {
  flowId: string;
  name: string;
  state: "applied" | "previewed" | "no_changes" | "attention" | "skipped" | "failed";
  detail: string;
};

export type GroupRunDeps = {
  runPreview: (input: { flowId: string; sourceConnection: ConnectionInstance; targetConnection: ConnectionInstance }) => Promise<LiveDryRunResult>;
  runSafe: (input: { flowId: string; sourceConnection: ConnectionInstance; targetConnection: ConnectionInstance }) => Promise<SafeSyncResult>;
  runOnServer: (flowId: string) => Promise<{ result: { status: string; message: string | null } }>;
  /** True when both of the flow's budgets are enrolled for unattended runs. */
  runsOnServer: (flow: SyncFlow) => boolean;
};

function describeSafe(flow: SyncFlow, result: SafeSyncResult): GroupRunOutcome {
  const base = { flowId: flow.id, name: flow.name };
  if (result.status === "preview_failed") return { ...base, state: "failed", detail: result.error.message };
  if (result.status === "skipped_manual_policy") return { ...base, state: "skipped", detail: "Set to manual review." };
  const waiting = result.preview.blocked + result.preview.duplicatesSkipped + result.preview.sourceChangedWarnings + (result.preview.targetMissing ?? 0);
  const left = waiting > 0 ? `${waiting} left to review` : "";
  if (result.status === "no_safe_items") {
    return waiting > 0 ? { ...base, state: "attention", detail: `Nothing safe to apply; ${left}.` } : { ...base, state: "no_changes", detail: "No changes." };
  }
  const { applied, repaired, failed } = result.apply.counts;
  const summary = [`${applied} added`, repaired ? `${repaired} re-linked` : "", failed ? `${failed} failed` : "", left].filter(Boolean).join(", ");
  if (result.status === "failed") return { ...base, state: "failed", detail: result.apply.error?.message ?? summary };
  return { ...base, state: failed > 0 || waiting > 0 ? "attention" : "applied", detail: `${summary}.` };
}

/** Run each flow in turn; one flow failing does not stop the ones after it. */
export async function runFlowGroup(
  flows: readonly SyncFlow[],
  connections: ConnectionInstance[],
  deps: GroupRunDeps,
  onProgress: (outcomes: GroupRunOutcome[], runningFlowId: string | null) => void
): Promise<GroupRunOutcome[]> {
  const outcomes: GroupRunOutcome[] = [];
  for (const flow of orderFlowsForRun(flows)) {
    onProgress([...outcomes], flow.id);
    const base = { flowId: flow.id, name: flow.name };
    let outcome: GroupRunOutcome;
    try {
      if (!flow.enabled) {
        outcome = { ...base, state: "skipped", detail: "Disabled." };
      } else if (deps.runsOnServer(flow)) {
        const { result } = await deps.runOnServer(flow.id);
        const ok = result.status === "applied" || result.status === "no_safe_items" || result.status === "succeeded";
        outcome = { ...base, state: ok ? "applied" : result.status === "partial" ? "attention" : "failed", detail: result.message ?? `Ran on the server (${result.status}).` };
      } else {
        const form = flowToFormState(flow, connections);
        const source = connections.find((c) => c.id === form.source.connectionId);
        const target = connections.find((c) => c.id === form.target.connectionId);
        if (!source || !target) {
          outcome = { ...base, state: "skipped", detail: "Connect both budgets to run this flow." };
        } else if (decodeFlowPlanConfig(flow).reviewPolicy === "manual_preview_required") {
          const preview = await deps.runPreview({ flowId: flow.id, sourceConnection: source, targetConnection: target });
          outcome = preview.status === "draft_preview"
            ? { ...base, state: "previewed", detail: `Previewed only: ${preview.summary.createCandidates} new. Open the flow to apply.` }
            : { ...base, state: "failed", detail: preview.error.message };
        } else {
          outcome = describeSafe(flow, await deps.runSafe({ flowId: flow.id, sourceConnection: source, targetConnection: target }));
        }
      }
    } catch (err) {
      outcome = { ...base, state: "failed", detail: err instanceof Error ? err.message : "The flow could not be run." };
    }
    outcomes.push(outcome);
    onProgress([...outcomes], null);
  }
  return outcomes;
}
