"use client";

import { useMutation } from "@tanstack/react-query";
import { runClientApply, runClientPreview, runClientSafeSync } from "../lib/clientOrchestration";
import type { ConnectionInstance } from "@/store/connection";
import type { ApplySelection } from "@/lib/sync/applyOrchestrator";

export type PreviewArgs = {
  flowId: string;
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
  allowDisabled?: boolean;
};

/** Runs the Slice 3 live dry-run via the client orchestrator (browser transport). */
export function usePreviewMutation() {
  return useMutation({ mutationFn: (args: PreviewArgs) => runClientPreview(args) });
}

export type ApplyArgs = {
  runId: string;
  targetConnection: ConnectionInstance;
  selection?: ApplySelection;
};

/** Runs the Slice 4 apply via the client orchestrator (browser transport). */
export function useApplyMutation() {
  return useMutation({ mutationFn: (args: ApplyArgs) => runClientApply(args) });
}

export type SafeSyncArgs = {
  flowId: string;
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
  allowDisabled?: boolean;
};

/** "Run safe sync now" (RD-054 / PR-020): policy-gated preview + safe-only apply. */
export function useSafeSyncMutation() {
  return useMutation({ mutationFn: (args: SafeSyncArgs) => runClientSafeSync(args) });
}
