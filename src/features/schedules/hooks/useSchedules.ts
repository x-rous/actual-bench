"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

type PreloadOptions = {
  enabled?: boolean;
};

export function useSchedules(options: PreloadOptions = {}) {
  const connection = useConnectionStore(selectActiveInstance);
  const loadSchedules = useStagedStore((s) => s.loadSchedules);

  const query = useQuery({
    queryKey: ["schedules", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTransport(connection).getSchedules();
    },
    enabled: !!connection && (options.enabled ?? true),
  });

  useEffect(() => {
    if (query.data) {
      loadSchedules(query.data);
    }
  }, [query.data, loadSchedules]);

  return query;
}
