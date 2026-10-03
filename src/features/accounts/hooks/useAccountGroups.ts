"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { isAccountGroupsUnsupported } from "@/lib/api/accountGroups";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import type { AccountGroup } from "@/types/entities";

/**
 * Fetches account groups into the staged store.
 *
 * Account groups need Actual 26.9+ (and, in HTTP API mode, an actual-http-api
 * that exposes `/accountgroups`). A server without them must not break the
 * Accounts page, so an "unsupported" answer resolves to `null` and
 * `supported` is false; every group control keys off that.
 */
export function useAccountGroups() {
  const connection = useConnectionStore(selectActiveInstance);
  const loadAccountGroups = useStagedStore((s) => s.loadAccountGroups);

  const query = useQuery<AccountGroup[] | null>({
    queryKey: ["accountGroups", connection?.id],
    queryFn: async () => {
      if (!connection) throw new Error("No active connection");
      const transport = getTransport(connection);
      if (!transport.getAccountGroups) return null;
      try {
        return await transport.getAccountGroups();
      } catch (error) {
        if (isAccountGroupsUnsupported(error)) return null;
        throw error;
      }
    },
    enabled: !!connection,
    // staleTime/gcTime/refetchOn* are set globally in queryClient.ts.
  });

  useEffect(() => {
    if (query.data) loadAccountGroups(query.data);
  }, [query.data, loadAccountGroups]);

  return {
    ...query,
    /** True once the server has answered and it has account groups. */
    supported: Array.isArray(query.data),
  };
}
