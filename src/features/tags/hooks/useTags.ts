"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

type PreloadOptions = {
  enabled?: boolean;
};

export function useTags(options: PreloadOptions = {}) {
  const connection = useConnectionStore(selectActiveInstance);
  const loadTags = useStagedStore((s) => s.loadTags);

  const query = useQuery({
    queryKey: ["tags", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTransport(connection).getTags();
    },
    enabled: !!connection && (options.enabled ?? true),
  });

  useEffect(() => {
    if (query.data) {
      loadTags(query.data);
    }
  }, [query.data, loadTags]);

  return query;
}
