"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTags } from "@/lib/api/tags";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

export function useTags() {
  const connection = useConnectionStore(selectActiveInstance);
  const loadTags = useStagedStore((s) => s.loadTags);

  const query = useQuery({
    queryKey: ["tags", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTags(connection);
    },
    enabled: !!connection,
  });

  useEffect(() => {
    if (query.data) {
      loadTags(query.data);
    }
  }, [query.data, loadTags]);

  return query;
}
