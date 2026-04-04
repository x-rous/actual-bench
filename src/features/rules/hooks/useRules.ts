"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRules } from "@/lib/api/rules";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

export function useRules() {
  const connection = useConnectionStore(selectActiveInstance);
  const loadRules = useStagedStore((s) => s.loadRules);

  const query = useQuery({
    queryKey: ["rules", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getRules(connection);
    },
    enabled: !!connection,
    // staleTime/gcTime/refetchOn* are set globally in queryClient.ts.
  });

  useEffect(() => {
    if (query.data) {
      loadRules(query.data);
    }
  }, [query.data, loadRules]);

  return query;
}
