"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getPayeeCleanupMetadata, fallbackMetadata } from "../lib/payeeMetadata";
import { partitionByEligibility } from "../lib/eligibility";
import { getPayeeCleanupCapabilities } from "../lib/capabilities";
import type { EligibilityPartition } from "../lib/eligibility";
import type { PayeeCleanupCandidate } from "../types";
import type { PayeeCleanupCapabilityReport } from "../lib/capabilities";

/**
 * Loads the cleanup candidate set: payees joined with the ActualQL-only
 * analysis metadata, already partitioned at the eligibility boundary.
 *
 * Two reads because no single supported call returns both — `getPayees()`
 * carries the name, the AQL `payees` query carries favorite/learn_categories/
 * tombstone/transfer_acct.
 *
 * Lazy by design: cleanup is a workspace the user opens, not something that
 * should scan on app start. `enabled` stays false until the workspace mounts.
 */
export function usePayeeCleanupCandidates(options: { enabled: boolean }): {
  partition: EligibilityPartition;
  capabilities: PayeeCleanupCapabilityReport | null;
  isLoading: boolean;
  /**
   * True for a re-scan as well as the first load. `isLoading` is only ever true
   * before there is data, so a Re-scan button wired to it never changes.
   */
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const query = useQuery({
    queryKey: ["payeeCleanupCandidates", connection?.id],
    queryFn: async (): Promise<PayeeCleanupCandidate[]> => {
      if (!connection) throw new Error("No active connection");

      // Sequential rather than Promise.all: the Direct runtime serializes work
      // against one budget anyway, and a metadata failure should not be masked
      // by a payee-list failure.
      const payees = await getTransport(connection).getPayees();
      const metadata = await getPayeeCleanupMetadata(connection);

      return payees.map((payee) => ({
        ...payee,
        metadata:
          metadata.get(payee.id) ??
          fallbackMetadata(payee.id, payee.transferAccountId ?? null),
      }));
    },
    enabled: options.enabled && !!connection,
  });

  const partition = useMemo(
    () => partitionByEligibility(query.data ?? []),
    [query.data]
  );

  const capabilities = useMemo(
    () => (connection ? getPayeeCleanupCapabilities(connection) : null),
    [connection]
  );

  return {
    partition,
    capabilities,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
