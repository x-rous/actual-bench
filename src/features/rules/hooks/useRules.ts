"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

type PreloadOptions = {
  enabled?: boolean;
};

export function useRules(options: PreloadOptions = {}) {
  const connection = useConnectionStore(selectActiveInstance);
  const loadRules = useStagedStore((s) => s.loadRules);

  const query = useQuery({
    queryKey: ["rules", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTransport(connection).getRules();
    },
    enabled: !!connection && (options.enabled ?? true),
    // staleTime/gcTime/refetchOn* are set globally in queryClient.ts.
  });

  useEffect(() => {
    if (query.data) {
      loadRules(query.data);
    }
  }, [query.data, loadRules]);

  return query;
}
