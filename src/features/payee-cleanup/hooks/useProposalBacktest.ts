"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { backtestProposal, type BacktestResult } from "../lib/patternBacktest";
import type { RuleGapProposal } from "../lib/ruleGaps";

/**
 * Checks one proposed rule against the whole budget, on request.
 *
 * Never automatic: the scan deliberately avoids one query per proposed rule, so
 * this stays behind an explicit ask on an open row. `enabled` carries that ask.
 *
 * Keyed by the condition rather than by the payee, so editing the condition in
 * the row's editor asks a new question instead of showing the old answer.
 */
export function useProposalBacktest(
  payee: { id: string; name: string },
  proposal: RuleGapProposal,
  options: { enabled: boolean }
): {
  data: BacktestResult | undefined;
  isFetching: boolean;
  error: unknown;
  /** Runs the check again after a failure, without a second click. */
  retry: () => void;
} {
  const connection = useConnectionStore(selectActiveInstance);
  const conditionKey =
    proposal.shape === "one-of"
      ? `oneof:${proposal.field}:${proposal.texts.join(" ")}`
      : `${proposal.candidate.op}:${proposal.field}:${proposal.candidate.value}`;

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["payeeCleanupBacktest", connection?.id, payee.id, conditionKey],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return backtestProposal(connection, proposal, payee.id, payee.name);
    },
    enabled: options.enabled && !!connection,
    // The budget does not change under the user mid-cleanup, and re-asking on
    // every expander toggle would make the button feel like it did nothing.
    staleTime: Infinity,
  });

  return { data, isFetching, error, retry: () => void refetch() };
}
