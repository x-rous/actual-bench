"use client";

import { useQuery } from "@tanstack/react-query";
import { getTagUsageCounts } from "@/lib/api/query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

/** Transactions per tag name, read from notes only while a usage filter needs it. */
export function useTagUsageCounts(options: { enabled: boolean }) {
  const connection = useConnectionStore(selectActiveInstance);
  return useQuery({
    queryKey: ["tagUsageCounts", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTagUsageCounts(connection);
    },
    enabled: options.enabled && !!connection,
    staleTime: 30_000,
    gcTime: 60_000,
  });
}
